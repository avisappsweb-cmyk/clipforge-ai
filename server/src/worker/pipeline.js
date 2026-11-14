import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting } from '../db.js';
import { newId } from '../util/ids.js';
import { MEDIA_DIR, WORK_DIR, config } from '../config.js';
import { extractAudioWav, extractPoster, summarizeProbe, probe } from '../media/ffmpeg.js';
import { transcribe } from '../ai/asr.js';
import { detectScenes, generateHighlights } from '../ai/analysis.js';
import { renderClip } from '../media/render.js';
import { validateMediaFile } from '../services/validation.js';

export function updateJob(jobId, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(typeof v === 'object' ? JSON.stringify(v) : v);
  }
  vals.push(jobId);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function getVideo(id) { return db.prepare('SELECT * FROM videos WHERE id = ?').get(id); }
function getTranscript(videoId) {
  const row = db.prepare('SELECT * FROM transcripts WHERE video_id = ?').get(videoId);
  if (!row) return null;
  return {
    language: row.language,
    provider: row.provider,
    text: row.text,
    words: JSON.parse(row.words || '[]'),
    segments: JSON.parse(row.segments || '[]'),
    speakers: JSON.parse(row.speakers || '[]'),
    diarization: row.diarization,
  };
}
function getAnalysis(videoId) {
  const row = db.prepare('SELECT * FROM analyses WHERE video_id = ?').get(videoId);
  if (!row) return null;
  return {
    provider: row.provider,
    scenes: JSON.parse(row.scenes || '[]'),
    highlights: JSON.parse(row.highlights || '[]'),
    stats: JSON.parse(row.stats || '{}'),
  };
}

