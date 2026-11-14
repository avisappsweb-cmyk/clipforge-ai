FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip unzip tar ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --break-system-packages --no-cache-dir vosk fonttools

WORKDIR /app
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --no-audit --no-fund

COPY server ./server
COPY web ./web
RUN cd web && npm ci --no-audit --no-fund && npm run build

# ASR model + fonts are downloaded at first start (or bake them in:
# RUN cd server && npm run setup:models)
ENV DATA_DIR=/data
VOLUME /data

EXPOSE 8787
WORKDIR /app/server
CMD ["sh", "-c", "npm run setup:models && node src/index.js"]
