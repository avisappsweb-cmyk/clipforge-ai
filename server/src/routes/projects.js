import { db, audit } from '../db.js';
import { newId } from '../util/ids.js';
import { requireAuth } from '../auth.js';

export function registerProjectRoutes(app) {
  app.get('/api/projects', { preHandler: requireAuth }, async (req) => {
    const rows = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM videos v WHERE v.project_id = p.id) AS video_count,
        (SELECT COUNT(*) FROM clips c JOIN videos v ON c.video_id = v.id WHERE v.project_id = p.id) AS clip_count
      FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC
    `).all(req.user.id);
    return { projects: rows };
  });

  app.post('/api/projects', { preHandler: requireAuth }, async (req, reply) => {
    const { name, description } = req.body || {};
    if (!name || !String(name).trim()) {
      return reply.code(422).send({ error: 'Project name is required.' });
    }
    const id = newId('prj');
    db.prepare('INSERT INTO projects (id, user_id, name, description) VALUES (?, ?, ?, ?)')
      .run(id, req.user.id, String(name).trim().slice(0, 120), String(description || '').slice(0, 500));
    audit(req.user.id, 'project.created', { id });
    reply.code(201).send({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(id) });
  });

  app.get('/api/projects/:id', { preHandler: requireAuth }, async (req, reply) => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    const videos = db.prepare('SELECT * FROM videos WHERE project_id = ? ORDER BY created_at DESC').all(project.id);
    const clips = db.prepare(`
      SELECT c.*, v.orig_name AS video_name FROM clips c JOIN videos v ON v.id = c.video_id
      WHERE v.project_id = ? ORDER BY c.score DESC
    `).all(project.id);
    return { project, videos, clips };
  });

  app.patch('/api/projects/:id', { preHandler: requireAuth }, async (req, reply) => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    const { name, description } = req.body || {};
    db.prepare("UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = datetime('now') WHERE id = ?")
      .run(name !== undefined ? String(name).trim().slice(0, 120) || null : null,
           description !== undefined ? String(description).slice(0, 500) : null,
           project.id);
    reply.send({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id) });
  });

  app.delete('/api/projects/:id', { preHandler: requireAuth }, async (req, reply) => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    audit(req.user.id, 'project.deleted', { id: project.id });
    reply.code(204).send();
  });
}
