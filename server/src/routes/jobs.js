import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { signedMediaUrl, verifyMediaSignature, mediaPath } from '../services/storage.js';
import { MEDIA_DIR, config } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';

export function registerJobRoutes(app) {
  app.get('/api/jobs', { preHandler: requireAuth }, async (req) => {
    const { status, limit = 30 } = req.query;
    let sql = 'SELECT * FROM jobs WHERE user_id = @user';
    const params = { user: req.user.id, limit: Math.min(100, parseInt(limit) || 30) };
    if (status) { sql += ' AND status = @status'; params.status = String(status); }
    sql += ' ORDER BY created_at DESC LIMIT @limit';
    return { jobs: db.prepare(sql).all(params) };
  });

  app.get('/api/jobs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!job) return reply.code(404).send({ error: 'Job not found.' });
    return { job };
  });

  app.post('/api/jobs/:id/retry', { preHandler: requireAuth }, async (req, reply) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!job) return reply.code(404).send({ error: 'Job not found.' });
    if (job.status !== 'failed') return reply.code(409).send({ error: 'Only failed jobs can be retried.' });
    db.prepare("UPDATE jobs SET status = 'queued', error = NULL, progress = 0 WHERE id = ?").run(job.id);
    if (job.type === 'analyze' && job.video_id) {
      db.prepare("UPDATE videos SET status = 'queued', error = NULL WHERE id = ?").run(job.video_id);
    }
    if (job.type === 'render' && job.clip_id) {
      db.prepare("UPDATE clips SET status = 'queued', error = NULL WHERE id = ?").run(job.clip_id);
    }
    reply.code(202).send({ ok: true });
  });

  app.get('/api/exports', { preHandler: requireAuth }, async (req) => {
    const rows = db.prepare(`
      SELECT e.*, c.title AS clip_title, c.aspect, c.theme, c.score
      FROM exports e JOIN clips c ON c.id = e.clip_id
      WHERE e.user_id = ? ORDER BY e.created_at DESC LIMIT 100
    `).all(req.user.id);
    return {
      exports: rows.map((e) => ({
        ...e,
        settings: JSON.parse(e.settings || '{}'),
        size_mb: Math.round((e.size_bytes / 1024 / 1024) * 10) / 10,
        downloadUrl: e.status === 'ready' ? signedMediaUrl('export', e.id, { download: true, name: `${e.clip_title || 'clip'}.mp4` }) : null,
      })),
    };
  });

  app.get('/api/media/:kind/:id', async (req, reply) => {
    const { kind, id } = req.params;
    const { expires, sig, dl, name } = req.query;
    if (!['video', 'clip', 'poster', 'export'].includes(kind)) {
      return reply.code(400).send({ error: 'Invalid media kind.' });
    }
    if (!verifyMediaSignature(kind, id, expires, sig)) {
      return reply.code(403).send({ error: 'This media link is invalid or has expired.' });
    }
    let p;
    if (kind === 'export') {
      const exp = db.prepare('SELECT file_path FROM exports WHERE id = ?').get(id);
      p = exp?.file_path ? path.join(MEDIA_DIR, exp.file_path) : null;
    } else {
      p = mediaPath(kind, id);
    }
    if (!p || !fs.existsSync(p)) return reply.code(404).send({ error: 'Media file not found.' });
    const stat = fs.statSync(p);
    const range = req.headers.range;
    const ext = path.extname(p);
    const mime = ext === '.jpg' ? 'image/jpeg' : 'video/mp4';
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      const start = m && m[1] ? parseInt(m[1]) : 0;
      let end = m && m[2] ? parseInt(m[2]) : stat.size - 1;
      end = Math.min(end, stat.size - 1);
      if (start >= stat.size) {
        reply.code(416).header('Content-Range', `bytes */${stat.size}`).send();
        return;
      }
      reply.code(206)
        .header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', end - start + 1)
        .header('Content-Type', mime);
      if (dl) reply.header('Content-Disposition', `attachment; filename="${String(name || id).replace(/[^\w.\- ]/g, '_')}"`);
      return reply.send(fs.createReadStream(p, { start, end }));
    }
    reply.header('Accept-Ranges', 'bytes').header('Content-Length', stat.size).header('Content-Type', mime);
    if (dl) reply.header('Content-Disposition', `attachment; filename="${String(name || id).replace(/[^\w.\- ]/g, '_')}"`);
    return reply.send(fs.createReadStream(p));
  });

  app.get('/api/storage/usage', { preHandler: requireAuth }, async (req) => {
    const used = db.prepare('SELECT storage_used FROM users WHERE id = ?').get(req.user.id).storage_used;
    return { usedBytes: used, retentionDays: config.storage.retentionDays };
  });
}
