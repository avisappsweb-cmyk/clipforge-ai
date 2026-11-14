import path from 'node:path';
import fs from 'node:fs';
import { db, audit } from '../db.js';
import { MEDIA_DIR } from '../config.js';
import { newId } from '../util/ids.js';
import { hashPassword, verifyPassword, signToken, publicUser, requireAuth } from '../auth.js';
import { rateLimit } from '../services/ratelimit.js';
import { config } from '../config.js';

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, key: 'auth' });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerAuthRoutes(app) {
  app.post('/api/auth/register', { preHandler: authLimit }, async (req, reply) => {
    const { email, password, name } = req.body || {};
    if (!email || !EMAIL_RE.test(String(email))) {
      return reply.code(422).send({ error: 'A valid email address is required.' });
    }
    if (!password || String(password).length < 8) {
      return reply.code(422).send({ error: 'Password must be at least 8 characters.' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email));
    if (existing) {
      return reply.code(409).send({ error: 'An account with this email already exists.' });
    }
    const id = newId('usr');
    db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
      .run(id, String(email).trim(), hashPassword(String(password)), String(name || '').slice(0, 80) || String(email).split('@')[0], 'user');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    audit(id, 'user.register', { email });
    reply.code(201).send({ token: signToken(user), user: publicUser(user) });
  });

  app.post('/api/auth/login', { preHandler: authLimit }, async (req, reply) => {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || ''));
    if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
      return reply.code(401).send({ error: 'Invalid email or password.' });
    }
    if (user.status !== 'active') {
      return reply.code(403).send({ error: 'This account has been suspended.' });
    }
    audit(user.id, 'user.login', {});
    reply.send({ token: signToken(user), user: publicUser(user) });
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    return { user: publicUser(req.user) };
  });

  app.patch('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const { name, password, currentPassword } = req.body || {};
    if (name !== undefined) {
      db.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(String(name).slice(0, 80), req.user.id);
    }
    if (password !== undefined) {
      if (String(password).length < 8) {
        return reply.code(422).send({ error: 'Password must be at least 8 characters.' });
      }
      if (!currentPassword || !verifyPassword(String(currentPassword), req.user.password_hash)) {
        return reply.code(403).send({ error: 'Current password is incorrect.' });
      }
      db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
        .run(hashPassword(String(password)), req.user.id);
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    reply.send({ user: publicUser(user) });
  });

  app.delete('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const { password } = req.body || {};
    if (!password || !verifyPassword(String(password), req.user.password_hash)) {
      return reply.code(403).send({ error: 'Password confirmation required to delete your account.' });
    }
    if (req.user.role === 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'").get().n <= 1) {
      return reply.code(409).send({ error: 'Cannot delete the last administrator account.' });
    }
    deleteUserData(req.user.id);
    audit(req.user.id, 'user.deleted', { email: req.user.email });
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    reply.code(204).send();
  });
}

export function deleteUserData(userId) {
  const videoRows = db.prepare('SELECT stored_name FROM videos WHERE user_id = ?').all(userId);
  const clipRows = db.prepare('SELECT output_path, poster_path FROM clips WHERE user_id = ?').all(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  for (const v of videoRows) safeUnlink(path.join(MEDIA_DIR, 'videos', v.stored_name));
  for (const c of clipRows) {
    if (c.output_path) safeUnlink(path.join(MEDIA_DIR, c.output_path));
    if (c.poster_path) safeUnlink(path.join(MEDIA_DIR, c.poster_path));
  }
}

function safeUnlink(p) {
  try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
}
