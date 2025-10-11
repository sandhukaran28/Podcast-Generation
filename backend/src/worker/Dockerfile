# backend/worker/Dockerfile
FROM node:20-bookworm

# --- Basics ---
ENV TMPDIR=/app/tmp
RUN mkdir -p /app/tmp

# --- System deps ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    python3 python3-pip python3-venv \
    ffmpeg poppler-utils \
 && rm -rf /var/lib/apt/lists/*

# --- Python venv + Piper TTS ---
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN pip install --no-cache-dir "piper-tts==1.3.0"

# --- App code (build context is backend/ so we can reuse shared modules) ---
WORKDIR /app
COPY package*.json ./
# If your backend has dev-only deps you don't need on worker, keep omit=dev:
RUN npm ci --omit=dev
# Bring in the whole backend so worker can require ../utils, ../ddb, etc.
COPY . .

# --- Piper voices (Amy = female, Ryan = male) ---
# Each voice MUST have .onnx + .onnx.json
RUN mkdir -p /app/models && cd /app/models && \
    curl -LfsS -o en_US-amy-medium.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx" && \
    curl -LfsS -o en_US-amy-medium.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json" && \
    curl -LfsS -o en_US-ryan-high.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx" && \
    curl -LfsS -o en_US-ryan-high.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx.json"

# --- Runtime env ---
ENV NODE_ENV=production \
    DATA_ROOT=/data \
    PIPER_BIN=piper \
    PIPER_VOICE_A=/app/models/en_US-amy-medium.onnx \
    PIPER_VOICE_B=/app/models/en_US-ryan-high.onnx

# --- AWS Credentials volume mount point ---
VOLUME ["/root/.aws"]

# Worker has no HTTP port to expose; it polls SQS and runs jobs
CMD ["node", "src/worker/worker.js"]
