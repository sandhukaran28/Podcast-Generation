// src/routes/jobs.js
"use strict";

const { Router } = require("express");
const { v4: uuid } = require("uuid");
const path = require("path");
const fs = require("fs");

const {
  S3Client,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const {
  getJSON,
  setJSON,
  getVersion,
  bumpVersion,
  stableKeyFromObject,
} = require("../lib/cache");

const {
  DDB_PK_NAME,
  sks,
  putItem,
  getItem,
  queryByPrefix,
  qutUsernameFromReqUser,
  putJobEvent,
  getJobEvents,
} = require("../ddb");

// -------------------- paths & dirs --------------------
const DATA_ROOT = process.env.DATA_ROOT || "./data";
const TMP_DIR = path.join(DATA_ROOT, "tmp");
const OUT_DIR = path.join(DATA_ROOT, "outputs");
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-southeast-2" });
const S3_PREFIX = (process.env.S3_PREFIX || "noteflix/outputs").replace(
  /\/+$/,
  ""
);

const r = Router();

const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const sqs = new SQSClient({ region: process.env.AWS_REGION || "ap-southeast-2" });
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;

function s3KeyForJob(jobId) {
  return `${S3_PREFIX}/${jobId}/video.mp4`;
}

// -------------------- create job --------------------
r.post("/process", async (req, res) => {
  try {
    const user = req.user;
    const {
      assetId,
      style = "kenburns",
      duration = 90,
      dialogue = "solo",
      encodeProfile = "balanced",
    } = req.body || {};

    const qutUser = qutUsernameFromReqUser(user);

    // Validate asset
    const asset = await getItem(qutUser, sks.asset(assetId));
    if (!asset) return res.status(400).json({ error: "invalid assetId" });

    const id = uuid();
    const jobDir = path.join(TMP_DIR, id);
    const logsPath = path.join(jobDir, "logs.txt");
    const outDir = path.join(OUT_DIR, id);
    const outputPath = path.join(outDir, "video.mp4");
    fs.mkdirSync(jobDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    const now = new Date().toISOString();
    const jobItem = {
      [DDB_PK_NAME]: qutUser,
      sk: sks.job(id),
      entity: "job",
      id,
      assetId,
      owner: user?.sub || "unknown",
      params: { style, duration, dialogue, encodeProfile },
      status: "pending",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      cpuSeconds: 0,
      outputPath: null,
      logsPath,
      s3Bucket: null,
      s3Key: null,
    };
    await putItem(jobItem);
    await bumpVersion("jobs", qutUser);

    // Audit
    putJobEvent(id, qutUser, "pending", "Job created").catch(() => {});
    await bumpVersion("audit", qutUser);

    // 👉 NEW: enqueue to SQS (worker will process)
    if (!SQS_QUEUE_URL) {
      return res.status(500).json({ error: "SQS_QUEUE_URL not configured" });
    }
    const payload = {
      jobId: id,
      qutUser,
      // the worker needs enough info to fetch the asset & params
      assetPointer: { s3Bucket: asset.s3Bucket, s3Key: asset.s3Key, localPath: asset.path, type: asset.type, meta: asset.meta },
      params: { style, duration, dialogue, encodeProfile }
    };
    await sqs.send(new SendMessageCommand({
      QueueUrl: SQS_QUEUE_URL,
      MessageBody: JSON.stringify(payload)
    }));

    // Respond immediately
    res.json({ jobId: id });
  } catch (e) {
    console.error("jobs POST /process failed:", e);
    res.status(500).json({ error: "failed to create job" });
  }
});


// -------------------- list + details --------------------
r.get("/", async (req, res) => {
  try {
    const user = req.user;
    const qutUser = qutUsernameFromReqUser(user);
    const q = req.query || {};

    const limit = Math.max(1, Math.min(100, parseInt(q.limit, 10) || 20));
    const offset = Math.max(0, parseInt(q.offset, 10) || 0);

    const status =
      typeof q.status === "string" && q.status.trim() ? q.status.trim() : null;
    const assetId = q.assetId?.trim() || null;
    const startedAfter = q.startedAfter?.trim() || null;
    const finishedBefore = q.finishedBefore?.trim() || null;

    // ---- cache first
    const ver = await getVersion("jobs", qutUser);
    const listKey = `jobs:list:${qutUser}:v${ver}:${stableKeyFromObject({
      limit,
      offset,
      status,
      assetId,
      startedAfter,
      finishedBefore,
      sort: q.sort,
      order: q.order,
    })}`;
    const cached = await getJSON(listKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("X-Total-Count", String(cached.totalItems ?? 0));
      return res.json(cached);
    }

    let items = await queryByPrefix(qutUser, "JOB#");
    items = items.filter((it) => it.entity === "job");

    // Filters
    if (status) items = items.filter((it) => it.status === status);
    if (assetId) items = items.filter((it) => it.assetId === assetId);
    if (startedAfter)
      items = items.filter((it) => (it.startedAt || "") >= startedAfter);
    if (finishedBefore)
      items = items.filter((it) => (it.finishedAt || "") <= finishedBefore);

    // Sorting (mirror old behavior)
    const allowedFields = ["rowid", "createdAt", "startedAt", "finishedAt"];
    let sortParam = (q.sort || "").toString().trim();
    let requestedField = sortParam || "createdAt";
    let dirFromSort = "";

    if (sortParam.includes(":")) {
      const [f, d] = sortParam.split(":");
      requestedField = (f || "").trim() || "createdAt";
      dirFromSort = (d || "").trim();
    }
    const orderDir =
      (dirFromSort || q.order || "desc").toLowerCase() === "asc"
        ? "asc"
        : "desc";

    let sortField = "createdAt";
    if (requestedField === "rowid") sortField = "sk";
    else if (allowedFields.includes(requestedField)) sortField = requestedField;

    items.sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      if (av < bv) return orderDir === "asc" ? -1 : 1;
      if (av > bv) return orderDir === "asc" ? 1 : -1;
      return 0;
    });

    const total = items.length;
    const totalPages = Math.ceil(total / limit);
    const paged = items.slice(offset, offset + limit);

    const payload = {
      totalItems: total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      totalPages,
      items: paged,
    };

    await setJSON(listKey, payload, 60);
    res.setHeader("X-Total-Count", String(total));
    res.setHeader("X-Cache", "MISS");
    res.json(payload);
  } catch (e) {
    console.error("jobs LIST failed:", e);
    res.status(500).json({ error: "list failed" });
  }
});

