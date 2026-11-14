import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Spinner, ErrorBox, StatusBadge, ScoreRing, fmtDur, useToast } from '../components/ui.jsx';

const MAX_LEN_SEC = 300;

export default function Editor() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [clip, setClip] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderJob, setRenderJob] = useState(null);
  const [meta, setMeta] = useState(null);

  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const dragRef = useRef(null);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const saveTimer = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api(`/api/clips/${id}`),
      api('/api/meta').catch(() => null),
    ]).then(([d, m]) => {
      setData(d);
      setClip(d.clip);
      setMeta(m);
    }).catch((e) => setError(e.message));
  }, [id]);

  const words = useMemo(() => {
    if (!data?.transcript?.words) return [];
    return data.transcript.words.filter((w) => w.end > clip?.start_sec && w.start < clip?.end_sec);
  }, [data, clip]);

  const wave = useMemo(() => {
    // Deterministic pseudo-waveform from word timings + fallback pattern.
    if (!clip) return [];
    const n = 90;
    const dur = clip.end_sec - clip.start_sec;
    const arr = new Array(n).fill(0);
    for (const w of words) {
      const a = Math.floor(((w.start - clip.start_sec) / dur) * n);
      const b = Math.ceil(((w.end - clip.start_sec) / dur) * n);
      for (let i = Math.max(0, a); i < Math.min(n, b); i++) arr[i] = Math.max(arr[i], 0.45 + (w.conf || 0.8) * 0.5);
    }
    return arr.map((v, i) => (v > 0 ? v : 0.12 + 0.1 * Math.abs(Math.sin(i * 1.7))));
  }, [words, clip]);

  const pushHistory = useCallback((prev) => {
    historyRef.current.push(JSON.stringify(prev));
    if (historyRef.current.length > 60) historyRef.current.shift();
    futureRef.current = [];
  }, []);

  const update = (patch) => {
    setClip((prev) => {
      pushHistory(prev);
      return { ...prev, ...patch };
    });
    setDirty(true);
  };

  const undo = () => {
    if (!historyRef.current.length) return;
    futureRef.current.push(JSON.stringify(clip));
    const prev = JSON.parse(historyRef.current.pop());
    setClip(prev);
    setDirty(true);
  };
  const redo = () => {
    if (!futureRef.current.length) return;
    historyRef.current.push(JSON.stringify(clip));
    const next = JSON.parse(futureRef.current.pop());
    setClip(next);
    setDirty(true);
  };

  // Autosave (debounced 1.2s)
  useEffect(() => {
    if (!dirty || !clip) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const r = await api(`/api/clips/${clip.id}`, {
          method: 'PATCH',
          body: {
            title: clip.title,
            start_sec: clip.start_sec,
            end_sec: clip.end_sec,
            aspect: clip.aspect,
            theme: clip.theme,
            caption_style: clip.caption_style,
          },
        });
        setClip(r.clip);
        setDirty(false);
      } catch (err) {
        toast(`Autosave failed: ${err.message}`, 'err');
      } finally {
        setSaving(false);
      }
    }, 1200);
    return () => clearTimeout(saveTimer.current);
  }, [clip, dirty]);

  // Poll render job
  useEffect(() => {
    if (!renderJob) return;
    pollRef.current = setInterval(async () => {
      try {
        const { job } = await api(`/api/jobs/${renderJob}`);
        setRenderJob(job.status === 'done' ? null : job.id);
        if (job.status === 'done') {
          toast('Render complete — your MP4 is ready', 'ok');
          const d = await api(`/api/clips/${id}`);
          setData(d); setClip(d.clip);
        } else if (job.status === 'failed') {
          setRenderJob(null);
          toast(`Render failed: ${job.error}`, 'err');
          const d = await api(`/api/clips/${id}`);
          setData(d); setClip(d.clip);
        } else {
          setRenderProgress(job.progress);
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [renderJob, id]);

  const [renderProgress, setRenderProgress] = useState(0);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data || !clip) return <Spinner label="Loading editor…" />;

  const dur = data.video.duration_sec || 1;
  const clipDur = clip.end_sec - clip.start_sec;
  const pct = (t) => (t / dur) * 100;
  const selLeft = pct(clip.start_sec);
  const selWidth = Math.max(1, pct(clipDur));

  const timeFromEvent = (e) => {
    const rect = timelineRef.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return Math.max(0, Math.min(dur, (x / rect.width) * dur));
  };

  const startDrag = (which) => (e) => {
    e.preventDefault();
    dragRef.current = which;
    const move = (ev) => {
      if (!dragRef.current) return;
      const t = timeFromEvent(ev);
      setClip((prev) => {
        pushHistory(prev);
        if (dragRef.current === 'start') {
          const s = Math.min(Math.max(0, t), prev.end_sec - 1);
          return { ...prev, start_sec: Math.round(s * 100) / 100 };
        }
        if (dragRef.current === 'end') {
          const en = Math.max(Math.min(dur, t), prev.start_sec + 1);
          return { ...prev, end_sec: Math.round(en * 100) / 100 };
        }
        const len = prev.end_sec - prev.start_sec;
        const s = Math.max(0, Math.min(dur - len, t - len / 2));
        return { ...prev, start_sec: Math.round(s * 100) / 100, end_sec: Math.round((s + len) * 100) / 100 };
      });
      setDirty(true);
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
  };

  const seekTo = (t) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(clip.start_sec, Math.min(clip.end_sec, t));
    }
  };

  const playClip = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = clip.start_sec;
    videoRef.current.play().catch(() => {});
  };

  const doRender = async () => {
    try {
      if (dirty) {
        await api(`/api/clips/${clip.id}`, {
          method: 'PATCH',
          body: { title: clip.title, start_sec: clip.start_sec, end_sec: clip.end_sec, aspect: clip.aspect, theme: clip.theme, caption_style: clip.caption_style },
        });
        setDirty(false);
      }
      const r = await api(`/api/clips/${clip.id}/render`, { method: 'POST', body: { quality: 1080, fps: 30 } });
      setRenderProgress(0);
      setRenderJob(r.jobId);
      setRendering(true);
      toast('Render queued — progress shown below', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  const retryRender = async () => {
    try {
      const jobs = (await api('/api/jobs?limit=20')).jobs.filter((j) => j.clip_id === clip.id && j.status === 'failed');
      if (jobs.length) {
        await api(`/api/jobs/${jobs[0].id}/retry`, { method: 'POST' });
        setRenderJob(jobs[0].id);
        toast('Retrying render…', 'ok');
      } else {
        doRender();
      }
    } catch (err) { toast(err.message, 'err'); }
  };

  const cs = clip.caption_style || {};
  const setCS = (patch) => update({ caption_style: { ...cs, ...patch } });

  const aspectClass = clip.aspect === '9:16' ? 'r916' : clip.aspect === '1:1' ? 'r11' : 'r169';

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div className="dim"><Link to={`/videos/${data.video.id}`} style={{ color: 'var(--ink-3)' }}>{data.video.orig_name}</Link> / editor</div>
          <input
            className="input"
            style={{ fontSize: '1.05rem', fontWeight: 700, maxWidth: 420, background: 'transparent', border: '1px solid transparent' }}
            value={clip.title}
            onChange={(e) => update({ title: e.target.value })}
            aria-label="Clip title"
          />
        </div>
        <div className="row wrap">
          <span className={`badge ${dirty ? 'warn' : 'ok'}`}>{dirty ? (saving ? 'saving…' : 'unsaved · autosaving') : 'saved'}</span>
          <div className="undo-redo">
            <button className="btn sm ghost" onClick={undo} disabled={!historyRef.current.length} title="Undo">↩</button>
            <button className="btn sm ghost" onClick={redo} disabled={!futureRef.current.length} title="Redo">↪</button>
          </div>
          <StatusBadge status={clip.status} />
          {clip.status === 'failed'
            ? <button className="btn sm danger" onClick={retryRender}>Retry render</button>
            : <button className="btn primary" onClick={doRender} disabled={clip.status === 'rendering' || Boolean(renderJob)}>
                {clip.status === 'ready' ? '↻ Re-render MP4' : '⚡ Render MP4'}
              </button>}
        </div>
      </div>

      {(renderJob || clip.status === 'rendering') && (
        <div className="glass panel" style={{ marginBottom: 16 }}>
          <div className="row between wrap" style={{ marginBottom: 8 }}>
            <span className="badge violet">Rendering MP4 — all effects are burned into the file</span>
            <span className="dim mono">{renderProgress}%</span>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${renderProgress || 2}%` }} /></div>
        </div>
      )}

      {clip.status === 'ready' && clip.mediaUrl && (
        <div className="glass panel ok" style={{ marginBottom: 16, borderColor: 'rgba(52,211,153,0.4)' }}>
          <div className="row between wrap">
            <span className="badge ok">✓ MP4 ready · {(clip.size_hint || '')}</span>
            <a className="btn primary sm" href={clip.mediaUrl + '&dl=1'} download>⬇ Download MP4</a>
          </div>
        </div>
      )}

      <div className="editor-grid">
        <div>
          <div className={`glass sheen panel stage-wrap`}>
            <div className={`stage ${aspectClass}`}>
              <video
                ref={videoRef}
                src={data.video.mediaUrl}
                controls
                playsInline
                preload="metadata"
                onTimeUpdate={(e) => {
                  const t = e.currentTarget.currentTime;
                  if (t > clip.end_sec + 0.05) e.currentTarget.currentTime = clip.start_sec;
                }}
              />
            </div>
            <div className="row between" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={playClip}>▶ Play from clip start</button>
              <span className="dim mono">{fmtDur(clip.start_sec)} → {fmtDur(clip.end_sec)} · {clipDur.toFixed(1)}s · {clip.aspect}</span>
            </div>
          </div>

          <div className="glass sheen panel" style={{ marginTop: 16 }}>
            <div className="row between wrap" style={{ marginBottom: 10 }}>
              <h2 style={{ fontSize: '0.98rem', margin: 0 }}>Timeline</h2>
              <span className="dim">Drag the handles or the selection to set boundaries</span>
            </div>
            <div
              className="timeline"
              ref={timelineRef}
              onMouseDown={(e) => { if (e.target === e.currentTarget || e.target.closest('.wave')) { seekTo(timeFromEvent(e)); } }}
            >
              <div className="wave" aria-hidden="true">
                {wave.map((v, i) => <i key={i} style={{ height: `${Math.min(100, v * 100)}%`, opacity: v > 0.2 ? 0.9 : 0.4 }} />)}
              </div>
              <div className="sel" style={{ left: `${selLeft}%`, width: `${selWidth}%` }} />
              <div className="handle" style={{ left: `calc(${selLeft}% - 9px)` }} onMouseDown={startDrag('start')} onTouchStart={startDrag('start')} role="slider" aria-label="Clip start" aria-valuenow={clip.start_sec} />
              <div className="handle" style={{ left: `calc(${selLeft + selWidth}% - 9px)` }} onMouseDown={startDrag('end')} onTouchStart={startDrag('end')} role="slider" aria-label="Clip end" aria-valuenow={clip.end_sec} />
            </div>
            <div className="row wrap" style={{ marginTop: 12, gap: 14 }}>
              <label className="row" style={{ gap: 8, flex: 1, minWidth: 150 }}>
                <span className="dim">Start</span>
                <input type="range" min="0" max={Math.max(0, dur - 1)} step="0.1" value={clip.start_sec} onChange={(e) => update({ start_sec: Math.min(+e.target.value, clip.end_sec - 1) })} />
                <span className="mono dim" style={{ minWidth: 42 }}>{clip.start_sec.toFixed(1)}s</span>
              </label>
              <label className="row" style={{ gap: 8, flex: 1, minWidth: 150 }}>
                <span className="dim">End</span>
                <input type="range" min="1" max={dur} step="0.1" value={clip.end_sec} onChange={(e) => update({ end_sec: Math.max(+e.target.value, clip.start_sec + 1) })} />
                <span className="mono dim" style={{ minWidth: 42 }}>{clip.end_sec.toFixed(1)}s</span>
              </label>
            </div>
          </div>

          <div className="glass sheen panel" style={{ marginTop: 16 }}>
            <div className="row between wrap">
              <h2 style={{ fontSize: '0.98rem', margin: 0 }}>Why this clip scored {Math.round(clip.score)}/100</h2>
              <span className="dim">engagement potential estimate — not a guarantee</span>
            </div>
            {clip.score_reasons?.factors && (
              <div className="factors" style={{ marginTop: 12 }}>
                {Object.entries(clip.score_reasons.factors).map(([k, v]) => (
                  <div key={k} className="f">
                    <span style={{ textTransform: 'capitalize' }}>{k}</span>
                    <div className="bar"><i style={{ width: `${v}%` }} /></div>
                    <span className="mono dim">{v}</span>
                  </div>
                ))}
              </div>
            )}
            {clip.score_reasons?.reasons?.length > 0 && (
              <ul className="muted" style={{ fontSize: '0.84rem', lineHeight: 1.6, margin: '12px 0 0', paddingLeft: 18 }}>
                {clip.score_reasons.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </div>
        </div>

        <div>
          <div className="glass sheen panel">
            <h2 style={{ fontSize: '0.98rem' }}>Format</h2>
            <div className="themes" role="radiogroup" aria-label="Aspect ratio">
              {(meta?.aspects || ['9:16', '1:1', '16:9']).map((a) => (
                <button
                  key={a}
                  className={`theme-chip ${clip.aspect === a ? 'active' : ''}`}
                  onClick={() => update({ aspect: a })}
                  role="radio"
                  aria-checked={clip.aspect === a}
                >
                  <span style={{ display: 'block', fontSize: '1.05rem', marginBottom: 4 }}>
                    {a === '9:16' ? '▯' : a === '1:1' ? '◻' : '▭'}
                  </span>
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="glass sheen panel" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: '0.98rem' }}>Caption theme</h2>
            <div className="themes" role="radiogroup" aria-label="Caption theme">
              {(meta?.themes || [{ id: 'cinematic', label: 'Cinematic' }]).map((t) => (
                <button
                  key={t.id}
                  className={`theme-chip ${clip.theme === t.id ? 'active' : ''}`}
                  onClick={() => update({ theme: t.id })}
                  role="radio"
                  aria-checked={clip.theme === t.id}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 16 }}>
              <label className="row between" style={{ marginBottom: 8 }}>
                <span className="muted" style={{ fontSize: '0.88rem' }}>Animated captions</span>
                <input type="checkbox" checked={cs.captions !== false} onChange={(e) => setCS({ captions: e.target.checked })} />
              </label>
              <label className="row between" style={{ marginBottom: 8 }}>
                <span className="muted" style={{ fontSize: '0.88rem' }}>Karaoke word highlighting</span>
                <input type="checkbox" checked={cs.karaoke !== false} onChange={(e) => setCS({ karaoke: e.target.checked })} />
              </label>
              <label className="row between" style={{ marginBottom: 8 }}>
                <span className="muted" style={{ fontSize: '0.88rem' }}>Progress bar</span>
                <input type="checkbox" checked={cs.progressBar !== false} onChange={(e) => setCS({ progressBar: e.target.checked })} />
              </label>
              <label className="field" style={{ marginTop: 10 }}>
                <span className="lbl">Caption size ×{(cs.fontSizeScale || 1).toFixed(2)}</span>
                <input type="range" min="0.7" max="1.6" step="0.05" value={cs.fontSizeScale || 1} onChange={(e) => setCS({ fontSizeScale: +e.target.value })} />
              </label>
              <label className="field">
                <span className="lbl">Title card (first seconds)</span>
                <input className="input" placeholder="e.g. The lighting secret" value={cs.titleCard || ''} onChange={(e) => setCS({ titleCard: e.target.value })} />
              </label>
              <label className="field">
                <span className="lbl">Lower third</span>
                <input className="input" placeholder="e.g. @yourhandle" value={cs.lowerThird || ''} onChange={(e) => setCS({ lowerThird: e.target.value })} />
              </label>
              <label className="field">
                <span className="lbl">Accent color</span>
                <input type="color" value={cs.accent || '#a78bfa'} onChange={(e) => setCS({ accent: e.target.value })} />
              </label>
            </div>
            <p className="dim" style={{ marginBottom: 0 }}>
              Preview shows the source framing; themes, karaoke captions, title cards and progress bars are
              rendered into the exported MP4 by the server engine.
            </p>
          </div>

          <div className="glass sheen panel" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: '0.98rem' }}>Danger zone</h2>
            <button
              className="btn danger sm"
              onClick={async () => {
                if (!confirm('Delete this clip? This cannot be undone.')) return;
                try {
                  await api(`/api/clips/${clip.id}`, { method: 'DELETE' });
                  window.location.href = `/videos/${data.video.id}`;
                } catch (err) { toast(err.message, 'err'); }
              }}
            >Delete clip</button>
          </div>
        </div>
      </div>
    </div>
  );
}
