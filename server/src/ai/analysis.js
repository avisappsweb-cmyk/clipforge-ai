import { ffmpeg } from '../media/ffmpeg.js';

const HOOK_WORDS = ['you', 'your', 'imagine', 'listen', 'stop', 'wait', 'here', 'why', 'how', 'what', 'never', 'secret', 'truth', 'mistake', 'warning'];
const EMOTION_WORDS = ['amazing', 'insane', 'crazy', 'love', 'hate', 'fear', 'shock', 'wow', 'unbelievable', 'incredible', 'best', 'worst', 'huge', 'massive', 'free', 'win', 'fail', 'danger'];
const SHARE_WORDS = ['secret', 'never', 'always', 'everyone', 'nobody', 'mistake', 'trick', 'hack', 'formula', 'blueprint', 'lesson', 'story', 'truth', 'reason', 'why', 'how'];
const INTENSIFIERS = ['very', 'really', 'so', 'super', 'extremely', 'absolutely', 'literally'];

export async function detectScenes(videoPath, duration) {
  try {
    const { stderr } = await ffmpeg([
      '-i', videoPath,
      '-vf', "select='gt(scene,0.30)',showinfo",
      '-an', '-f', 'null', '-',
    ], { timeoutMs: 15 * 60 * 1000 });
    const times = [];
    for (const m of stderr.matchAll(/pts_time:([0-9.]+)/g)) {
      const t = parseFloat(m[1]);
      if (Number.isFinite(t) && t > 0.5 && t < duration - 0.5) times.push(t);
    }
    const scenes = [];
    let prev = 0;
    for (const t of [...times, duration]) {
      scenes.push({ start: prev, end: t, duration: Math.round((t - prev) * 1000) / 1000 });
      prev = t;
    }
    return scenes.filter((s) => s.duration > 0.2);
  } catch {
    return [{ start: 0, end: duration, duration }];
  }
}

export function energyStats(energy) {
  if (!energy || !energy.values?.length) return null;
  const vals = energy.values;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(vals.length * 0.9)];
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { mean, p90, std: Math.sqrt(variance), hop: energy.hop || 0.05 };
}

function wordsInRange(words, start, end) {
  return words.filter((w) => w.end > start && w.start < end);
}

function clamp01(x) { return Math.min(1, Math.max(0, x)); }

function sentenceBoundaries(words) {
  const bounds = new Set();
  for (const w of words) {
    if (/[.!?]$/.test(w.word)) bounds.add(Math.round(w.end * 10) / 10);
  }
  return bounds;
}

