# CLIPFORGE AI

Production-oriented, full-stack AI video repurposing platform. Upload a video, let AI find and
rank the most engaging moments, then render polished short-form MP4s with animated captions,
title cards, progress bars and intelligent reframing — all burned into the exported file.

## What actually runs

| Capability | Implementation |
| --- | --- |
| Transcription | **Real ASR** via offline Vosk (word-level timestamps). Pluggable providers: OpenAI Whisper API, Deepgram (with speaker diarization). The system never fabricates transcript text. |
| Scene detection | ffmpeg scene-change scoring |
| Highlight ranking | Explainable 0–100 engagement-potential score across six factors (hook, clarity, pacing, emotion, standalone context, shareability) with per-factor evidence. Estimates only — never a virality guarantee. |
| Caption / motion graphics | libass (ASS) engine: karaoke word highlighting, dynamic emphasis, 6 themes (cinematic, podcast, bold creator, minimal, gaming, storytelling), title cards, lower thirds, animated progress bar, safe-area positioning |
| Reframing | 9:16 / 1:1 / 16:9 with attention-aware animated crop tracking |
| Rendering | ffmpeg H.264/AAC MP4, loudness-normalized audio, optional background music with sidechain ducking |
| Jobs | Persistent background worker with retries, progress, failure states |
| Auth | JWT + bcrypt, role-based admin, rate limiting |
| Media | Private storage, HMAC-signed expiring links, range requests, downloads |
| Admin | Real usage/storage stats, user management, job monitoring, audit log, configurable platform limits |

## Repository layout

```
clipforge/
├── server/            Fastify API + background worker (Node 20+)
│   ├── src/
│   │   ├── ai/        ASR providers, analysis, explainable scoring
│   │   ├── media/     ffmpeg probe/render, ASS caption engine, reframing
│   │   ├── routes/    REST API
│   │   ├── services/  storage, signed URLs, validation, rate limiting
│   │   ├── worker/    job queue + pipeline
│   │   └── migrations/
│   └── scripts/       setup-models.mjs, e2e.mjs
├── web/               React 18 + Vite frontend (liquid-glass design system)
├── docs/              Deployment guide
└── README.md
```

## Quickstart

Requirements: Node ≥ 20, Python 3.10+ with `pip`, `unzip`, `tar`.

```bash
# 1. Server dependencies (includes prebuilt ffmpeg/ffprobe binaries)
cd server && npm install

# 2. Local ASR model + caption fonts (~110 MB download)
npm run setup:models

# 3. Configure (all optional — sensible dev defaults)
cp ../.env.example ../.env   # edit as needed

# 4. Run API + worker
npm run dev &                # API on http://127.0.0.1:8787
npm run worker &             # background processor

# 5. Frontend
cd ../web && npm install
npm run dev                  # http://localhost:5173 (proxies /api to :8787)
```

The **first registered user is a regular user**. Create an administrator with
`ADMIN_EMAIL` + `ADMIN_PASSWORD` environment variables (bootstrap happens on server start).

Production build (single origin — the API also serves the built frontend):

```bash
cd web && npm run build      # outputs web/dist, served by the API automatically
```

## Environment variables

See [.env.example](.env.example) for the full annotated list. Key ones:

| Variable | Purpose |
| --- | --- |
| `CLIPFORGE_SECRET` | JWT + signed-URL HMAC secret (**required in production**, ≥ 16 chars) |
| `DATA_DIR`, `MEDIA_DIR` | Database + private media storage locations |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Bootstrap administrator account |
| `ASR_PROVIDER` | `local-vosk` (default), `openai`, or `deepgram` |
| `OPENAI_API_KEY` / `DEEPGRAM_API_KEY` | Cloud ASR providers (kept server-side only) |
| `MAX_UPLOAD_MB`, `MAX_DURATION_SEC` | Platform limits (also admin-configurable at runtime) |
| `CORS_ORIGINS` | Allowed browser origins (comma-separated); empty = same-origin |

## End-to-end test

```bash
cd server && npm run test:e2e
```

The script synthesizes a real spoken video (piper TTS + ffmpeg), uploads it through the API,
verifies the transcription matches the spoken content, checks ranked highlight scoring,
edits a clip, renders it, and verifies the downloadable MP4 — 29 assertions in total.
The rendered sample is kept at `server/data-e2e/e2e-tmp/out.mp4`.

## Platform imports (important)

Upload is the primary input path and always works. YouTube / Instagram / TikTok / X /
Facebook / Twitch import adapters are **declared but inactive** until their official API
credentials are configured on the server. CLIPFORGE never bypasses platform restrictions,
authentication, DRM or access controls; unsupported links are clearly explained and users
are offered the upload alternative.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Docker, reverse-proxy, scaling and
operational guidance.

## License

Proprietary — all rights reserved by the repository owner.
