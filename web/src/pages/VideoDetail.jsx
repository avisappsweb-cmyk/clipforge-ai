import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Spinner, Empty, ErrorBox, StatusBadge, ScoreRing, fmtDur, fmtDate, useToast } from '../components/ui.jsx';

export default function VideoDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [clipCount, setClipCount] = useState(4);
  const [language, setLanguage] = useState('en');
  const [meta, setMeta] = useState(null);
  const videoRef = useRef(null);
  const [playAt, setPlayAt] = useState(null);

  const load = () => api(`/api/videos/${id}`).then((d) => { setData(d); setLanguage(d.video.language || 'en'); }).catch((e) => setError(e.message));
  useEffect(() => { load(); api('/api/meta').then(setMeta).catch(() => {}); }, [id]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!data) return;
      const active = data.jobs?.some((j) => j.status === 'running' || j.status === 'queued');
      if (active) api(`/api/videos/${id}`).then(setData).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [data, id]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Spinner label="Loading video…" />;
  const { video, transcript, analysis, clips, jobs } = data;

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      await api(`/api/videos/${video.id}/analyze`, { method: 'POST', body: { clipCount, language } });
      toast('Analysis started — this runs in the background', 'ok');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const seek = (t) => {
    setPlayAt(t);
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      videoRef.current.play().catch(() => {});
    }
  };

  const activeJob = jobs?.find((j) => j.status === 'running' || j.status === 'queued');

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div className="dim"><Link to={`/projects/${video.project_id}`} style={{ color: 'var(--ink-3)' }}>Project</Link> / video</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 4, overflowWrap: 'anywhere' }}>{video.orig_name}</h1>
          <div className="dim">
            {fmtDur(video.duration_sec)} · {video.width}×{video.height} · {video.fps} fps · {video.size_mb} MB
          </div>
        </div>
        <StatusBadge status={video.status} />
      </div>

      {activeJob && (
        <div className="glass panel" style={{ marginBottom: 18 }}>
          <div className="row between wrap" style={{ marginBottom: 8 }}>
            <span className="badge violet">{activeJob.type === 'analyze' ? 'AI analysis' : 'Rendering'}</span>
            <span className="dim mono">{activeJob.stage} · {activeJob.progress}%</span>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${activeJob.progress}%` }} /></div>
        </div>
      )}
      {video.status === 'failed' && video.error && <ErrorBox>Processing failed: {video.error}</ErrorBox>}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)' }}>
        <div className="glass sheen panel" style={{ alignSelf: 'start' }}>
          <div className={`stage r169`}>
            <video ref={videoRef} src={video.mediaUrl} controls preload="metadata" playsInline />
          </div>
        </div>

        <div className="glass sheen panel">
          <h2 style={{ fontSize: '1.05rem' }}>AI analysis</h2>
          {!analysis || video.status === 'uploaded' || video.status === 'failed' ? (
            <>
              <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
                Run analysis to transcribe the audio, detect scenes and rank the most engaging moments.
              </p>
              <label className="field">
                <span className="lbl">Language</span>
                <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {(meta?.languages || [{ code: 'en', name: 'English' }]).map((l) => (
                    <option key={l.code} value={l.code}>{l.name}{l.local ? '' : ' (cloud provider)'}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="lbl">Clips to generate: {clipCount}</span>
                <input type="range" min="1" max={meta?.limits?.maxClipsPerVideo || 8} value={clipCount} onChange={(e) => setClipCount(+e.target.value)} />
              </label>
              <button className="btn primary" style={{ width: '100%' }} onClick={analyze} disabled={analyzing || Boolean(activeJob)}>
                {analyzing || activeJob ? 'Working…' : '✦ Analyze video'}
              </button>
            </>
          ) : (
            <>
              <div className="grid stats" style={{ marginBottom: 14 }}>
                <div className="glass stat"><div className="num">{analysis.stats?.wordCount ?? '—'}</div><div className="lbl">words transcribed</div></div>
                <div className="glass stat"><div className="num">{analysis.stats?.speechCoverage ?? '—'}%</div><div className="lbl">speech coverage</div></div>
                <div className="glass stat"><div className="num">{analysis.stats?.sceneCount ?? '—'}</div><div className="lbl">scenes detected</div></div>
              </div>
              <div className="dim" style={{ marginBottom: 10 }}>
                Transcription by <b>{transcript?.provider}</b> · language {transcript?.language}
                {transcript?.diarization === 'provider' ? ' · speakers identified' : ''}
              </div>
              {analysis.stats?.transcriptNote && <div className="errbox">{analysis.stats.transcriptNote}</div>}
              <button className="btn" style={{ width: '100%' }} onClick={analyze} disabled={Boolean(activeJob)}>
                ↻ Re-run analysis
              </button>
            </>
          )}
        </div>
      </div>

      {transcript?.text && (
        <div className="glass sheen panel" style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: '1.05rem' }}>Transcript</h2>
          <p className="dim" style={{ marginTop: 0 }}>Click a segment to jump to that moment. Generated by speech recognition — never manually edited or invented.</p>
          <div className="transcript">
            {transcript.segments.map((s, i) => {
              const on = playAt !== null && playAt >= s.start && playAt <= s.end;
              return (
                <div key={i} className={`seg ${on ? 'on' : ''}`} onClick={() => seek(s.start)}>
                  <span className="t mono">{fmtDur(s.start)}</span>{s.text}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {analysis?.highlights?.length > 0 && (
        <div className="glass sheen panel" style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: '1.05rem' }}>Ranked moments — engagement potential</h2>
          <p className="dim" style={{ marginTop: 0 }}>
            Explainable 0–100 estimates from measurable signals (hook, clarity, pacing, emotion, context, shareability).
            These are predictions, not guarantees.
          </p>
          <div className="grid c2">
            {analysis.highlights.map((h, i) => (
              <div key={i} className="glass panel" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <ScoreRing score={h.score} />
                <div style={{ minWidth: 0 }}>
                  <div className="mono dim">{fmtDur(h.start)} – {fmtDur(h.end)} ({Math.round(h.end - h.start)}s)</div>
                  <div className="muted" style={{ margin: '6px 0 8px', fontSize: '0.86rem', lineHeight: 1.45 }}>
                    {(h.text || '').slice(0, 120)}{(h.text || '').length > 120 ? '…' : ''}
                  </div>
                  <button className="btn sm" onClick={() => seek(h.start)}>▶ Preview</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {clips?.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Clips</h2>
          <div className="grid c3">
            {clips.map((c) => (
              <Link key={c.id} to={`/clips/${c.id}/edit`} className="glass sheen clipcard">
                {c.posterUrl ? <img className="thumb" src={c.posterUrl} alt="" loading="lazy" /> : <div className="thumb" style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>◌</div>}
                <div className="body">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                    <div className="dim">{fmtDur(c.duration_sec)} · {c.aspect} · {c.theme}</div>
                  </div>
                  <div className="spacer" />
                  <ScoreRing score={c.score} size={52} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