export function scoreCandidate({ words, start, end, energy, scenes, duration }) {
  const w = wordsInRange(words, start, end);
  const text = w.map((x) => x.word).join(' ');
  const lower = text.toLowerCase();
  const dur = end - start;
  const reasons = [];
  if (dur < 5 || w.length < 8) {
    return { score: 0, factors: {}, reasons: ['Segment too short or too sparse to evaluate.'], text };
  }

  const avgConf = w.reduce((a, b) => a + (b.conf ?? 0.8), 0) / w.length;
  const wps = w.length / dur;

  // 1. Opening hook — first 3 seconds: speech density + attention lexis.
  const hookWords = wordsInRange(words, start, start + 3);
  const hookLexis = hookWords.filter((x) => HOOK_WORDS.includes(x.word.toLowerCase())).length;
  const hookDensity = clamp01(hookWords.length / 3 / 2.5);
  const hook = clamp01(0.55 * hookDensity + 0.45 * clamp01(hookLexis / 2));
  reasons.push(`Opening hook ${Math.round(hook * 100)}/100 — ${hookWords.length} words in the first 3s${hookLexis ? `, attention words present (${hookWords.filter((x) => HOOK_WORDS.includes(x.word.toLowerCase())).slice(0, 3).map((x) => x.word).join(', ')})` : ', no attention-grabbing words detected'}.`);

  // 2. Clarity — ASR confidence + comfortable speech rate.
  const rateIdeal = clamp01(1 - Math.abs(wps - 3.2) / 2.2);
  const clarity = clamp01(0.5 * clamp01((avgConf - 0.5) / 0.45) + 0.5 * rateIdeal);
  reasons.push(`Clarity ${Math.round(clarity * 100)}/100 — average recognition confidence ${(avgConf * 100).toFixed(0)}%, pace ${wps.toFixed(1)} words/sec.`);

  // 3. Pacing — energy dynamics and scene changes inside the window.
  let pacing = 0.4;
  if (energy) {
    const hop = energy.hop || 0.05;
    const i0 = Math.floor(start / hop);
    const i1 = Math.min(energy.values.length, Math.ceil(end / hop));
    const seg = energy.values.slice(i0, i1);
    if (seg.length > 4) {
      const m = seg.reduce((a, b) => a + b, 0) / seg.length;
      const std = Math.sqrt(seg.reduce((a, b) => a + (b - m) ** 2, 0) / seg.length);
      pacing = clamp01(std / (m + 1e-6) / 0.9);
    }
  }
  const cuts = scenes.filter((s) => s.start > start && s.start < end).length;
  const cutScore = clamp01(cuts / Math.max(1, dur / 8));
  pacing = clamp01(0.6 * pacing + 0.4 * cutScore);
  reasons.push(`Pacing ${Math.round(pacing * 100)}/100 — audio dynamics ${(pacing * 100).toFixed(0)}%, ${cuts} visual changes in ${dur.toFixed(0)}s.`);

  // 4. Emotional engagement — emotional lexis + exclamations + energy peaks.
  const emoHits = w.filter((x) => EMOTION_WORDS.includes(x.word.toLowerCase())).length;
  const exclam = (text.match(/!/g) || []).length;
  const intens = w.filter((x) => INTENSIFIERS.includes(x.word.toLowerCase())).length;
  let emoPeak = 0;
  if (energy) {
    const hop = energy.hop || 0.05;
    const i0 = Math.floor(start / hop);
    const i1 = Math.min(energy.values.length, Math.ceil(end / hop));
    const seg = energy.values.slice(i0, i1);
    if (seg.length) emoPeak = clamp01(Math.max(...seg) / (energyStdGlobal(energy) * 3 + 1e-6));
  }
  const emotion = clamp01(0.45 * clamp01(emoHits / 4) + 0.2 * clamp01(exclam / 3) + 0.15 * clamp01(intens / 5) + 0.2 * emoPeak);
  reasons.push(`Emotional engagement ${Math.round(emotion * 100)}/100 — ${emoHits} emotive words, ${exclam} exclamations, energy peak ${(emoPeak * 100).toFixed(0)}%.`);

  // 5. Standalone context — starts/ends on sentence boundaries, self-contained.
  const bounds = sentenceBoundaries(words);
  const startsOnSentence = [...bounds].some((b) => Math.abs(b - start) < 0.45) || start === 0;
  const endsOnSentence = [...bounds].some((b) => Math.abs(b - end) < 0.45) || Math.abs(end - duration) < 0.45;
  const sentences = (text.match(/[.!?]+/) || []).length;
  const standalone = clamp01(0.4 * (startsOnSentence ? 1 : 0.25) + 0.4 * (endsOnSentence ? 1 : 0.25) + 0.2 * clamp01(sentences / 3));
  reasons.push(`Standalone context ${Math.round(standalone * 100)}/100 — ${startsOnSentence ? 'starts' : 'does not start'} and ${endsOnSentence ? 'ends' : 'does not end'} on natural sentence boundaries.`);

  // 6. Shareability — duration sweet spot + share-trigger lexis.
  const durScore = dur >= 18 && dur <= 60 ? 1 : dur < 18 ? clamp01(dur / 18) : clamp01(1 - (dur - 60) / 90);
  const shareHits = w.filter((x) => SHARE_WORDS.includes(x.word.toLowerCase())).length;
  const shareability = clamp01(0.45 * durScore + 0.55 * clamp01(shareHits / 5));
  reasons.push(`Shareability ${Math.round(shareability * 100)}/100 — ${dur.toFixed(0)}s duration ${durScore > 0.8 ? 'in the' : 'outside the'} 18–60s sweet spot, ${shareHits} share-trigger words.`);

  const factors = { hook, clarity, pacing, emotion, standalone, shareability };
  const weights = { hook: 0.24, clarity: 0.14, pacing: 0.12, emotion: 0.2, standalone: 0.14, shareability: 0.16 };
  let score = 0;
  for (const k of Object.keys(weights)) score += factors[k] * weights[k];
  score = Math.round(score * 100);

  return {
    score,
    factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, Math.round(v * 100)])),
    reasons,
    text,
  };
}

