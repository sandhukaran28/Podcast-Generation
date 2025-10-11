"use strict";
const fs = require("fs");
const path = require("path");
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } = require("@aws-sdk/client-sqs");
const { getItem, sks } = require("../ddb");
const { processJob } = require("./processor");

const sqs = new SQSClient({ region: process.env.AWS_REGION || "ap-southeast-2" });
const QUEUE_URL = process.env.SQS_QUEUE_URL;
if (!QUEUE_URL) throw new Error("SQS_QUEUE_URL env required");

const DATA_ROOT = process.env.DATA_ROOT || "./data";
const TMP_DIR = path.join(DATA_ROOT, "tmp");
const OUT_DIR = path.join(DATA_ROOT, "outputs");
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

async function loop() {
  while (true) {
    try {
      const r = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 600
      }));
      const msgs = r.Messages || [];
      if (msgs.length === 0) continue;

      for (const m of msgs) {
        try {
          const body = JSON.parse(m.Body || "{}");
          const { jobId, qutUser, assetPointer, params } = body;

          // Recreate the ctx folder structure like your API did
          const jobDir = path.join(TMP_DIR, jobId);
          const outDir = path.join(OUT_DIR, jobId);
          const logsPath = path.join(jobDir, "logs.txt");
          const outputPath = path.join(outDir, "video.mp4");
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

          await processJob(jobId, asset, ctx);

          await sqs.send(new DeleteMessageCommand({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: m.ReceiptHandle
          }));
        } catch (e) {
          console.error("worker msg error:", e);
          // no delete => will retry / go to DLQ later
        }
      }
    } catch (e) {
      console.error("worker loop error:", e);
    }
  }
}
loop();
