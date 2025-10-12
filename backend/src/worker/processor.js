// Full processor with video generation
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { pipeline } = require("stream/promises");
const { synthesizePodcast } = require("../utils/tts");
const { fetchWikiSummary } = require("../utils/wiki");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const {
  updateItem,
  putJobEvent,
  sks,
} = require("../ddb");
const {
  bumpVersion,
} = require("../lib/cache");

// AWS setup
const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-southeast-2" });
const S3_BUCKET = process.env.S3_BUCKET;
const S3_PREFIX = (process.env.S3_PREFIX || "noteflix/outputs").replace(/\/+$/, "");

function s3KeyForJob(jobId) {
  return `${S3_PREFIX}/${jobId}/video.mp4`;
}

// Shell helpers
function sh(cmd, opts = {}) {
  return spawnSync("bash", ["-lc", cmd], { encoding: "utf8", ...opts });
}

function hasCmd(name) {
  const r = sh(`command -v ${name} || which ${name} || true`);
  return r.status === 0 && r.stdout.trim().length > 0;
}

async function downloadS3ToFile(bucket, key, toPath) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(resp.Body, fs.createWriteStream(toPath));
}

function getAudioDuration(file) {
  try {
    const out = spawnSync(
      "bash",
      ["-lc", `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`],
      { encoding: "utf8" }
    );
    if (out.status === 0) return Math.ceil(parseFloat(out.stdout.trim()));
  } catch (e) {}
  return null;
}