r.get("/:id", async (req, res) => {
  try {
    const user = req.user;
    const qutUser = qutUsernameFromReqUser(user);

    const ver = await getVersion("jobs", qutUser);
    const key = `jobs:detail:${qutUser}:v${ver}:${req.params.id}`;

    let row = await getJSON(key);
    if (!row) {
      row = await getItem(qutUser, sks.job(req.params.id));
      if (row) await setJSON(key, row, 60);
      res.setHeader("X-Cache", "MISS");
    } else {
      res.setHeader("X-Cache", "HIT");
    }

    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: "read failed" });
  }
});

// ---- audit (DynamoDB) ----
r.get("/:id/audit", async (req, res) => {
  try {
    const qutUser = qutUsernameFromReqUser(req.user);

    const ver = await getVersion("audit", qutUser);
    const key = `jobs:audit:${qutUser}:v${ver}:${req.params.id}`;

    let payload = await getJSON(key);
    if (!payload) {
      const items = await getJobEvents(req.params.id, qutUser);
      payload = { items };
      await setJSON(key, payload, 30);
      res.setHeader("X-Cache", "MISS");
    } else {
      res.setHeader("X-Cache", "HIT");
    }

    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: "audit read failed" });
  }
});

// -------------------- logs --------------------
r.get("/:id/logs", async (req, res) => {
  const qutUser = qutUsernameFromReqUser(req.user);
  const row = await getItem(qutUser, sks.job(req.params.id));
  if (!row || !row.logsPath)
    return res.status(404).json({ error: "not found" });
  if (!fs.existsSync(row.logsPath)) return res.status(200).send("");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  fs.createReadStream(row.logsPath).pipe(res);
});

// -------------------- output (Download) --------------------
r.get("/:id/output", async (req, res) => {
  const qutUser = qutUsernameFromReqUser(req.user);
  const row = await getItem(qutUser, sks.job(req.params.id));
  if (!row) return res.status(404).json({ error: "not found" });

  const bucket = row.s3Bucket || process.env.S3_BUCKET;
  const key = row.s3Key || s3KeyForJob(row.id);

  if (bucket && key) {
    try {
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: 'attachment; filename="video.mp4"',
        }),
        { expiresIn: 900 }
      );
      return res.redirect(302, url);
    } catch (e) {
      console.warn("S3 presign failed:", e.message);
      // fall back to local path
    }
  }

  if (!row.outputPath || !fs.existsSync(row.outputPath)) {
    return res.status(404).json({ error: "not found" });
  }
  const stat = fs.statSync(row.outputPath);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", 'attachment; filename="video.mp4"');
  res.setHeader("Accept-Ranges", "bytes");

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return res.status(416).end();
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (isNaN(start) || isNaN(end) || start > end || end >= stat.size)
      return res.status(416).end();
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    fs.createReadStream(row.outputPath, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", String(stat.size));
    fs.createReadStream(row.outputPath).pipe(res);
  }
});

// -------------------- captions --------------------
r.get("/:id/captions", async (req, res) => {
  const qutUser = qutUsernameFromReqUser(req.user);
  const row = await getItem(qutUser, sks.job(req.params.id));
  if (!row) return res.status(404).json({ error: "not found" });
  const jobDir = row.logsPath ? path.dirname(row.logsPath) : null;
  if (!jobDir) return res.status(404).json({ error: "not found" });

  const vttPath = path.join(jobDir, "captions.vtt");
  if (!fs.existsSync(vttPath))
    return res.status(404).json({ error: "no captions" });

  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=captions.vtt");
  fs.createReadStream(vttPath).pipe(res);
});

// -------------------- script --------------------
r.get("/:id/script", async (req, res) => {
  const qutUser = qutUsernameFromReqUser(req.user);
  const row = await getItem(qutUser, sks.job(req.params.id));
  if (!row) return res.status(404).json({ error: "not found" });
  const jobDir = row.logsPath ? path.dirname(row.logsPath) : null;
  if (!jobDir) return res.status(404).json({ error: "not found" });

  const scriptPath = path.join(jobDir, "script.txt");
  if (!fs.existsSync(scriptPath))
    return res.status(404).json({ error: "no script" });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=script.txt");
  fs.createReadStream(scriptPath).pipe(res);
});

// -------------------- metrics --------------------
r.get("/:id/metrics", async (req, res) => {
  const qutUser = qutUsernameFromReqUser(req.user);
  const row = await getItem(qutUser, sks.job(req.params.id));
  if (!row) return res.status(404).json({ error: "not found" });
  const jobDir = row.logsPath ? path.dirname(row.logsPath) : null;
  if (!jobDir) return res.status(404).json({ error: "not found" });

  const metricsPath = path.join(jobDir, "metrics.json");
  if (!fs.existsSync(metricsPath))
    return res.status(404).json({ error: "no metrics" });

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  fs.createReadStream(metricsPath).pipe(res);
});

module.exports = r;

