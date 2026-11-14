export const THEMES = {
  cinematic: {
    label: 'Cinematic',
    font: 'Montserrat SemiBold',
    fontSize: 0.052,
    primary: '#FFFFFF',
    highlight: '#7DD3FC',
    outline: '#000000',
    outlineWidth: 2.2,
    shadow: 1.2,
    blur: 1.6,
    box: false,
    uppercase: false,
    align: 'bottom-center',
    marginV: 0.12,
    letterSpacing: 0.5,
    lineAnim: 'fade',
  },
  podcast: {
    label: 'Podcast',
    font: 'Inter SemiBold',
    fontSize: 0.05,
    primary: '#FFFFFF',
    highlight: '#A78BFA',
    outline: '#0B0B14',
    outlineWidth: 0,
    shadow: 0,
    blur: 0,
    box: true,
    boxColor: '#14121F',
    boxAlpha: 0.82,
    uppercase: false,
    align: 'bottom-center',
    marginV: 0.14,
    letterSpacing: 0,
    lineAnim: 'fade',
  },
  bold: {
    label: 'Bold Creator',
    font: 'Anton',
    fontSize: 0.075,
    primary: '#FFFFFF',
    highlight: '#FDE047',
    outline: '#000000',
    outlineWidth: 3.4,
    shadow: 2,
    blur: 0,
    box: false,
    uppercase: true,
    align: 'bottom-center',
    marginV: 0.16,
    letterSpacing: 1,
    lineAnim: 'pop',
  },
  minimal: {
    label: 'Minimal',
    font: 'Inter Regular',
    fontSize: 0.042,
    primary: '#F4F4F5',
    highlight: '#E4E4E7',
    outline: '#000000',
    outlineWidth: 1.4,
    shadow: 0.6,
    blur: 0,
    box: false,
    uppercase: false,
    align: 'bottom-center',
    marginV: 0.1,
    letterSpacing: 0,
    lineAnim: 'fade',
  },
  gaming: {
    label: 'Gaming',
    font: 'Montserrat ExtraBold',
    fontSize: 0.058,
    primary: '#F8FAFC',
    highlight: '#34D399',
    outline: '#022C22',
    outlineWidth: 2.8,
    shadow: 1.6,
    blur: 0.5,
    box: true,
    boxColor: '#052E1B',
    boxAlpha: 0.7,
    uppercase: true,
    align: 'bottom-center',
    marginV: 0.18,
    letterSpacing: 0.8,
    lineAnim: 'pop',
  },
  storytelling: {
    label: 'Storytelling',
    font: 'Lora',
    italic: true,
    fontSize: 0.05,
    primary: '#FDE8D7',
    highlight: '#FDBA74',
    outline: '#1C1006',
    outlineWidth: 1.8,
    shadow: 1.4,
    blur: 1,
    box: false,
    uppercase: false,
    align: 'bottom-center',
    marginV: 0.2,
    letterSpacing: 0,
    lineAnim: 'fade',
  },
};

const ASPECT_SIZES = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
};

export function themeNames() {
  return Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label }));
}

function hexToAss(hex, alphaHex = '00') {
  const h = hex.replace('#', '');
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

function assTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeText(t) {
  return String(t).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, ' ');
}

const EMPHASIS_LEXICON = new Set([
  'never', 'always', 'secret', 'free', 'best', 'worst', 'huge', 'insane', 'crazy',
  'amazing', 'incredible', 'unbelievable', 'shocking', 'must', 'now', 'today', 'warning',
  'love', 'hate', 'stop', 'wait', 'listen', 'truth', 'mistake', 'win', 'fail', 'million',
]);

function isEmphasis(word) {
  const w = word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  if (!w) return false;
  return EMPHASIS_LEXICON.has(w) || /^[A-Z]{3,}$/.test(word.replace(/[^\p{L}]/gu, '')) || /^\$?\d[\d,.]*[x%kKmM]?$/.test(word);
}

