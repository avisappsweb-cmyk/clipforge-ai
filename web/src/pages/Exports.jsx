import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Spinner, Empty, ErrorBox, fmtDur, fmtDate, fmtBytes, ScoreRing } from '../components/ui.jsx';

export default function Exports() {
  const [exports, setExports] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/exports').then((r) => setExports(r.exports)).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!exports) return <Spinner label="Loading export history…" />;

  return (
    <div>
      <h1 style={{ fontSize: '1.7rem', marginBottom: 4 }}>Export history</h1>
      <p className="muted" style={{ marginTop: 0 }}>Every rendered MP4, with its source clip and render settings.</p>

      {exports.length === 0 ? (
        <Empty icon="⬇" title="Nothing exported yet">
          Render a clip from the editor and it will appear here as a downloadable MP4.
        </Empty>
      ) : (
        <div className="glass panel" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Clip</th><th>Score</th><th>Format</th><th>Size</th><th>Rendered</th><th></th>
              </tr>
            </thead>
            <tbody>
              {exports.map((e) => (
                <tr key={e.id}>
                  <td style={{ maxWidth: 260 }}>
                    <Link to={`/clips/${e.clip_id}/edit`} style={{ color: 'var(--ink-1)', textDecoration: 'none', fontWeight: 600 }}>
                      {e.clip_title || 'Untitled'}
                    </Link>
                    <div className="dim">{fmtDur(e.start_sec ?? 0)}</div>
                  </td>
                  <td><ScoreRing score={e.score} size={44} /></td>
                  <td className="dim">{e.aspect} · {e.theme}<br />{e.settings?.quality}p{e.settings?.fps}</td>
                  <td>{e.size_mb} MB</td>
                  <td className="dim">{fmtDate(e.finished_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {e.downloadUrl
                      ? <a className="btn sm primary" href={e.downloadUrl}>⬇ MP4</a>
                      : <span className="badge err">{e.status}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
