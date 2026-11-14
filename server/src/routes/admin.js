import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { db, audit, getSetting, setSetting } from '../db.js';
import { requireAdmin } from '../auth.js';
import { MEDIA_DIR, config } from '../config.js';
import { availableProviders } from '../ai/asr.js';

const EDITABLE_SETTINGS = {
  'limits.defaultClipsPerVideo': { type: 'int', min: 1, max: config.limits.maxClipsPerVideo },
  'limits.maxConcurrentJobs': { type: 'int', min: 1, max: 8 },
  'limits.maxUploadMb': { type: 'int', min: 16, max: 10240 },
  'limits.maxDurationSec': { type: 'int', min: 60, max: 86400 },
};

function dirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(p);
      else total += fs.statSync(p).size;
    }
  } catch { /* ignore */ }
  return total;
}

export function registerAdminRoutes(app) {
  app.get('/api/admin/overview', { preHandler: requireAdmin }, async () => {
    const counts = {
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      activeUsers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE status='active'").get().n,
      projects: db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,
      videos: db.prepare('SELECT COUNT(*) AS n FROM videos').get().n,
      clips: db.prepare('SELECT COUNT(*) AS n FROM clips').get().n,
      renderedClips: db.prepare("SELECT COUNT(*) AS n FROM clips WHERE status='ready'").get().n,
      failedClips: db.prepare("SELECT COUNT(*) AS n FROM clips WHERE status='failed'").get().n,
      jobsQueued: db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='queued'").get().n,
      jobsRunning: db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='running'").get().n,
      jobsFailed: db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='failed'").get().n,
    };
    const storage = {
      totalBytes: dirSize(MEDIA_DIR),
      videosBytes: dirSize(path.join(MEDIA_DIR, 'videos')),
      clipsBytes: dirSize(path.join(MEDIA_DIR, 'clips')),
      exportsBytes: dirSize(path.join(MEDIA_DIR, 'exports')),
      host: { hostname: os.hostname(), cpus: os.cpus().length, totalMem: os.totalmem() },
    };
    const settings = Object.fromEntries(Object.keys(EDITABLE_SETTINGS).map((k) => [k, getSetting(k, null)]));
    return {
      counts,
      storage,
      settings,
      defaults: config.limits,
      asrProviders: availableProviders(),
      env: config.env,
      retentionDays: config.storage.retentionDays,
    };
  });

  app.get('/api/admin/users', { preHandler: requireAdmin }, async (req) => {
    const { q, limit = 50, offset = 0 } = req.query;
    let sql = 'SELECT id, email, name, role, status, storage_used, created_at FROM users';
    const params = { limit: Math.min(200, parseInt(limit) || 50), offset: parseInt(offset) || 0 };
    if (q) { sql += ' WHERE email LIKE @q OR name LIKE @q'; params.q = `%${String(q)}%`; }
    sql += ' ORDER BY created_at DESC LIMIT @limit OFFSET @offset';
    return { users: db.prepare(sql).all(params) };
  });

  app.patch('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) return reply.code(404).send({ error: 'User not found.' });
    const { role, status } = req.body || {};
    if (role !== undefined && !['user', 'admin'].includes(role)) {
      return reply.code(422).send({ error: 'Role must be "user" or "admin".' });
    }
    if (status !== undefined && !['active', 'suspended'].includes(status)) {
      return reply.code(422).send({ error: 'Status must be "active" or "suspended".' });
    }
    if (target.id === req.user.id && (role === 'user' || status === 'suspended')) {
      return reply.code(409).send({ error: 'You cannot demote or suspend your own admin account.' });
    }
    db.prepare("UPDATE users SET role = COALESCE(?, role), status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?")
      .run(role ?? null, status ?? null, target.id);
    audit(req.user.id, 'admin.user_updated', { target: target.id, role, status });
    reply.send({ user: db.prepare('SELECT id, email, name, role, status, storage_used, created_at FROM users WHERE id = ?').get(target.id) });
  });

  app.get('/api/admin/jobs', { preHandler: requireAdmin }, async (req) => {
    const { status, limit = 50 } = req.query;
    let sql = 'SELECT j.*, u.email AS user_email FROM jobs j LEFT JOIN users u ON u.id = j.user_id';
    const params = { limit: Math.min(200, parseInt(limit) || 50) };
    if (status) { sql += ' WHERE j.status = @status'; params.status = String(status); }
    sql += ' ORDER BY j.created_at DESC LIMIT @limit';
    return { jobs: db.prepare(sql).all(params) };
  });

  app.get('/api/admin/audit', { preHandler: requireAdmin }, async () => {
    const rows = db.prepare(`
      SELECT a.*, u.email AS user_email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC LIMIT 200
    `).all();
    return { audit: rows };
  });

  app.put('/api/admin/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const updates = req.body || {};
    const applied = {};
    for (const [key, spec] of Object.entries(EDITABLE_SETTINGS)) {
      if (updates[key] === undefined) continue;
      let v = Number(updates[key]);
      if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
        return reply.code(422).send({ error: `${key} must be between ${spec.min} and ${spec.max}.` });
      }
      v = Math.round(v);
      setSetting(key, v);
      applied[key] = v;
    }
    if (Object.keys(applied).length) audit(req.user.id, 'admin.settings_updated', applied);
    reply.send({ applied });
  });
}
