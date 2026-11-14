import React, { useEffect, useState } from 'react';
import { api, setToken } from '../api.js';
import { useAuth } from '../App.jsx';
import { Spinner, ErrorBox, fmtBytes, useToast } from '../components/ui.jsx';

export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const [usage, setUsage] = useState(null);
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/storage/usage').then(setUsage).catch(() => {});
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name };
      if (newPassword) { body.password = newPassword; body.currentPassword = currentPassword; }
      const r = await api('/api/auth/me', { method: 'PATCH', body });
      setUser(r.user);
      setCurrentPassword(''); setNewPassword('');
      toast('Profile updated', 'ok');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    const pw = prompt('Type your password to confirm permanent account + media deletion:');
    if (!pw) return;
    try {
      await api('/api/auth/me', { method: 'DELETE', body: { password: pw } });
      logout();
      window.location.href = '/';
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.7rem', marginBottom: 4 }}>Account settings</h1>
      <p className="muted" style={{ marginTop: 0 }}>Signed in as {user?.email}</p>

      {usage && (
        <div className="glass sheen panel" style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: '1rem' }}>Storage</h2>
          <div className="row between" style={{ marginBottom: 8 }}>
            <span className="muted">Used by your media</span>
            <span className="mono">{fmtBytes(usage.usedBytes)}</span>
          </div>
          <div className="dim">Media retention: files are removed {usage.retentionDays} days after their project is deleted, or immediately when you delete them.</div>
        </div>
      )}

      <div className="glass sheen panel">
        <h2 style={{ fontSize: '1rem' }}>Profile</h2>
        {error && <ErrorBox>{error}</ErrorBox>}
        <form onSubmit={saveProfile}>
          <label className="field">
            <span className="lbl">Display name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="field">
              <span className="lbl">Current password (only when changing)</span>
              <input className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            </label>
            <label className="field">
              <span className="lbl">New password</span>
              <input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="min 8 characters" />
            </label>
          </div>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </form>
      </div>

      <div className="glass sheen panel" style={{ marginTop: 18, borderColor: 'rgba(248,113,113,0.3)' }}>
        <h2 style={{ fontSize: '1rem', color: 'var(--danger)' }}>Delete account</h2>
        <p className="muted" style={{ fontSize: '0.88rem' }}>
          Permanently deletes your account, projects, videos, clips and all stored media. This cannot be undone.
        </p>
        <button className="btn danger sm" onClick={deleteAccount}>Delete my account and all media</button>
      </div>
    </div>
  );
}