async function analyzeVideo(job) {
  const video = getVideo(job.video_id);
  if (!video) throw new Error('Video not found');
  const inputPath = path.join(MEDIA_DIR, 'videos', video.stored_name);
  if (!fs.existsSync(inputPath)) throw new Error('Source media file is missing from storage');

  db.prepare("UPDATE videos SET status = 'analyzing', error = NULL, updated_at = datetime('now') WHERE id = ?").run(video.id);

  updateJob(job.id, { stage: 'validating', progress: 4 });
  const summary = await validateMediaFile(inputPath);
  db.prepare(`UPDATE videos SET duration_sec = ?, width = ?, height = ?, fps = ?, has_audio = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(summary.duration, summary.width, summary.height, summary.fps, summary.has_audio ? 1 : 0, video.id);

  const payload = JSON.parse(job.payload || '{}');
  const language = video.language || 'en';

  let transcript = null;
  let energy = null;
  if (summary.hasAudio) {
    updateJob(job.id, { stage: 'extracting-audio', progress: 10 });
    fs.mkdirSync(WORK_DIR, { recursive: true });
    const wavPath = path.join(WORK_DIR, `${video.id}.wav`);
    await extractAudioWav(inputPath, wavPath);
    try {
      updateJob(job.id, { stage: 'transcribing', progress: 18 });
      transcript = await transcribe(wavPath, { language, preferred: payload.asrProvider || null });
      energy = transcript.energy || null;
      const { words, segments, speakers, ...rest } = transcript;
      db.prepare(`
        INSERT INTO transcripts (video_id, language, provider, text, segments, words, speakers, diarization)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET
          language = excluded.language, provider = excluded.provider, text = excluded.text,
          segments = excluded.segments, words = excluded.words, speakers = excluded.speakers,
          diarization = excluded.diarization
      `).run(
        video.id, transcript.language || language, transcript.provider,
        transcript.text || '', JSON.stringify(segments || []), JSON.stringify(words || []),
        JSON.stringify(speakers || []), transcript.diarization || 'none'
      );
    } finally {
      try { fs.rmSync(wavPath, { force: true }); } catch { /* ignore */ }
    }
  }

  updateJob(job.id, { stage: 'detecting-scenes', progress: 55 });
  const scenes = await detectScenes(inputPath, summary.duration);

  updateJob(job.id, { stage: 'ranking-moments', progress: 70 });
  const targetCount = Math.min(
    config.limits.maxClipsPerVideo,
    payload.clipCount ?? getSetting('limits.defaultClipsPerVideo', config.limits.defaultClipsPerVideo)
  );
  const highlights = generateHighlights({
    transcript,
    energy,
    scenes,
    duration: summary.duration,
    targetCount,
  });

  const stats = {
    wordCount: transcript?.words?.length || 0,
    speechCoverage: transcript?.speech_regions
      ? Math.round((transcript.speech_regions.reduce((a, r) => a + (r.end - r.start), 0) / summary.duration) * 100)
      : 0,
    sceneCount: scenes.length,
    avgWordConfidence: transcript?.words?.length
      ? Math.round((transcript.words.reduce((a, w) => a + (w.conf ?? 0.8), 0) / transcript.words.length) * 100) / 100
      : null,
    diarization: transcript?.diarization || 'none',
    transcriptNote: transcript?.note || null,
  };

  db.prepare(`
    INSERT INTO analyses (video_id, provider, scenes, highlights, stats)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      provider = excluded.provider, scenes = excluded.scenes,
      highlights = excluded.highlights, stats = excluded.stats
  `).run(video.id, transcript?.provider || 'visual-only', JSON.stringify(scenes), JSON.stringify(highlights), JSON.stringify(stats));

  if (payload.autoClip !== false && highlights.length) {
    updateJob(job.id, { stage: 'creating-clips', progress: 88 });
    const insert = db.prepare(`
      INSERT INTO clips (id, video_id, user_id, title, start_sec, end_sec, score, score_reasons, aspect, theme, caption_style, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `);
    const existing = db.prepare('SELECT COUNT(*) AS n FROM clips WHERE video_id = ?').get(video.id).n;
    highlights.forEach((h, i) => {
      const words = transcript?.words || [];
      const firstWords = words.filter((w) => w.end > h.start && w.start < h.start + 8).map((w) => w.word).slice(0, 6).join(' ');
      const title = firstWords ? (firstWords.length > 48 ? firstWords.slice(0, 45) + '…' : firstWords) : `Highlight ${existing + i + 1}`;
      insert.run(
        newId('clip'), video.id, video.user_id, title,
        h.start, h.end, h.score, JSON.stringify({ factors: h.factors, reasons: h.reasons }),
        '9:16', 'cinematic', JSON.stringify({})
      );
    });
  }

  db.prepare("UPDATE videos SET status = 'ready', updated_at = datetime('now') WHERE id = ?").run(video.id);
  updateJob(job.id, { stage: 'done', progress: 100 });
  return { highlights: highlights.length, transcribed: Boolean(transcript) };
}

async function renderClipJob(job) {
  const clip = db.prepare('SELECT * FROM clips WHERE id = ?').get(job.clip_id);
  if (!clip) throw new Error('Clip not found');
  const video = getVideo(clip.video_id);
  if (!video) throw new Error('Source video not found');
  const inputPath = path.join(MEDIA_DIR, 'videos', video.stored_name);
  if (!fs.existsSync(inputPath)) throw new Error('Source media file is missing from storage');

  db.prepare("UPDATE clips SET status = 'rendering', error = NULL, updated_at = datetime('now') WHERE id = ?").run(clip.id);

  const transcript = getTranscript(video.id);
  const analysis = getAnalysis(video.id);
  const payload = JSON.parse(job.payload || '{}');
  const outDir = path.join(MEDIA_DIR, 'clips');
  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `${clip.id}.mp4`);

  updateJob(job.id, { stage: 'rendering', progress: 6 });
  await renderClip({
    inputPath,
    outputPath,
    clip,
    transcript,
    analysis,
    quality: payload.quality || 1080,
    fps: payload.fps || 30,
    musicPath: payload.musicPath || null,
    onProgress: (pct) => updateJob(job.id, { progress: 6 + Math.round(pct * 0.84) }),
  });

  updateJob(job.id, { stage: 'poster', progress: 94 });
  const posterDir = path.join(MEDIA_DIR, 'posters');
  fs.mkdirSync(posterDir, { recursive: true });
  let posterPath = null;
  try {
    posterPath = await extractPoster(outputPath, path.join(posterDir, `${clip.id}.jpg`), Math.min(1, (clip.end_sec - clip.start_sec) / 3));
  } catch { /* poster optional */ }

  const size = fs.statSync(outputPath).size;
  db.prepare(`UPDATE clips SET status = 'ready', output_path = ?, poster_path = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(path.relative(MEDIA_DIR, outputPath), posterPath ? path.relative(MEDIA_DIR, posterPath) : null, clip.id);

  db.prepare(`
    INSERT INTO exports (id, user_id, clip_id, video_id, file_path, size_bytes, settings, status, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', datetime('now'))
  `).run(
    newId('exp'), clip.user_id, clip.id, video.id, path.relative(MEDIA_DIR, outputPath), size,
    JSON.stringify({ aspect: clip.aspect, theme: clip.theme, quality: payload.quality || 1080, fps: payload.fps || 30 })
  );

  updateJob(job.id, { stage: 'done', progress: 100 });
  return { outputPath, size };
}

export async function runJob(job) {
  db.prepare("UPDATE jobs SET status = 'running', started_at = datetime('now'), attempts = attempts + 1 WHERE id = ?").run(job.id);
  try {
    let result;
    if (job.type === 'analyze') result = await analyzeVideo(job);
    else if (job.type === 'render') result = await renderClipJob(job);
    else throw new Error(`Unknown job type: ${job.type}`);
    db.prepare("UPDATE jobs SET status = 'done', finished_at = datetime('now') WHERE id = ?").run(job.id);
    return result;
  } catch (err) {
    const attempts = job.attempts + 1;
    const maxAttempts = 3;
    if (attempts < maxAttempts) {
      db.prepare("UPDATE jobs SET status = 'queued', error = ?, attempts = ?, progress = 0 WHERE id = ?")
        .run(String(err.message || err), attempts, job.id);
    } else {
      db.prepare("UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?")
        .run(String(err.message || err), job.id);
      if (job.type === 'analyze' && job.video_id) {
        db.prepare("UPDATE videos SET status = 'failed', error = ? WHERE id = ?").run(String(err.message || err), job.video_id);
      }
      if (job.type === 'render' && job.clip_id) {
        db.prepare("UPDATE clips SET status = 'failed', error = ? WHERE id = ?").run(String(err.message || err), job.clip_id);
      }
    }
    throw err;
  }
}