function energyStdGlobal(energy) {
  const vals = energy.values;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
}

export function optimizeBoundaries({ start, end, words, speechRegions, duration, energy }) {
  let s = start;
  let e = end;
  const bounds = sentenceBoundaries(words);
  if (words.length) {
    let best = null;
    for (const b of bounds) {
      if (b <= start + 1.2 && b >= start - 3.5) {
        if (!best || Math.abs(b - start) < Math.abs(best - start)) best = b;
      }
    }
    if (best !== null && best < end - 4) s = best;
    let bestEnd = null;
    for (const b of bounds) {
      if (b >= end - 1.2 && b <= end + 3.5) {
        if (!bestEnd || Math.abs(b - end) < Math.abs(bestEnd - end)) bestEnd = b;
      }
    }
    if (bestEnd !== null && bestEnd > s + 4) e = Math.min(duration, bestEnd + 0.35);
  }
  if (speechRegions?.length) {
    for (const r of speechRegions) {
      if (r.start >= s - 1 && r.start <= s + 1) { s = Math.max(0, r.start - 0.3); break; }
    }
    for (const r of speechRegions) {
      if (r.end >= e - 1 && r.end <= e + 1) { e = Math.min(duration, r.end + 0.4); break; }
    }
  }
  s = Math.max(0, Math.min(s, duration - 3));
  e = Math.min(duration, Math.max(e, s + 3));
  return { start: Math.round(s * 100) / 100, end: Math.round(e * 100) / 100 };
}

export function overlaps(a, b) {
  const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (inter <= 0) return 0;
  return inter / Math.min(a.end - a.start, b.end - b.start);
}

export function generateHighlights({ transcript, energy, scenes, duration, minLen = 12, maxLen = 60, targetCount = 5 }) {
  const words = transcript?.words || [];
  const segments = transcript?.segments || [];
  const regions = transcript?.speech_regions || [];
  const candidates = [];

  if (regions.length) {
    // Speech blocks are natural self-contained moments — one candidate per
    // block (clamped to maxLen), plus sliding windows for long blocks.
    for (const r of regions) {
      const blockLen = r.end - r.start;
      if (blockLen >= minLen * 0.6) {
        candidates.push({ start: Math.max(0, r.start - 0.3), end: Math.min(duration, r.end + 0.4) });
      }
      if (blockLen > maxLen * 1.6) {
        const step = maxLen * 0.75;
        for (let t = r.start + step; t + minLen <= r.end; t += step) {
          candidates.push({ start: t, end: Math.min(r.end + 0.4, t + maxLen) });
        }
      }
    }
  } else if (segments.length) {
    for (const seg of segments) {
      const start = seg.start;
      const end = Math.min(duration, start + Math.min(maxLen, 45));
      if (end - start >= minLen) candidates.push({ start, end });
    }
  } else {
    for (let t = 0; t < duration - minLen; t += maxLen / 2) candidates.push({ start: t, end: Math.min(duration, t + Math.min(maxLen, 45)) });
  }

  const scored = [];
  for (const c of candidates) {
    const { score, factors, reasons, text } = scoreCandidate({ words, start: c.start, end: c.end, energy, scenes, duration });
    if (score <= 0) continue;
    scored.push({ start: c.start, end: c.end, score, factors, reasons, text });
  }

  scored.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const c of scored) {
    if (selected.length >= targetCount) break;
    if (selected.some((s) => overlaps(s, c) > 0.5)) continue;
    const opt = optimizeBoundaries({ start: c.start, end: c.end, words, speechRegions: regions, duration, energy });
    const rescore = scoreCandidate({ words, start: opt.start, end: opt.end, energy, scenes, duration });
    selected.push({
      start: opt.start,
      end: opt.end,
      score: rescore.score,
      factors: rescore.factors,
      reasons: rescore.reasons,
      text: rescore.text,
    });
  }
  selected.sort((a, b) => b.score - a.score);
  return selected;
}
