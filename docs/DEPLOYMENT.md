# CLIPFORGE AI — Deployment Guide

## Architecture

- **API server** (`server/src/index.js`): Fastify, serves the REST API and the built frontend (`web/dist`).
- **Worker** (`server/src/worker/index.js`): separate process that runs analysis and render jobs from the persistent queue.
- **Database**: SQLite (WAL) via better-sqlite3 — zero-config, stored at `DATA_DIR/clipforge.db`. For multi-node deployments, point `DATA_DIR` at a persistent volume shared by API + worker, or migrate the storage layer to Postgres (the data layer is isolated in `src/db.js` + `src/migrations/`).
- **Media**: private directory `MEDIA_DIR` (videos/, clips/, posters/, exports/). Never served statically — only through expiring HMAC-signed URLs.
- **AI**: local Vosk ASR by default; swap to OpenAI/Deepgram via env vars without code changes.

## Docker deployment

```dockerfile
# Dockerfile (repository root)
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip unzip tar && rm -rf /var/lib/apt/lists/*
```

A reference `docker-compose.yml` is included. Minimal steps:

```bash
docker compose up --build
# then run once inside the api container:
docker compose exec api npm run setup:models
```

## Manual deployment

1. Provision Node ≥ 20 and Python 3.10+.
2. `cd server && npm ci && npm run setup:models`
3. `cd web && npm ci && npm run build`
4. Set environment variables (see `.env.example`). `CLIPFORGE_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` are required for a real deployment.
5. Start with a process manager:

```bash
systemd unit example:
[Service]
WorkingDirectory=/opt/clipforge/server
EnvironmentFile=/opt/clipforge/.env
ExecStart=/usr/bin/node src/index.js
Restart=always

# Second unit for the worker: ExecStart=/usr/bin/node src/worker/index.js
```

6. Reverse proxy (nginx/Caddy) → `http://127.0.0.1:8787`. Enable HTTPS; media links are signed but not encrypted in transit without TLS.

## Scaling notes

- Render throughput scales with worker processes — each worker is single-threaded over ffmpeg; run one worker per core and raise `MAX_CONCURRENT_JOBS` accordingly (all workers share the DB-backed queue; jobs are claimed atomically).
- Put `MEDIA_DIR` on fast storage; rendering is disk- and CPU-bound.
- The SQLite queue uses WAL + busy_timeout; for very high throughput migrate `src/db.js` to Postgres.

## Operations

- **Health**: `GET /api/health`.
- **Admin console**: `/admin` (role `admin` only) — storage, jobs, failures, limits, audit log.
- **Retention**: `MEDIA_RETENTION_DAYS` documents retention; deleting a project/video/clip/account removes its files immediately.
- **Backups**: back up `DATA_DIR` (SQLite + media). The DB is small; media is not.
- **Secrets**: never expose `CLIPFORGE_SECRET` or provider keys to the frontend — all keys are read server-side only.
