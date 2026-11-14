import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from './config.js';
import { migrate, db, audit } from './db.js';
import { ensureMediaDirs } from './services/storage.js';
import { hashPassword, publicUser } from './auth.js';
import { newId } from './util/ids.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerVideoRoutes } from './routes/videos.js';
import { registerClipRoutes } from './routes/clips.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerAdminRoutes } from './routes/admin.js';
import { LANGUAGES, availableProviders, ASR_CAPABILITIES } from './ai/asr.js';
import { themeNames } from './media/ass.js';
import { ASPECTS, RESOLUTIONS } from './media/render.js';

export function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || (config.env === 'production' ? 'info' : 'warn') },
    bodyLimit: 2 * 1024 * 1024,
  });

  app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    credentials: true,
  });
  app.register(multipart, { attachFieldsToBody: false, limits: { fileSize: config.limits.maxUploadBytes } });

  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    req.log.error(err);
    reply.code(500).send({ error: 'Internal server error. Check the server logs.' });
  });

  app.get('/api/health', async () => ({
    ok: true,
    service: 'clipforge-api',
    env: config.env,
    time: new Date().toISOString(),
  }));

  app.get('/api/meta', async () => ({
    themes: themeNames(),
    aspects: Object.keys(ASPECTS),
    qualities: Object.keys(RESOLUTIONS).map(Number),
    languages: LANGUAGES,
    asr: {
      active: availableProviders(),
      capabilities: ASR_CAPABILITIES,
      note: 'Scores estimate engagement potential from measurable signals. No platform can guarantee virality.',
    },
    limits: {
      maxUploadMb: Math.round(config.limits.maxUploadBytes / 1024 / 1024),
      maxDurationSec: config.limits.maxDurationSec,
      maxClipsPerVideo: config.limits.maxClipsPerVideo,
    },
  }));

  registerAuthRoutes(app);
  registerProjectRoutes(app);
  registerVideoRoutes(app);
  registerClipRoutes(app);
  registerJobRoutes(app);
  registerAdminRoutes(app);

  const distDir = path.resolve(ROOT_DIR, '..', 'web', 'dist');
  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    app.register(fastifyStatic, { root: distDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export function bootstrap() {
  migrate();
  ensureMediaDirs();
  if (config.adminEmail && config.adminPassword) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(config.adminEmail);
    if (!existing) {
      const id = newId('usr');
      db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
        .run(id, config.adminEmail, hashPassword(config.adminPassword), 'Administrator', 'admin');
      console.log(`[bootstrap] created administrator ${config.adminEmail}`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  bootstrap();
  const app = buildApp();
  app.listen({ host: config.host, port: config.port }).then(() => {
    console.log(`[api] CLIPFORGE API listening on ${config.host}:${config.port}`);
  });
}
