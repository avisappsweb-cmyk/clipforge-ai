import fs from 'node:fs';
import path from 'node:path';
import { VENDOR_DIR } from '../config.js';
import { ffmpeg } from './ffmpeg.js';
import { buildAss } from './ass.js';
import { computeTrackingKeyframes, buildCropExpression } from './reframing.js';
import { WORK_DIR } from '../config.js';

export const ASPECTS = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
};

export const RESOLUTIONS = { 720: 0.6667, 1080: 1 };

export const FONTS_DIR = path.join(VENDOR_DIR, 'fonts');

export function targetSize(aspect, quality = 1080) {
  const base = ASPECTS[aspect] || ASPECTS['9:16'];
  const k = RESOLUTIONS[quality] ?? 1;
  const w = Math.round((base.w * k) / 2) * 2;
  const h = Math.round((base.h * k) / 2) * 2;
  return { w, h };
}

export function buildAssFile({ clip, transcript, tmpDir }) {
  const assPath = path.join(tmpDir, `${clip.id}.ass`);
  const words = transcript?.words || [];
  const ass = buildAss({
    words,
    clipStart: clip.start_sec,
    clipEnd: clip.end_sec,
    aspect: clip.aspect,
    theme: clip.theme,
    options: {
      titleCard: clip.caption_style?.titleCard || null,
      lowerThird: clip.caption_style?.lowerThird || null,
      progressBar: clip.caption_style?.progressBar !== false,
      captions: clip.caption_style?.captions !== false,
      karaoke: clip.caption_style?.karaoke !== false,
      progressColor: clip.caption_style?.accent || null,
      fontSizeScale: clip.caption_style?.fontSizeScale || 1,
      position: clip.caption_style?.position || 'bottom',
      grouping: clip.caption_style?.grouping || {},
    },
  });
  fs.writeFileSync(assPath, ass);
  return assPath;
}

export function buildRenderArgs({ inputPath, outputPath, clip, transcript, analysis, quality = 1080, fps = 30, musicPath = null, assPath }) {
  const { w: outW, h: outH } = targetSize(clip.aspect, quality);
  const dur = Math.max(0.5, clip.end_sec - clip.start_sec);

  const keyframes = computeTrackingKeyframes({
    energy: analysis?.energy || null,
    clipStart: clip.start_sec,
    clipEnd: clip.end_sec,
  });

  // Pre-scale to cover the target frame, then crop with the tracking expression.
  const coverScale = `scale='ceil(iw*max(${outW}/iw,${outH}/ih)/2)*2':'ceil(ih*max(${outW}/iw,${outH}/ih)/2)*2'`;
  const cropExpr = buildCropExpression(keyframes, outW, outW, clip.aspect === '16:9' ? 0 : 0.6);
  const cropY = clip.aspect === '16:9' ? `ih` : `(ih-${outH})/2`;

  const filters = [
    'fps=' + fps,
    coverScale,
    `crop=w=${outW}:h=${outH}:x=${cropExpr}:y=${cropY}`,
  ];

  const grade = {
    cinematic: 'eq=contrast=1.04:saturation=1.02',
    bold: 'eq=contrast=1.08:saturation=1.1',
    gaming: 'eq=contrast=1.06:saturation=1.12',
    podcast: 'eq=contrast=1.02:saturation=1.0',
    minimal: 'eq=contrast=1.0:saturation=0.98',
    storytelling: 'eq=contrast=1.03:saturation=1.05:gamma=0.99',
  }[clip.theme];

  if (grade) filters.push(grade);
  if (clip.caption_style?.vignette) filters.push('vignette=PI/5');

  const fontsDir = FONTS_DIR;
  const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  filters.push(`subtitles=filename='${escapedAss}':fontsdir='${fontsDir}'`);

  const audioFilters = ['aresample=48000', 'loudnorm=I=-16:TP=-1.5:LRA=11'];
  let args;
  if (musicPath) {
    args = [
      '-ss', String(clip.start_sec),
      '-t', String(dur),
      '-i', inputPath,
      '-i', musicPath,
      '-filter_complex',
      `[0:v]${filters.join(',')}[v];` +
      `[0:a]${audioFilters.join(',')}[voice];` +
      `[1:a]volume=0.32,aloop=loop=-1:size=2e+09[mus];` +
      `[mus][voice]sidechaincompress=threshold=0.02:ratio=12:attack=30:release=350[duck];` +
      `[duck][voice]amix=inputs=2:duration=first:dropout_transition=0:weights=1 1[aout]`,
      '-map', '[v]', '-map', '[aout]',
    ];
  } else {
    args = [
      '-ss', String(clip.start_sec),
      '-t', String(dur),
      '-i', inputPath,
      '-vf', filters.join(','),
      '-af', audioFilters.join(','),
    ];
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-r', String(fps),
    outputPath
  );
  return args;
}

export async function renderClip({ inputPath, outputPath, clip, transcript, analysis, quality = 1080, fps = 30, musicPath = null, onProgress = null }) {
  const tmpDir = path.join(WORK_DIR, clip.id);
  fs.mkdirSync(tmpDir, { recursive: true });
  const assPath = buildAssFile({ clip, transcript, tmpDir });
  const args = buildRenderArgs({ inputPath, outputPath, clip, transcript, analysis, quality, fps, musicPath, assPath });

  let lastReported = 0;
  await ffmpeg(args, {
    timeoutMs: 60 * 60 * 1000,
    onStderr: (chunk) => {
      if (!onProgress) return;
      for (const m of chunk.matchAll(/time=(\d+):(\d+):([\d.]+)/g)) {
        const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        const pct = Math.min(99, Math.round((t / (clip.end_sec - clip.start_sec)) * 100));
        if (pct > lastReported) {
          lastReported = pct;
          onProgress(pct);
        }
      }
    },
  });
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  return outputPath;
}
