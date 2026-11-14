import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() { return useContext(ToastCtx); }

export function Spinner({ label }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: '28px 0', gap: 12 }}>
      <div className="spinner" aria-hidden="true" />
      {label && <span className="muted">{label}</span>}
    </div>
  );
}

export function Empty({ icon = '◇', title, children }) {
  return (
    <div className="empty">
      <div className="big" aria-hidden="true">{icon}</div>
      <div style={{ fontWeight: 700, color: 'var(--ink-2)', marginBottom: 6 }}>{title}</div>
      <div style={{ maxWidth: 420, margin: '0 auto', lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

export function ErrorBox({ children }) {
  return <div className="errbox" role="alert">{children}</div>;
}

export function ScoreRing({ score, size = 74 }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const hue = score >= 70 ? 'var(--ok)' : score >= 45 ? 'var(--blue-bright)' : 'var(--warn)';
  return (
    <div className="score-ring" style={{ width: size, height: size }} title="Engagement potential score">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="7" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={hue} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <div className="val" style={{ fontSize: size * 0.3 }}>{Math.round(score)}</div>
    </div>
  );
}

export function fmtDur(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtBytes(b) {
  if (!b) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + (d.endsWith('Z') ? '' : 'Z')).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_BADGES = {
  ready: 'ok', done: 'ok', active: 'ok',
  draft: '', queued: 'blue', analyzing: 'blue', rendering: 'blue', running: 'blue', uploaded: 'blue',
  failed: 'err', suspended: 'err',
};
export function StatusBadge({ status }) {
  return <span className={`badge ${STATUS_BADGES[status] || ''}`}>{status}</span>;
}
