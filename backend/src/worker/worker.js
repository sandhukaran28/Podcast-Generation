"use strict";

// Load environment variables first
require('dotenv').config();

// Set default environment variables if not defined
process.env.AWS_REGION = process.env.AWS_REGION || "ap-southeast-2";
process.env.SQS_QUEUE_URL = process.env.SQS_QUEUE_URL || "https://sqs.ap-southeast-2.amazonaws.com/901444280953/Noteflix-jobs";
process.env.S3_BUCKET = process.env.S3_BUCKET || "n11845619-assignment2";
process.env.S3_PREFIX = process.env.S3_PREFIX || "noteflix/outputs";
process.env.DATA_ROOT = process.env.DATA_ROOT || "./data";
process.env.OLLAMA_BASE = process.env.OLLAMA_BASE || "http://localhost:11434";
process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3";
process.env.PIPER_VOICE_A = process.env.PIPER_VOICE_A || "/app/models/en_US-amy-medium.onnx";
process.env.PIPER_VOICE_B = process.env.PIPER_VOICE_B || "/app/models/en_US-ryan-high.onnx";
process.env.AWS_PROFILE = process.env.AWS_PROFILE || "default";
process.env.AWS_SDK_LOAD_CONFIG = process.env.AWS_SDK_LOAD_CONFIG || "1";

const fs = require("fs");
const path = require("path");
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } = require("@aws-sdk/client-sqs");
const { getItem, sks } = require("../ddb");
const { processJob } = require("./processor");
const { log } = require("console");

console.log("=== WORKER STARTING UP ===");
console.log("AWS_REGION:", process.env.AWS_REGION);
console.log("SQS_QUEUE_URL:", process.env.SQS_QUEUE_URL);
console.log("S3_BUCKET:", process.env.S3_BUCKET);
console.log("DATA_ROOT:", process.env.DATA_ROOT);

const sqs = new SQSClient({ region: process.env.AWS_REGION || "ap-southeast-2" });
const QUEUE_URL = process.env.SQS_QUEUE_URL || "https://sqs.ap-southeast-2.amazonaws.com/901444280953/Noteflix-jobs";
if (!QUEUE_URL) throw new Error("SQS_QUEUE_URL env required");

const DATA_ROOT = process.env.DATA_ROOT || "./data";
const TMP_DIR = path.join(DATA_ROOT, "tmp");
const OUT_DIR = path.join(DATA_ROOT, "outputs");
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log("✓ Directories created");
console.log("✓ Starting SQS polling loop...");

async function loop() {
  while (true) {
    console.log("worker polling SQS...");
    log("worker polling SQS...");
    try {
      const r = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 600
      }));
      const msgs = r.Messages || [];
      if (msgs.length === 0) continue;
      console.log(`worker got ${msgs.length} messages`);
      log(`worker got ${msgs.length} messages`);
      for (const m of msgs) {
        try {
          console.log("📨 Processing message:", m.MessageId);
          const body = JSON.parse(m.Body || "{}");
          const { jobId, qutUser, assetPointer, params } = body;
          
          console.log("Job details:");
          console.log("  jobId:", jobId);
          console.log("  qutUser:", qutUser);
          console.log("  assetPointer:", JSON.stringify(assetPointer, null, 2));
          console.log("  params:", JSON.stringify(params, null, 2));

          // Recreate the ctx folder structure like your API did
          const jobDir = path.join(TMP_DIR, jobId);
          const outDir = path.join(OUT_DIR, jobId);
          const logsPath = path.join(jobDir, "logs.txt");
          const outputPath = path.join(outDir, "video.mp4");
          
          console.log("Creating directories:");
          console.log("  jobDir:", jobDir);
          console.log("  outDir:", outDir);
          
          fs.mkdirSync(jobDir, { recursive: true });
          fs.mkdirSync(outDir, { recursive: true });

          // Construct the minimal `asset` object your processor expects:
          const asset = assetPointer || {}; // must contain s3Bucket/s3Key OR local path
          // Build ctx to match your previous code:
          const ctx = {
            qutUser,
            jobDir,
            outDir,
            outputPath,
            logsPath,
            duration: params?.duration ?? 90,
            dialogue: params?.dialogue ?? "solo",
            encodeProfile: params?.encodeProfile ?? "balanced",
          };

          console.log("🚀 Starting job processing...");
          await processJob(jobId, asset, ctx);
          console.log("✅ Job processing completed");

          await sqs.send(new DeleteMessageCommand({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: m.ReceiptHandle
          }));
        } catch (e) {
          console.error("worker msg error:", e);
          log("worker msg error: " + e.message);
          // no delete => will retry / go to DLQ later
        }
      }
    } catch (e) {
      console.error("worker loop error:", e);
      log("worker loop error: " + e.message);
    }
  }
}
loop();
