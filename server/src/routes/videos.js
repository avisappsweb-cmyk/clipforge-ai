import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, audit } from '../db.js';
import { newId } from '../util/ids.js';
import { requireAuth } from '../auth.js';
import { MEDIA_DIR, config } from '../config.js';
import { validateUploadMeta, validateMediaFile, ValidationError } from '../services/validation.js';
import { rateLimit } from '../services/ratelimit.js';
import { signedMediaUrl } from '../services/storage.js';
import { registerImportRoutes } from './imports.js';

const uploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, key: 'upload' });

function videoWithMedia(v) {
  if (!v) return null;
  return {
    ...v,
    mediaUrl: v.status !== 'failed' ? signedMediaUrl('video', v.id) : null,
    size_mb: Math.round((v.size_bytes / 1024 / 1024) * 10) / 10,
  };
}

export function registerVideoRoutes(app) {
  registerImportRoutes(app);

  app.post('/api/projects/:id/videos', { preHandler: [requireAuth, uploadLimit] }, async (req, reply) => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });

    const file = await req.file({
      limits: { fileSize: config.limits.maxUploadBytes, files: 1 },
    });
    if (!file) return reply.code(422).send({ error: 'No file received. Attach a video file in the "file" field.' });

    const ext = path.extname(file.filename || '').toLowerCase();
    try {
      validateUploadMeta({ filename: file.filename, mime: file.mimetype, size: 0 });
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message });
    }

    const id = newId('vid');
    const storedName = `${id}${ext}`;
    const dest = path.join(MEDIA_DIR, 'videos', storedName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    let total = 0;
    const hash = crypto.createHash('sha256');
    const ws = fs.createWriteStream(dest);
    await new Promise((resolve, reject) => {
      file.file.on('data', (chunk) => {
        total += chunk.length;
        hash.update(chunk);
        if (total > config.limits.maxUploadBytes) {
          file.file.destroy();
          reject(new ValidationError(`File exceeds the ${Math.round(config.limits.maxUploadBytes / 1024 / 1024)} MB upload limit.`));
        }
      });
      file.file.pipe(ws);
      file.file.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
    }).catch(async (err) => {
      try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
      throw err;
    });

    try {
      const summary = await validateMediaFile(dest);
      db.prepare(`
        INSERT INTO videos (id, project_id, user_id, orig_name, stored_name, mime, size_bytes, duration_sec, width, height, fps, has_audio, status, source, language)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', 'upload', ?)
      `).run(
        id, project.id, req.user.id, file.filename.slice(0, 200), storedName, file.mimetype || '',
        total, summary.duration, summary.width, summary.height, summary.fps, summary.has_audio ? 1 : 0,
        String(req.query.language || 'en')
      );
      db.prepare('UPDATE users SET storage_used = storage_used + ? WHERE id = ?').run(total, req.user.id);
      const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
      audit(req.user.id, 'video.uploaded', { id, size: total, duration: summary.duration });
      reply.code(201).send({ video: videoWithMedia(video) });
    } catch (err) {
      try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
      if (err instanceof ValidationError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get('/api/videos/:id', { preHandler: requireAuth }, async (req, reply) => {
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!video) return reply.code(404).send({ error: 'Video not found.' });
    const transcript = db.prepare('SELECT * FROM transcripts WHERE video_id = ?').get(video.id);
    const analysis = db.prepare('SELECT * FROM analyses WHERE video_id = ?').get(video.id);
    const clipRows = db.prepare('SELECT * FROM clips WHERE video_id = ? ORDER BY score DESC').all(video.id);
    const clips = clipRows.map((c) => ({
      ...c,
      score_reasons: JSON.parse(c.score_reasons || '[]'),
      caption_style: JSON.parse(c.caption_style || '{}'),
      mediaUrl: c.status === 'ready' ? signedMediaUrl('clip', c.id) : null,
      posterUrl: c.poster_path ? signedMediaUrl('poster', c.id) : null,
      duration_sec: Math.round((c.end_sec - c.start_sec) * 100) / 100,
    }));
    const jobs = db.prepare('SELECT * FROM jobs WHERE video_id = ? ORDER BY created_at DESC LIMIT 5').all(video.id);
    return {
      video: videoWithMedia(video),
      transcript: transcript ? {
        language: transcript.language,
        provider: transcript.provider,
        text: transcript.text,
        segments: JSON.parse(transcript.segments || '[]'),
        words: JSON.parse(transcript.words || '[]'),
        speakers: JSON.parse(transcript.speakers || '[]'),
        diarization: transcript.diarization,
      } : null,
      analysis: analysis ? {
        provider: analysis.provider,
        scenes: JSON.parse(analysis.scenes || '[]'),
        highlights: JSON.parse(analysis.highlights || '[]'),
        stats: JSON.parse(analysis.stats || '{}'),
      } : null,
      clips,
      jobs,
    };
  });

  app.delete('/api/videos/:id', { preHandler: requireAuth }, async (req, reply) => {
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!video) return reply.code(404).send({ error: 'Video not found.' });
    const clips = db.prepare('SELECT output_path, poster_path FROM clips WHERE video_id = ?').all(video.id);
    db.prepare('DELETE FROM videos WHERE id = ?').run(video.id);
    try { fs.rmSync(path.join(MEDIA_DIR, 'videos', video.stored_name), { force: true }); } catch { /* ignore */ }
    for (const c of clips) {
      if (c.output_path) { try { fs.rmSync(path.join(MEDIA_DIR, c.output_path), { force: true }); } catch { /* ignore */ } }
      if (c.poster_path) { try { fs.rmSync(path.join(MEDIA_DIR, c.poster_path), { force: true }); } catch { /* ignore */ } }
    }
    db.prepare('UPDATE users SET storage_used = MAX(0, storage_used - ?) WHERE id = ?').run(video.size_bytes, req.user.id);
    audit(req.user.id, 'video.deleted', { id: video.id });
    reply.code(204).send();
  });

  app.post('/api/videos/:id/analyze', { preHandler: requireAuth }, async (req, reply) => {
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!video) return reply.code(404).send({ error: 'Video not found.' });
    if (video.status === 'analyzing' || video.status === 'queued') {
      return reply.code(409).send({ error: 'This video is already being processed.' });
    }
    const { language, clipCount, autoClip, asrProvider } = req.body || {};
    if (language) {
      db.prepare("UPDATE videos SET language = ?, updated_at = datetime('now') WHERE id = ?").run(String(language), video.id);
    }
    const jobId = newId('job');
    db.prepare("INSERT INTO jobs (id, type, video_id, user_id, payload) VALUES (?, 'analyze', ?, ?, ?)")
      .run(jobId, video.id, req.user.id, JSON.stringify({ clipCount, autoClip, asrProvider }));
    db.prepare("UPDATE videos SET status = 'queued', error = NULL, updated_at = datetime('now') WHERE id = ?").run(video.id);
    audit(req.user.id, 'video.analyze_queued', { id: video.id, jobId });
    reply.code(202).send({ jobId });
  });
}
