import React from 'react';
import { Link } from 'react-router-dom';

const FEATURES = [
  { icon: '✦', title: 'AI highlight detection', body: 'Transcription with word-level timestamps, scene detection and an explainable 0–100 engagement-potential score for every candidate moment.' },
  { icon: '◈', title: 'Motion graphics engine', body: 'Karaoke-style animated captions, title cards, lower thirds and progress bars — rendered into the exported MP4, not just the preview.' },
  { icon: '▣', title: 'Intelligent reframing', body: 'Portrait 9:16, square 1:1 or widescreen 16:9 with attention-aware crop tracking that follows the action.' },
  { icon: '⬡', title: 'Real editing studio', body: 'Clip boundaries, caption styling, themes, undo/redo and autosave — then render polished MP4s ready for every platform.' },
  { icon: '⛨', title: 'Private by design', body: 'Your media stays in private storage behind expiring signed links. API keys live server-side only.' },
  { icon: '◍', title: 'Honest AI', body: 'Scores estimate potential from measurable signals. Transcripts are never invented — speech that is not recognized is not fabricated.' },
];

export default function Landing() {
  return (
    <div>
      <nav className="topnav glass sheen">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M8 6.5v11l9-5.5z" fill="#fff" /></svg>
          </span>
          CLIPFORGE <span className="dim" style={{ fontWeight: 600 }}>AI</span>
        </Link>
        <Link to="/login" className="navlink">Sign in</Link>
        <Link to="/register" className="btn sm primary">Get started</Link>
      </nav>

      <header className="hero">
        <h1 className="h-hero">Turn long videos into<br />scroll-stopping shorts.</h1>
        <p className="sub">
          CLIPFORGE AI analyzes your footage, finds the moments worth sharing, and renders
          polished vertical clips with animated captions — ready for YouTube Shorts, Reels and TikTok.
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 14 }}>
          <Link to="/register" className="btn lg primary">Start clipping free</Link>
          <Link to="/login" className="btn lg ghost">I have an account</Link>
        </div>
        <p className="dim" style={{ marginTop: 18 }}>
          Scores estimate engagement potential — no platform can guarantee virality.
        </p>
      </header>

      <section className="grid c3" style={{ marginTop: 30 }}>
        {FEATURES.map((f) => (
          <div key={f.title} className="glass sheen feature">
            <div className="ic" aria-hidden="true">{f.icon}</div>
            <h3>{f.title}</h3>
            <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>{f.body}</p>
          </div>
        ))}
      </section>

      <section className="glass glow panel" style={{ marginTop: 34, textAlign: 'center', padding: '40px 26px' }}>
        <h2 style={{ fontSize: '1.6rem' }}>From raw footage to ready-to-post in minutes</h2>
        <p className="muted" style={{ maxWidth: 560, margin: '10px auto 24px', lineHeight: 1.6 }}>
          Upload a video, let the AI rank the best moments, pick your caption style,
          and export real MP4 files with everything burned in.
        </p>
        <Link to="/register" className="btn lg primary">Create your account</Link>
      </section>

      <footer className="dim" style={{ textAlign: 'center', marginTop: 40 }}>
        CLIPFORGE AI — built for creators. Imports from external platforms activate only with official,
        authorized API access; direct upload always works.
      </footer>
    </div>
  );
}
