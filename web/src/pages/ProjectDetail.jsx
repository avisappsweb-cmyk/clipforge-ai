import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api, uploadVideo } from '../api.js';
import { Spinner, Empty, ErrorBox, StatusBadge, fmtDur, fmtDate, useToast } from '../components/ui.jsx';

export default function ProjectDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importMsg, setImportMsg] = useState(null);
  const [adapters, setAdapters] = useState([]);
  const fileInput = useRef(null);
  const toast = useToast();
  const navigate = useNavigate();

  const load = () => {
    api(`/api/projects/${id}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    api('/api/imports/adapters').then((r) => setAdapters(r.adapters)).catch(() => {});
  }, []);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Spinner label="Loading project…" />;
  const { project, videos } = data;

  const doUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const video = await uploadVideo(project.id, file);
      toast('Upload complete — opening video…', 'ok');
      navigate(`/videos/${video.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const doImport = async (e) => {
    e.preventDefault();
    setImportMsg(null);
    try {
      await api('/api/imports/resolve', { method: 'POST', body: { url: importUrl } });
    } catch (err) {
      setImportMsg({ kind: 'err', text: err.message });
    }
  };

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 20 }}>
        <div>
          <div className="dim"><Link to="/dashboard" style={{ color: 'var(--ink-3)' }}>Dashboard</Link> / {project.name}</div>
          <h1 style={{ fontSize: '1.7rem', marginBottom: 0 }}>{project.name}</h1>
        </div>
      </div>

      <div className="glass glow sheen panel" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Add a video</h2>
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); doUpload(e.dataTransfer.files[0]); }}
          role="button"
          aria-label="Upload a video file"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
        >
          {uploading ? (
            <><div className="spinner" style={{ margin: '0 auto 12px' }} /><div className="muted">Uploading and validating…</div></>
          ) : (
            <>
              <div className="icon" aria-hidden="true">⬆</div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Drop a video here or click to browse</div>
              <div className="dim">MP4, MOV, MKV, WEBM — up to your plan's size limit. Media is validated on upload.</div>
            </>
          )}
        </div>
        <input
          ref={fileInput} type="file" accept="video/*" hidden
          onChange={(e) => doUpload(e.target.files[0])}
        />

        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: '0.92rem' }}>Import from a platform</h3>
          <form className="row wrap" onSubmit={doImport}>
            <input
              className="input" style={{ flex: 1, minWidth: 220 }}
              placeholder="Paste a YouTube, Instagram, TikTok, X, Facebook or Twitch link…"
              value={importUrl} onChange={(e) => setImportUrl(e.target.value)}
            />
            <button className="btn">Check link</button>
          </form>
          {importMsg && <div className="errbox">{importMsg.text}</div>}
          <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
            {adapters.map((a) => (
              <span key={a.id} className={`badge ${a.active ? 'ok' : ''}`} title={a.message || 'Authorized import available'}>
                {a.platform} {a.active ? '· authorized' : '· needs API setup'}
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Videos</h2>
      {videos.length === 0 ? (
        <Empty icon="⬆" title="No videos in this project">Upload your first video above to start generating clips.</Empty>
      ) : (
        <div className="grid c2">
          {videos.map((v) => (
            <Link key={v.id} to={`/videos/${v.id}`} className="glass sheen clipcard" style={{ flexDirection: 'row' }}>
              <div style={{ flex: 1, padding: '16px 18px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.orig_name}</div>
                <div className="dim" style={{ marginTop: 4 }}>
                  {fmtDur(v.duration_sec)} · {v.width}×{v.height} · {v.size_mb} MB {v.has_audio ? '· 🔊' : '· silent'}
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <StatusBadge status={v.status} />
                  <span className="dim">{fmtDate(v.created_at)}</span>
                </div>
                {v.error && <div className="dim" style={{ color: 'var(--danger)', marginTop: 8 }}>{v.error}</div>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
