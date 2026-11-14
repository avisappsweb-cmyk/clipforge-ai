import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Spinner, Empty, ErrorBox, StatusBadge, fmtDur, fmtDate } from '../components/ui.jsx';

export default function Dashboard() {
  const [projects, setProjects] = useState(null);
  const [clips, setClips] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = () => {
    api('/api/projects').then((r) => setProjects(r.projects)).catch((e) => setError(e.message));
    api('/api/clips?limit=8').then((r) => setClips(r.clips)).catch(() => {});
    api('/api/jobs?limit=6').then((r) => setJobs(r.jobs)).catch(() => {});
  };
  useEffect(load, []);

  const createProject = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/api/projects', { method: 'POST', body: { name } });
      navigate(`/projects/${r.project.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!projects) return <Spinner label="Loading your studio…" />;

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: '1.7rem' }}>Your studio</h1>
          <p className="muted" style={{ margin: 0 }}>Projects, recent clips and processing jobs.</p>
        </div>
        <button className="btn primary" onClick={() => setShowNew((s) => !s)}>+ New project</button>
      </div>

      {showNew && (
        <form className="glass panel" style={{ marginBottom: 18 }} onSubmit={createProject}>
          <div className="row wrap">
            <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="Project name — e.g. Podcast S2E14" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      <section style={{ marginBottom: 30 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Projects</h2>
        {projects.length === 0 ? (
          <Empty icon="◈" title="No projects yet">
            Create your first project, then upload a video. CLIPFORGE will find the best moments for you.
          </Empty>
        ) : (
          <div className="grid c3">
            {projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="glass sheen clipcard" style={{ padding: 18 }}>
                <h3 style={{ fontSize: '1.02rem', marginBottom: 4 }}>{p.name}</h3>
                <div className="dim">{p.video_count} video{p.video_count === 1 ? '' : 's'} · {p.clip_count} clip{p.clip_count === 1 ? '' : 's'}</div>
                <div className="dim" style={{ marginTop: 8 }}>Updated {fmtDate(p.updated_at)}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginBottom: 30 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Recent clips</h2>
        {!clips ? <Spinner /> : clips.length === 0 ? (
          <Empty icon="▣" title="No clips yet">Upload a video and run AI analysis — generated clips will appear here.</Empty>
        ) : (
          <div className="grid c3">
            {clips.map((c) => (
              <Link key={c.id} to={`/clips/${c.id}/edit`} className="glass sheen clipcard">
                {c.posterUrl ? (
                  <img className="thumb" src={c.posterUrl} alt="" loading="lazy" />
                ) : (
                  <div className="thumb" style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>
                    {c.status === 'ready' ? '' : '◌'}
                  </div>
                )}
                <div className="body">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                    <div className="dim">{fmtDur(c.duration_sec)} · {c.aspect}</div>
                  </div>
                  <div className="spacer" />
                  <StatusBadge status={c.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: '1.1rem' }}>Processing jobs</h2>
        {!jobs ? <Spinner /> : jobs.length === 0 ? (
          <Empty icon="◍" title="No jobs yet">Analysis and rendering jobs will show up here with live progress.</Empty>
        ) : (
          <div className="glass panel">
            {jobs.map((j) => (
              <div key={j.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="row between wrap">
                  <div className="row">
                    <span className="badge violet">{j.type}</span>
                    <StatusBadge status={j.status} />
                    <span className="dim">{fmtDate(j.created_at)}</span>
                  </div>
                  <span className="dim mono">{j.stage} {j.progress}%</span>
                </div>
                {j.status === 'running' && (
                  <div className="progress-track" style={{ marginTop: 8 }}>
                    <div className="progress-fill" style={{ width: `${j.progress}%` }} />
                  </div>
                )}
                {j.error && <div className="dim" style={{ color: 'var(--danger)', marginTop: 6 }}>{j.error}</div>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
