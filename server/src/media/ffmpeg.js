import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { config } from '../config.js';

export const FFMPEG = config.ffmpegPath || ffmpegStatic;
export const FFPROBE = config.ffprobePath || ffprobeStatic.path;

export function run(bin, args, { onStderr = null, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${path2name(bin)} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 512 * 1024) stderr = stderr.slice(-256 * 1024);
      if (onStderr) onStderr(d.toString());
    });
    child.on('error', (err) => { if (timer) clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path2name(bin)} exited ${code}: ${lastLines(stderr, 6)}`));
    });
  });
}

function path2name(p) { return String(p).split('/').pop(); }
function lastLines(s, n) { return s.trim().split('\n').slice(-n).join(' | ').slice(0, 600); }

export async function ffmpeg(args, opts = {}) {
  const { stderr } = await run(FFMPEG, ['-hide_banner', '-nostdin', '-y', ...args], opts);
  return { stderr };
}

export async function probe(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ], { timeoutMs: 60000 });
  return JSON.parse(stdout);
}

export function summarizeProbe(info) {
  const v = (info.streams || []).find((s) => s.codec_type === 'video');
  const a = (info.streams || []).find((s) => s.codec_type === 'audio');
  return {
    duration: info.format ? parseFloat(info.format.duration) || 0 : 0,
    size: info.format ? parseInt(info.format.size, 10) || 0 : 0,
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    fps: v && v.avg_frame_rate ? evalFps(v.avg_frame_rate) : 0,
    codec: v ? v.codec_name : null,
    hasAudio: Boolean(a),
    audioCodec: a ? a.codec_name : null,
  };
}

function evalFps(rate) {
  const [num, den] = String(rate).split('/').map(Number);
  if (!num) return 0;
  return den ? Math.round((num / den) * 1000) / 1000 : num;
}

export async function extractAudioWav(input, output, { start = 0, duration = null, rate = 16000 } = {}) {
  const args = ['-i', input, '-vn', '-ac', '1', '-ar', String(rate), '-c:a', 'pcm_s16le'];
  if (start > 0) args.push('-ss', String(start));
  if (duration) args.push('-t', String(duration));
  args.push(output);
  await ffmpeg(args, { timeoutMs: 10 * 60 * 1000 });
  return output;
}

export async function extractPoster(input, output, atSec = 1) {
  await ffmpeg([
    '-ss', String(Math.max(0, atSec)), '-i', input,
    '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', output,
  ], { timeoutMs: 120000 });
  return output;
}

export async function fileExists(p) {
  try { await fsStat(p); return true; } catch { return false; }
}
import { stat as fsStat } from 'node:fs/promises';
