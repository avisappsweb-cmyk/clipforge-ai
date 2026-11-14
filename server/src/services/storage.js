import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { config, MEDIA_DIR } from '../config.js';

function hmac(data) {
  return crypto.createHmac('sha256', config.secret).update(data).digest('base64url');
}

export function signedMediaUrl(kind, id, { download = false, name = null, ttl = config.signedUrlTtl } = {}) {
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const extra = download ? `&dl=1${name ? `&name=${encodeURIComponent(name)}` : ''}` : '';
  const payload = `${kind}/${id}/${expires}`;
  const sig = hmac(payload);
  return `/api/media/${kind}/${id}?expires=${expires}&sig=${sig}${extra}`;
}

export function verifyMediaSignature(kind, id, expires, sig) {
  const exp = parseInt(expires, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = hmac(`${kind}/${id}/${exp}`);
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function mediaPath(kind, id) {
  if (kind === 'video') return path.join(MEDIA_DIR, 'videos', `${id}.mp4`);
  if (kind === 'clip') return path.join(MEDIA_DIR, 'clips', `${id}.mp4`);
  if (kind === 'poster') return path.join(MEDIA_DIR, 'posters', `${id}.jpg`);
  if (kind === 'export') return path.join(MEDIA_DIR, 'exports', `${id}.mp4`);
  return null;
}

export function ensureMediaDirs() {
  for (const d of ['videos', 'clips', 'posters', 'exports', 'tmp']) {
    fs.mkdirSync(path.join(MEDIA_DIR, d), { recursive: true });
  }
}
