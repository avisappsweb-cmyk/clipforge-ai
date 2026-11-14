import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { Spinner, ErrorBox, StatusBadge, fmtBytes, fmtDate, useToast } from '../components/ui.jsx';

export default function Admin() {
  const { user } = useAuth();
  const toast = useToast();
  const [ov, setOv] = useState(null);
  const [users, setUsers] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [form, setForm] = useState({});

  const load = () => {
    api('/api/admin/overview').then((r) => { setOv(r); setForm({ ...r.settings }); }).catch((e) => setError(e.message));
    api('/api/admin/users').then((r) => setUsers(r.users)).catch(() => {});
    api('/api/admin/jobs?limit=25').then((r) => setJobs(r.jobs)).catch(() => {});
    api('/api/admin/audit').then((r) => setAudit(r.audit)).catch(() => {});
  };
  useEffect(load, []);

  if (user && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!ov) return <Spinner label="Loading admin console…" />;

  const saveSettings = async () => {
    try {
      const body = {};
      for (const [k, v] of Object.entries(form)) if (v !== '' && v !== null) body[k] = +v;
      await api('/api/admin/settings', { method: 'PUT', body });
      toast('Platform limits updated', 'ok');
      load();
    } catch (err) { toast(err.message, 'err'); }
  };

  const setUserField = async (uid, patch) => {
    try {
      await api(`/api/admin/users/${uid}`, { method: 'PATCH', body: patch });
      load();
      toast('User updated', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  };

  const TABS = [['overview', 'Overview'], ['users', 'Users'], ['jobs', 'Jobs'], ['limits', 'Limits'], ['audit', 'Audit log']];

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: '1.7rem', marginBottom: 0 }}>Admin console</h1>
          <p className="muted" style={{ margin: 0 }}>Platform health, users and limits. Restricted to administrators.</p>
        </div>
        <span className="badge violet">role: admin</span>
      </div>

      <div className="row wrap" style={{ marginBottom: 16 }}>
        {TABS.map(([id, label]) => (
          <button key={id} className={`btn sm ${tab === id ? 'primary' : 'ghost'}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid stats" style={{ marginBottom: 18 }}>
            <div className="glass stat"><div className="num">{ov.counts.users}</div><div className="lbl">users</div></div>
            <div className="glass stat"><div className="num">{ov.counts.videos}</div><div className="lbl">videos</div></div>
            <div className="glass stat"><div className="num">{ov.counts.clips}</div><div className="lbl">clips</div></div>
            <div className="glass stat"><div className="num">{ov.counts.renderedClips}</div><div className="lbl">rendered MP4s</div></div>
            <div className="glass stat"><div className="num" style={{ color: ov.counts.jobsFailed ? 'var(--danger)' : undefined }}>{ov.counts.jobsFailed}</div><div className="lbl">failed jobs</div></div>
            <div className="glass stat"><div className="num">{ov.counts.jobsQueued + ov.counts.jobsRunning}</div><div className="lbl">jobs in flight</div></div>
          </div>
          <div className="grid c2">
            <div className="glass sheen panel">
              <h2 style={{ fontSize: '1rem' }}>Storage</h2>
              <div className="row between" style={{ padding: '6px 0' }}><span className="muted">Total media</span><span className="mono">{fmtBytes(ov.storage.totalBytes)}</span></div>
              <div className="row between" style={{ padding: '6px 0' }}><span className="muted">Source videos</span><span className="mono">{fmtBytes(ov.storage.videosBytes)}</span></div>
              <div className="row between" style={{ padding: '6px 0' }}><span className="muted">Rendered clips</span><span className="mono">{fmtBytes(ov.storage.clipsBytes)}</span></div>
              <div className="row between" style={{ padding: '6px 0' }}><span className="muted">Exports</span><span className="mono">{fmtBytes(ov.storage.exportsBytes)}</span></div>
              <div className="dim" style={{ marginTop: 8 }}>Host: {ov.storage.host.hostname} · {ov.storage.host.cpus} CPUs</div>
            </div>
            <div className="glass sheen panel">
              <h2 style={{ fontSize: '1rem' }}>AI services</h2>
              <div className="row wrap" style={{ gap: 8 }}>
                {ov.asrProviders.length
                  ? ov.asrProviders.map((p) => <span key={p} className="badge ok">{p}</span>)
                  : <span className="badge err">No ASR provider configured</span>}
              </div>
              <div className="dim" style={{ marginTop: 10 }}>
                Environment: {ov.env} · media retention {ov.retentionDays} days.
                Providers are modular — swap via environment variables without code changes.
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'users' && (
        <div className="glass panel" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Storage</th><th>Joined</th><th></th></tr></thead>
            <tbody>
              {(users || []).map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.name}</td>
                  <td><span className={`badge ${u.role === 'admin' ? 'violet' : ''}`}>{u.role}</span></td>
                  <td><StatusBadge status={u.status} /></td>
                  <td className="mono dim">{fmtBytes(u.storage_used)}</td>
                  <td className="dim">{fmtDate(u.created_at)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {u.id !== user.id && (
                      <>
                        <button className="btn sm ghost" onClick={() => setUserField(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}>
                          {u.role === 'admin' ? 'Demote' : 'Make admin'}
                        </button>{' '}
                        <button className="btn sm danger" onClick={() => setUserField(u.id, { status: u.status === 'active' ? 'suspended' : 'active' })}>
                          {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="glass panel" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Type</th><th>Status</th><th>User</th><th>Stage</th><th>Created</th><th>Error</th></tr></thead>
            <tbody>
              {(jobs || []).map((j) => (
                <tr key={j.id}>
                  <td><span className="badge violet">{j.type}</span></td>
                  <td><StatusBadge status={j.status} /></td>
                  <td className="dim">{j.user_email || '—'}</td>
                  <td className="mono dim">{j.stage} {j.progress}%</td>
                  <td className="dim">{fmtDate(j.created_at)}</td>
                  <td className="dim" style={{ color: 'var(--danger)', maxWidth: 280, overflowWrap: 'anywhere' }}>{j.error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'limits' && (
        <div className="glass sheen panel" style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: '1rem' }}>Platform limits</h2>
          <p className="dim" style={{ marginTop: 0 }}>Blank fields keep defaults. Changes apply to new jobs immediately.</p>
          {[
            ['limits.defaultClipsPerVideo', 'Default clips per video'],
            ['limits.maxConcurrentJobs', 'Max concurrent worker jobs'],
            ['limits.maxUploadMb', 'Max upload size (MB)'],
            ['limits.maxDurationSec', 'Max video duration (sec)'],
          ].map(([key, label]) => (
            <label className="field" key={key}>
              <span className="lbl">{label}</span>
              <input className="input" type="number" value={form[key] ?? ''} placeholder={`default ${ov.defaults[key.split('.')[1]] ?? '—'}`}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </label>
          ))}
          <button className="btn primary" onClick={saveSettings}>Save limits</button>
        </div>
      )}

      {tab === 'audit' && (
        <div className="glass panel" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody>
              {(audit || []).map((a) => (
                <tr key={a.id}>
                  <td className="dim" style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.created_at)}</td>
                  <td className="dim">{a.user_email || '—'}</td>
                  <td><span className="badge">{a.action}</span></td>
                  <td className="mono dim" style={{ maxWidth: 380, overflowWrap: 'anywhere' }}>{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
