import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { useAuth } from '../App.jsx';
import { ErrorBox } from '../components/ui.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      setToken(r.token);
      setUser(r.user);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '8vh auto 0' }}>
      <div className="glass glow sheen panel">
        <h2 style={{ fontSize: '1.5rem' }}>Welcome back</h2>
        <p className="muted" style={{ marginTop: 0 }}>Sign in to your CLIPFORGE studio.</p>
        {error && <ErrorBox>{error}</ErrorBox>}
        <form onSubmit={submit}>
          <label className="field">
            <span className="lbl">Email</span>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@studio.com" autoComplete="email" />
          </label>
          <label className="field">
            <span className="lbl">Password</span>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </label>
          <button className="btn primary lg" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="muted" style={{ textAlign: 'center', marginBottom: 0 }}>
          New here? <Link to="/register" style={{ color: 'var(--blue-bright)' }}>Create an account</Link>
        </p>
      </div>
    </div>
  );
}