async function callOllama(prompt, { base, model }) {
  const url = `${base || "http://localhost:11434"}/api/generate`;
  const body = {
    model: model || "llama3",
    prompt,
    stream: false,
    options: { temperature: 0.6 },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const json = await res.json();
  return json.response;
}

function makeVttFromScript(text) {
  const cleaned = text.replace(/\r/g, "").trim();
  const parts = cleaned.split(/(?<=[\.\!\?])\s+/).filter(Boolean);
  let t = 0;
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec - Math.floor(sec)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)}.${String(ms).padStart(3, "0")}`;
  };
  let vtt = "WEBVTT\n\n";
  for (let i = 0; i < parts.length; i++) {
    const dur = 3;
    const start = stamp(t);
    const end = stamp(t + dur);
    vtt += `${i + 1}\n${start} --> ${end}\n${parts[i]}\n\n`;
    t += dur;
  }
  if (parts.length === 0) {
    vtt += `1\n00:00:00.000 --> 00:00:03.000\n(no script)\n\n`;
  }
  return vtt;
}

function cleanForTTS(text) {
  return text
    .normalize("NFKD")
    .replace(/Here is the script[^:]*:\s*/gi, "")
    .replace(/\b(Alex|Sam):\s*/gi, "")
    .replace(/[^\x00-\x7F]+/g, " ")
    .replace(/\*\*?\s*\[[^\]]+\]\s*\*?\s*/g, " ")
    .replace(/\[[0-9:\- ]+seconds?\]/gi, " ")
    .replace(/\*\*/g, " ")
    .replace(/[_`#>•▪︎•·–—""'']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function processJob(id, asset, ctx) {
  const log = (s) => {
    const msg = `[${new Date().toISOString()}] ${s}`;
    console.log(msg);
    try { 
      fs.appendFileSync(ctx.logsPath, msg + "\n"); 
    } catch (e) {}
  };
  
  log("=== STARTING FULL VIDEO PROCESSING ===");
  log("Job ID: " + id);
  log("qutUser: " + ctx.qutUser);
  log("Asset: " + JSON.stringify(asset, null, 2));
  
  const start = Date.now();

  try {
    // Step 1: Update job status
    log("Step 1: Updating job status to running...");
    await updateItem(
      ctx.qutUser,
      sks.job(id),
      "SET #status = :s, #startedAt = :t",
      { "#status": "status", "#startedAt": "startedAt" },
      { ":s": "running", ":t": new Date().toISOString() }
    );
    await bumpVersion("jobs", ctx.qutUser);
    putJobEvent(id, ctx.qutUser, "running", "Processing started").catch(() => {});
    await bumpVersion("audit", ctx.qutUser);
    log("✓ Job status updated");

    // Step 2: Download and process source file
    log("Step 2: Processing source file...");
    const jobDir = ctx.jobDir;
    fs.mkdirSync(jobDir, { recursive: true });
    
    let sourcePath;
    let isPdf = false;

    if (asset.s3Bucket && asset.s3Key) {
      log("Downloading from S3: s3://" + asset.s3Bucket + "/" + asset.s3Key);
      const ext = path.extname(asset.s3Key || "").toLowerCase();
      isPdf = asset.type === "pdf" || ext === ".pdf";
      sourcePath = path.join(jobDir, "source" + (ext || (isPdf ? ".pdf" : "")));
      
      await downloadS3ToFile(asset.s3Bucket, asset.s3Key, sourcePath);
      log("✓ S3 download completed: " + sourcePath);
    } else {
      throw new Error("No S3 source found in asset");
    }

    // Step 3: Convert PDF to images or copy single image
    log("Step 3: Converting to images...");
    if (isPdf) {
      if (!hasCmd("pdftoppm")) {
        throw new Error("pdftoppm not found (install poppler-utils)");
      }
      const pdfCmd = `pdftoppm -png "${sourcePath}" "${jobDir}/slide"`;
      log("Running: " + pdfCmd);
      const p1 = sh(pdfCmd);
      if (p1.status !== 0) {
        log("PDF conversion failed: " + p1.stderr);
        throw new Error("PDF conversion failed");
      }
      log("✓ PDF converted to images");
    } else {
      const slide1 = path.join(jobDir, "slide-001.png");
      const copyCmd = `cp "${sourcePath}" "${slide1}"`;
      log("Running: " + copyCmd);
      const p1 = sh(copyCmd);
      if (p1.status !== 0) {
        log("Image copy failed: " + p1.stderr);
        throw new Error("Image copy failed");
      }
      log("✓ Image copied");
    }

    // Check what files we created
    const ls = sh(`ls -la "${jobDir}"`);
    log("Job directory contents:\n" + (ls.stdout || ""));

    // Step 4: Generate script with Ollama
    log("Step 4: Generating script with Ollama...");
    let scriptText = "";
    
    if (isPdf) {
      let notes = "";
      if (hasCmd("pdftotext")) {
        const textPath = path.join(jobDir, "notes.txt");
        const t1 = sh(`pdftotext "${sourcePath}" "${textPath}"`);
        if (t1.status === 0 && fs.existsSync(textPath)) {
          notes = fs.readFileSync(textPath, "utf8");
          log("Extracted " + notes.length + " characters from PDF");
        }
      }

      const wpm = 150;
      const targetSeconds = Math.max(30, Math.min(600, Number(ctx.duration || 90)));
      const targetWords = Math.round((wpm / 60) * targetSeconds);
      const duet = ctx.dialogue === "duet";
      const excerpt = (notes || "").trim().slice(0, 4000);

      const prompt = `You are scripting a short educational podcast${duet ? " with TWO speakers (Alex and Sam)" : ""}.
${duet ? "Write alternating lines starting with 'Alex:' and 'Sam:'." : "Write a single narrator script."}

Constraints:
- Target length: ~${targetWords} words (≈ ${targetSeconds} seconds at ~${wpm} wpm).
- Friendly, precise, clear. Short sentences (6–16 words). No filler.
- Keep it grounded in the NOTES content. If missing, you MAY use WIKI if provided.
- Do NOT include stage directions, timecodes, or markdown—just the spoken lines.

NOTES:
${excerpt || "(No extracted text available.)"}`.trim();

      const base = process.env.OLLAMA_BASE || "http://localhost:11434";
      const model = process.env.OLLAMA_MODEL || "llama3";
      
      log("Calling Ollama at " + base + " with model " + model);
      try {
        const resp = await callOllama(prompt, { base, model });
        scriptText = resp;
        log("✓ Ollama response received (" + resp.length + " chars)");
      } catch (e) {
        log("Ollama call failed: " + e.message);
        scriptText = "Welcome to NoteFlix. This is an automatically generated study summary. Please review your notes and key definitions.";
      }
    } else {
      scriptText = "This video animates your uploaded slide. Add more pages for a richer episode.";
    }

    const scriptPath = path.join(jobDir, "script.txt");
    fs.writeFileSync(scriptPath, scriptText, "utf8");
    log("✓ Script saved: " + scriptPath);

    // Step 5: TTS synthesis
    log("Step 5: Synthesizing audio...");
    const cleaned = cleanForTTS(scriptText);
    let scriptLines;
    
    if (ctx.dialogue === "duet") {
      const labeled = cleaned.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const hasLabels = labeled.some((l) => /^alex:|^sam:/i.test(l));
      scriptLines = hasLabels
        ? labeled.map((l) => l.replace(/^(alex|sam):\s*/i, ""))
        : cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    } else {
      scriptLines = [cleaned];
    }

    let narrationPath = null;
    let hasAudio = false;
    
    try {
      narrationPath = path.join(jobDir, "narration.wav");
      const voices = {
        voiceA: process.env.PIPER_VOICE_A || "/app/models/en_US-amy-medium.onnx",
        voiceB: process.env.PIPER_VOICE_B || "/app/models/en_US-ryan-high.onnx",
      };
      
      await synthesizePodcast(scriptLines, narrationPath, ctx.dialogue === "duet", voices);
      hasAudio = fs.existsSync(narrationPath);
      log("✓ TTS synthesis complete, audio: " + hasAudio);
    } catch (e) {
      log("TTS synthesis failed: " + e.message);
      hasAudio = false;
    }

    // Step 6: Create captions
    log("Step 6: Creating captions...");
    const vtt = makeVttFromScript(scriptText);
    const vttPath = path.join(jobDir, "captions.vtt");
    fs.writeFileSync(vttPath, vtt, "utf8");
    log("✓ Captions created");

    // Step 7: Video encoding
    log("Step 7: Encoding video...");
    const slides = fs.readdirSync(jobDir)
      .filter((f) => /^slide-.*\.png$/i.test(f))
      .sort();
    
    const nSlides = Math.max(1, slides.length);
    log("Found " + nSlides + " slides: " + slides.join(", "));

    if (slides.length === 0) {
      throw new Error("No slide images found for video encoding");
    }

    // Use the first available slide (actual filename, not assumed)
    const firstSlide = path.join(jobDir, slides[0]);
    log("Using first slide: " + firstSlide);

    let totalDuration = ctx.duration || 90;
    if (hasAudio) {
      const dur = getAudioDuration(narrationPath);
      if (dur && dur > 0) {
        totalDuration = dur;
        log("Using audio duration: " + dur + "s");
      }
    }

    const profile = String(ctx.encodeProfile || "balanced").toLowerCase();
    
    // Build FFmpeg command using actual first slide filename
    let cmd;
    if (hasAudio) {
      cmd = `ffmpeg -y -loop 1 -i "${firstSlide}" -i "${narrationPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -shortest -movflags +faststart "${ctx.outputPath}"`;
    } else {
      cmd = `ffmpeg -y -loop 1 -i "${firstSlide}" -c:v libx264 -preset fast -crf 23 -t ${totalDuration} -movflags +faststart "${ctx.outputPath}"`;
    }

    log("FFmpeg command: " + cmd);
    
    const enc = spawn("bash", ["-lc", cmd]);
    enc.stdout.on("data", (d) => log("FFMPEG: " + d.toString().trim()));
    enc.stderr.on("data", (d) => log("FFMPEG: " + d.toString().trim()));
    
    await new Promise((resolve, reject) => {
      enc.on("close", (code) => {
        log("FFmpeg finished with code: " + code);
        if (code === 0) resolve();
        else reject(new Error("FFmpeg failed with code: " + code));
      });
    });

    if (!fs.existsSync(ctx.outputPath)) {
      throw new Error("FFmpeg failed to produce output file");
    }
    
    const outputSize = fs.statSync(ctx.outputPath).size;
    log("✓ Video created: " + outputSize + " bytes");

    // Step 8: Create metrics
    try {
      const metrics = {
        durationSeconds: totalDuration,
        slides: nSlides,
        profile,
        hasAudio: !!hasAudio,
        audioSeconds: hasAudio ? getAudioDuration(narrationPath) : 0,
        cpuSeconds: Math.round((Date.now() - start) / 1000),
        outputBytes: outputSize,
      };
      fs.writeFileSync(path.join(jobDir, "metrics.json"), JSON.stringify(metrics, null, 2));
      log("✓ Metrics saved");
    } catch (e) {
      log("WARN: failed to write metrics: " + e.message);
    }

    // Step 9: Upload to S3 (if configured)
    let uploaded = false;
    if (S3_BUCKET) {
      try {
        const s3Key = s3KeyForJob(id);
        log("Uploading to S3: s3://" + S3_BUCKET + "/" + s3Key);
        
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: fs.createReadStream(ctx.outputPath),
          ContentType: "video/mp4",
          ContentDisposition: 'attachment; filename="video.mp4"',
        }));
        
        uploaded = true;
        
        await updateItem(
          ctx.qutUser,
          sks.job(id),
          "SET #s3Bucket = :b, #s3Key = :k",
          { "#s3Bucket": "s3Bucket", "#s3Key": "s3Key" },
          { ":b": S3_BUCKET, ":k": s3Key }
        );
        
        log("✓ S3 upload complete");
      } catch (e) {
        log("WARN: S3 upload failed: " + e.message);
      }
    }

    // Step 10: Finalize job
    log("Step 10: Finalizing job...");
    const cpuSeconds = Math.round((Date.now() - start) / 1000);
    
    await updateItem(
      ctx.qutUser,
      sks.job(id),
      "SET #status=:st, #finishedAt=:fin, #cpuSeconds=:cpu, #outputPath=:out",
      {
        "#status": "status",
        "#finishedAt": "finishedAt",
        "#cpuSeconds": "cpuSeconds",
        "#outputPath": "outputPath",
      },
      {
        ":st": "done",
        ":fin": new Date().toISOString(),
        ":cpu": cpuSeconds,
        ":out": ctx.outputPath,
      }
    );
    
    await bumpVersion("jobs", ctx.qutUser);
    putJobEvent(id, ctx.qutUser, "done", uploaded ? "Complete (uploaded to S3)" : "Complete").catch(() => {});
    await bumpVersion("audit", ctx.qutUser);

    log("=== JOB COMPLETED SUCCESSFULLY ===");
    log("Total time: " + cpuSeconds + "s, uploaded: " + uploaded);
    
  } catch (err) {
    const msg = err?.message || String(err);
    log("=== JOB FAILED ===");
    log("Error: " + msg);
    log("Stack: " + (err?.stack || "No stack"));
    
    try {
      const cpuSeconds = Math.round((Date.now() - start) / 1000);
      await updateItem(
        ctx.qutUser,
        sks.job(id),
        "SET #status=:st, #finishedAt=:fin, #cpuSeconds=:cpu",
        {
          "#status": "status",
          "#finishedAt": "finishedAt",
          "#cpuSeconds": "cpuSeconds",
        },
        {
          ":st": "failed",
          ":fin": new Date().toISOString(),
          ":cpu": cpuSeconds,
        }
      );
      
      await bumpVersion("jobs", ctx.qutUser);
      putJobEvent(id, ctx.qutUser, "failed", msg).catch(() => {});
      await bumpVersion("audit", ctx.qutUser);
      
      log("✓ Job status updated to failed");
    } catch (updateErr) {
      log("ERROR updating failed status: " + updateErr.message);
    }
    
    throw err;
  }
}

module.exports = { processJob };
