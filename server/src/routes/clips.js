import { db } from '../db.js';
import { newId } from '../util/ids.js';
import { requireAuth } from '../auth.js';
import { signedMediaUrl } from '../services/storage.js';
import { THEMES } from '../media/ass.js';
import { ASPECTS } from '../media/render.js';
import { config } from '../config.js';

function clipOut(c) {
  if (!c) return null;
  return {
    ...c,
    score_reasons: JSON.parse(c.score_reasons || '[]'),
    caption_style: JSON.parse(c.caption_style || '{}'),
    mediaUrl: c.status === 'ready' ? signedMediaUrl('clip', c.id) : null,
    posterUrl: c.poster_path ? signedMediaUrl('poster', c.id) : null,
    duration_sec: Math.round((c.end_sec - c.start_sec) * 100) / 100,
  };
}

const ASPECT_RE = /^(9:16|1:1|16:9)$/;

export function registerClipRoutes(app) {
  app.get('/api/clips', { preHandler: requireAuth }, async (req) => {
    const { status, videoId, limit = 100, offset = 0 } = req.query;
    let sql = `SELECT c.*, v.orig_name AS video_name FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.user_id = @user`;
    const params = { user: req.user.id, limit: Math.min(200, parseInt(limit) || 100), offset: parseInt(offset) || 0 };
    if (status) { sql += ' AND c.status = @status'; params.status = String(status); }
    if (videoId) { sql += ' AND c.video_id = @videoId'; params.videoId = String(videoId); }
    sql += ' ORDER BY c.created_at DESC LIMIT @limit OFFSET @offset';
    const rows = db.prepare(sql).all(params);
    return { clips: rows.map(clipOut) };
  });

  app.get('/api/clips/:id', { preHandler: requireAuth }, async (req, reply) => {
    const clip = db.prepare(`
      SELECT c.*, v.orig_name AS video_name, v.id AS video_id FROM clips c JOIN videos v ON v.id = c.video_id
      WHERE c.id = ? AND c.user_id = ?
    `).get(req.params.id, req.user.id);
    if (!clip) return reply.code(404).send({ error: 'Clip not found.' });
    const transcript = db.prepare('SELECT * FROM transcripts WHERE video_id = ?').get(clip.video_id);
    return {
      clip: clipOut(clip),
      transcript: transcript ? {
        language: transcript.language,
        provider: transcript.provider,
        words: JSON.parse(transcript.words || '[]'),
        segments: JSON.parse(transcript.segments || '[]'),
      } : null,
      themes: themeList(),
      aspects: Object.keys(ASPECTS),
    };
  });

  app.patch('/api/clips/:id', { preHandler: requireAuth }, async (req, reply) => {
    const clip = db.prepare('SELECT * FROM clips WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!clip) return reply.code(404).send({ error: 'Clip not found.' });
    const b = req.body || {};
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(clip.video_id);

    let start = clip.start_sec;
    let end = clip.end_sec;
    if (b.start_sec !== undefined || b.end_sec !== undefined) {
      start = b.start_sec !== undefined ? Number(b.start_sec) : start;
      end = b.end_sec !== undefined ? Number(b.end_sec) : end;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1) {
        return reply.code(422).send({ error: 'Clip must be at least 1 second long.' });
      }
      start = Math.max(0, start);
      end = Math.min(video.duration_sec, end);
      if (end - start > 300) return reply.code(422).send({ error: 'Clips are limited to 5 minutes.' });
    }
    if (b.aspect !== undefined && !ASPECT_RE.test(b.aspect)) {
      return reply.code(422).send({ error: 'Aspect must be one of 9:16, 1:1, 16:9.' });
    }
    if (b.theme !== undefined && !THEMES[b.theme]) {
      return reply.code(422).send({ error: 'Unknown theme.' });
    }

    db.prepare(`
      UPDATE clips SET
        title = COALESCE(?, title),
        start_sec = ?, end_sec = ?,
        aspect = COALESCE(?, aspect),
        theme = COALESCE(?, theme),
        caption_style = COALESCE(?, caption_style),
        is_draft_saved = 1,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.title !== undefined ? String(b.title).slice(0, 120) : null,
      start, end,
      b.aspect ?? null,
      b.theme ?? null,
      b.caption_style !== undefined ? JSON.stringify({ ...clipOut(clip).caption_style, ...b.caption_style }) : null,
      clip.id
    );
    reply.send({ clip: clipOut(db.prepare('SELECT * FROM clips WHERE id = ?').get(clip.id)) });
  });

  app.post('/api/clips/:id/render', { preHandler: requireAuth }, async (req, reply) => {
    const clip = db.prepare('SELECT * FROM clips WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!clip) return reply.code(404).send({ error: 'Clip not found.' });
    if (clip.status === 'rendering' || clip.status === 'queued') {
      return reply.code(409).send({ error: 'This clip is already rendering.' });
    }
    const b = req.body || {};
    const quality = [720, 1080].includes(Number(b.quality)) ? Number(b.quality) : 1080;
    const fps = [24, 30, 60].includes(Number(b.fps)) ? Number(b.fps) : 30;
    const jobId = newId('job');
    db.prepare("INSERT INTO jobs (id, type, video_id, clip_id, user_id, payload) VALUES (?, 'render', ?, ?, ?, ?)")
      .run(jobId, clip.video_id, clip.id, req.user.id, JSON.stringify({ quality, fps }));
    db.prepare("UPDATE clips SET status = 'queued', error = NULL, updated_at = datetime('now') WHERE id = ?").run(clip.id);
    reply.code(202).send({ jobId });
  });

  app.delete('/api/clips/:id', { preHandler: requireAuth }, async (req, reply) => {
    const clip = db.prepare('SELECT * FROM clips WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!clip) return reply.code(404).send({ error: 'Clip not found.' });
    db.prepare('DELETE FROM clips WHERE id = ?').run(clip.id);
    reply.code(204).send();
  });

  app.post('/api/videos/:id/clips/generate', { preHandler: requireAuth }, async (req, reply) => {
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!video) return reply.code(404).send({ error: 'Video not found.' });
    const analysis = db.prepare('SELECT * FROM analyses WHERE video_id = ?').get(video.id);
    if (!analysis) return reply.code(409).send({ error: 'Run AI analysis on this video first.' });
    const highlights = JSON.parse(analysis.highlights || '[]');
    if (!highlights.length) return reply.code(409).send({ error: 'No highlight candidates were detected for this video.' });
    const b = req.body || {};
    const indices = Array.isArray(b.indices) ? b.indices : highlights.map((_, i) => i);
    const insert = db.prepare(`
      INSERT INTO clips (id, video_id, user_id, title, start_sec, end_sec, score, score_reasons, aspect, theme, caption_style, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `);
    const created = [];
    for (const i of indices.slice(0, config.limits.maxClipsPerVideo)) {
      const h = highlights[i];
      if (!h) continue;
      const id = newId('clip');
      const title = (h.text || '').split(/\s+/).slice(0, 6).join(' ') || `Highlight ${i + 1}`;
      insert.run(id, video.id, req.user.id, title.slice(0, 120), h.start, h.end, h.score,
        JSON.stringify({ factors: h.factors, reasons: h.reasons }),
        b.aspect && ASPECT_RE.test(b.aspect) ? b.aspect : '9:16',
        b.theme && THEMES[b.theme] ? b.theme : 'cinematic', '{}');
      created.push(id);
    }
    reply.code(201).send({ created });
  });
}

function themeList() {
  return Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label }));
}
