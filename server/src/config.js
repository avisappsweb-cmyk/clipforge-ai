import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const VENDOR_DIR = path.join(ROOT_DIR, 'vendor');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
export const MEDIA_DIR = process.env.MEDIA_DIR || path.join(DATA_DIR, 'media');
export const WORK_DIR = path.join(DATA_DIR, 'work');
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'clipforge.db');

function envInt(name, def) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) ? v : def;
}
function envFloat(name, def) {
  const v = parseFloat(process.env[name] || '');
  return Number.isFinite(v) ? v : def;
}

function requiredSecret() {
  const s = process.env.CLIPFORGE_SECRET;
  if (s && s.length >= 16) return s;
  const secretFile = path.join(DATA_DIR, '.secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8');
    if (existing) return existing;
  } catch { /* generate below */ }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: envInt('PORT', 8787),
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${envInt('PORT', 8787)}`).replace(/\/$/, ''),
  secret: requiredSecret(),
  jwtTtl: process.env.JWT_TTL || '7d',
  signedUrlTtl: envInt('SIGNED_URL_TTL', 3600),

  adminEmail: process.env.ADMIN_EMAIL || null,
  adminPassword: process.env.ADMIN_PASSWORD || null,

  limits: {
    maxUploadBytes: envInt('MAX_UPLOAD_MB', 2048) * 1024 * 1024,
    maxDurationSec: envInt('MAX_DURATION_SEC', 7200),
    minDurationSec: envFloat('MIN_DURATION_SEC', 3),
    maxClipsPerVideo: envInt('MAX_CLIPS_PER_VIDEO', 12),
    maxConcurrentJobs: envInt('MAX_CONCURRENT_JOBS', 1),
    defaultClipsPerVideo: envInt('DEFAULT_CLIPS_PER_VIDEO', 5),
  },

  asr: {
    provider: process.env.ASR_PROVIDER || 'local-vosk',
    voskModelDir: process.env.VOSK_MODEL_DIR || path.join(VENDOR_DIR, 'vosk-model-small-en-us-0.15'),
    openaiKey: process.env.OPENAI_API_KEY || null,
    deepgramKey: process.env.DEEPGRAM_API_KEY || null,
  },

  storage: {
    retentionDays: envInt('MEDIA_RETENTION_DAYS', 30),
  },

  ffmpegPath: process.env.FFMPEG_PATH || null,
  ffprobePath: process.env.FFPROBE_PATH || null,

  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};
