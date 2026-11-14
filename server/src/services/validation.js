import { probe, summarizeProbe } from '../media/ffmpeg.js';
import { config } from '../config.js';

const ALLOWED_MIME = new Set([
  'video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm',
  'video/x-msvideo', 'video/mpeg', 'video/3gpp', 'video/x-flv',
]);
const ALLOWED_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.mpeg', '.mpg', '.3gp', '.flv', '.m4v']);

export class ValidationError extends Error {
  constructor(message, code = 'invalid_media') {
    super(message);
    this.code = code;
    this.statusCode = 422;
  }
}

export function validateUploadMeta({ filename, mime, size }) {
  const ext = String(filename || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
  if (!ALLOWED_EXT.has(ext)) {
    throw new ValidationError(`Unsupported file extension "${ext || '(none)'}". Allowed: ${[...ALLOWED_EXT].join(', ')}`);
  }
  if (mime && !ALLOWED_MIME.has(mime) && mime !== 'application/octet-stream') {
    throw new ValidationError(`Unsupported media type "${mime}".`);
  }
  if (size > config.limits.maxUploadBytes) {
    throw new ValidationError(`File exceeds the ${Math.round(config.limits.maxUploadBytes / 1024 / 1024)} MB upload limit.`);
  }
  return ext;
}

export async function validateMediaFile(filePath) {
  let info;
  try {
    info = await probe(filePath);
  } catch {
    throw new ValidationError('The file could not be read as media. It may be corrupt or not a real video.');
  }
  const s = summarizeProbe(info);
  if (!s.width || !s.height) throw new ValidationError('No video stream found in file.');
  if (!s.duration || !Number.isFinite(s.duration)) throw new ValidationError('Could not determine video duration.');
  if (s.duration < config.limits.minDurationSec) {
    throw new ValidationError(`Video is too short (${s.duration.toFixed(1)}s). Minimum is ${config.limits.minDurationSec}s.`);
  }
  if (s.duration > config.limits.maxDurationSec) {
    throw new ValidationError(`Video is too long (${Math.round(s.duration / 60)} min). Maximum is ${Math.round(config.limits.maxDurationSec / 60)} min.`);
  }
  return s;
}
