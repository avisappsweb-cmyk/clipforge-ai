import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { db } from './db.js';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.secret, {
    expiresIn: config.jwtTtl,
  });
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    storageUsed: u.storage_used,
    createdAt: u.created_at,
  };
}

export function getUserFromRequest(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const payload = jwt.verify(m[1], config.secret);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user || user.status !== 'active') return null;
    return user;
  } catch {
    return null;
  }
}

export function requireAuth(req, reply, done) {
  const user = getUserFromRequest(req);
  if (!user) {
    reply.code(401).send({ error: 'Authentication required' });
    return;
  }
  req.user = user;
  done();
}

export function requireAdmin(req, reply, done) {
  const user = getUserFromRequest(req);
  if (!user) {
    reply.code(401).send({ error: 'Authentication required' });
    return;
  }
  if (user.role !== 'admin') {
    reply.code(403).send({ error: 'Administrator access required' });
    return;
  }
  req.user = user;
  done();
}