export function groupCaptionWords(words, { maxWords = 5, maxChars = 32, maxDur = 2.6 } = {}) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    const dur = w.end - w.start;
    cur.push(w);
    const text = cur.map((x) => x.word).join(' ');
    const span = cur[cur.length - 1].end - cur[0].start;
    const endsSentence = /[.!?]$/.test(w.word);
    if (cur.length >= maxWords || text.length >= maxChars || span >= maxDur || endsSentence) {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

export function buildAss({
  words,
  clipStart,
  clipEnd,
  aspect = '9:16',
  theme = 'cinematic',
  options = {},
}) {
  const t = { ...THEMES[theme] } || THEMES.cinematic;
  const o = {
    captions: true,
    karaoke: true,
    titleCard: null,
    lowerThird: null,
    progressBar: true,
    progressColor: t.highlight,
    fontSizeScale: 1,
    position: 'bottom',
    emoji: false,
    ...options,
  };
  const size = ASPECT_SIZES[aspect] || ASPECT_SIZES['9:16'];
  const W = size.w;
  const H = size.h;
  const fs = Math.round(t.fontSize * H * o.fontSizeScale);
  const marginV = Math.round(t.marginV * H);

  const clipDur = Math.max(0.1, clipEnd - clipStart);
  const primary = hexToAss(t.primary);
  const highlight = hexToAss(o.progressColor || t.highlight);
  const outline = hexToAss(t.outline);

  const header = [];
  header.push('[Script Info]');
  header.push('; Generated by CLIPFORGE AI motion graphics engine');
  header.push('ScriptType: v4.00+');
  header.push(`PlayResX: ${W}`);
  header.push(`PlayResY: ${H}`);
  header.push('WrapStyle: 2');
  header.push('ScaledBorderAndShadow: yes');
  header.push('');
  header.push('[V4+ Styles]');
  header.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  header.push(
    `Style: Caption,${t.font},${fs},${primary},${highlight},${outline},${hexToAss('#000000', '96')},${t.italic ? 1 : 0},0,0,0,100,100,${t.letterSpacing},0,${t.box ? 3 : 1},${t.outlineWidth},${t.shadow},2,60,60,${marginV},1`
  );
  header.push(
    `Style: Title,${t.font},${Math.round(fs * 1.7)},${primary},${highlight},${outline},${hexToAss('#000000', '96')},${t.italic ? 1 : 0},0,0,0,100,100,${t.letterSpacing * 1.5},0,1,${t.outlineWidth + 0.8},${t.shadow},5,60,60,${Math.round(H * 0.42)},1`
  );
  header.push(
    `Style: LowerThird,${t.font},${Math.round(fs * 0.72)},${primary},${highlight},${outline},${hexToAss(t.boxColor || '#0B0B14', t.boxAlpha ? Math.round((1 - t.boxAlpha) * 255).toString(16).padStart(2, '0') : '96')},${t.italic ? 1 : 0},0,0,0,100,100,${t.letterSpacing},0,${t.box ? 3 : 1},${t.outlineWidth},${t.shadow},1,70,70,${Math.round(H * 0.08)},1`
  );
  header.push('');
  header.push('[Events]');
  header.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
  const events = [];

  if (o.titleCard) {
    const title = escapeText(o.titleCard);
    const tcDur = Math.min(2.2, clipDur * 0.35);
    events.push(
      `Dialogue: 1,${assTime(0.15)},${assTime(tcDur)},Title,,0,0,0,,{\\fad(260,300)\\t(150,700,\\fscx100\\fscy100)\\fscx92\\fscy92\\blur2\\t(700,900,\\blur0)}${title}`
    );
  }

  if (o.lowerThird) {
    const lt = escapeText(o.lowerThird);
    const ltEnd = Math.min(clipDur, 4.5);
    events.push(
      `Dialogue: 1,${assTime(0.4)},${assTime(ltEnd)},LowerThird,,0,0,0,,{\\fad(220,260)\\move(${Math.round(W * 0.07)},${Math.round(H * 0.9)},${Math.round(W * 0.07)},${Math.round(H * 0.88)},0,450)}${lt}`
    );
  }

  if (o.captions && words.length) {
    const rel = words
      .filter((w) => w.end > clipStart && w.start < clipEnd)
      .map((w) => ({ ...w, start: Math.max(0, w.start - clipStart), end: Math.min(clipDur, w.end - clipStart) }));
    const lines = groupCaptionWords(rel, o.grouping || {});
    for (const line of lines) {
      const start = line[0].start;
      const end = Math.max(line[line.length - 1].end, start + 0.4);
      const parts = [];
      for (let i = 0; i < line.length; i++) {
        const w = line[i];
        const next = line[i + 1];
        const gapEnd = next ? Math.min(next.start, w.end) : w.end;
        const durCs = Math.max(1, Math.round((gapEnd - w.start) * 100));
        const wordText = o.uppercase ? w.word.toUpperCase() : w.word;
        if (!o.karaoke) {
          parts.push(w.word);
          continue;
        }
        if (isEmphasis(w.word)) {
          parts.push(`{\\k${durCs}\\c${highlight}\\t(0,120,\\fscx114\\fscy114)\\t(120,260,\\fscx100\\fscy100)}${escapeText(wordText)}{\\c${primary}\\fscx100\\fscy100}`);
        } else {
          parts.push(`{\\k${durCs}}${escapeText(wordText)}`);
        }
      }
      let body = parts.join(' ');
      if (t.lineAnim === 'pop') body = `{\\t(0,110,\\fscx104\\fscy104)\\t(110,240,\\fscx100\\fscy100)\\fad(90,70)\\blur${t.blur}}` + body;
      else if (t.blur > 0) body = `{\\fad(140,140)\\blur${t.blur}}` + body;
      else body = `{\\fad(140,140)}` + body;
      events.push(`Dialogue: 0,${assTime(start)},${assTime(Math.min(end, clipDur))},Caption,,0,0,0,,${body}`);
    }
  }

  if (o.progressBar && clipDur > 2) {
    const barH = Math.max(4, Math.round(H * 0.004));
    const barY = H - Math.round(H * 0.018);
    const barW = Math.round(W * 0.86);
    const x0 = Math.round(W * 0.07);
    const alpha = '60';
    events.push(
      `Dialogue: 2,${assTime(0)},${assTime(clipDur)},Caption,,0,0,0,,{\\pos(${x0},${barY})\\an4\\p1\\c${hexToAss('#FFFFFF', alpha)}\\bord0\\shad0}m 0 0 l ${barW} 0 ${barW} ${barH} 0 ${barH} p{\\p0}`
    );
    events.push(
      `Dialogue: 3,${assTime(0)},${assTime(clipDur)},Caption,,0,0,0,,{\\pos(${x0},${barY})\\an4\\p1\\c${highlight}\\bord0\\shad0\\fscx1\\t(0,${Math.round(clipDur * 1000)},\\fscx100)}m 0 0 l ${barW} 0 ${barW} ${barH} 0 ${barH} p{\\p0}`
    );
  }

  return `${header.join('\n')}\n${events.join('\n')}\n`;
}
