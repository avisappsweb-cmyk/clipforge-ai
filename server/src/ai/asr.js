import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASR_SCRIPT = path.join(__dirname, 'asr', 'vosk_asr.py');

export const LANGUAGES = [
  { code: 'en', name: 'English', local: true },
  { code: 'pcm', name: 'Nigerian Pidgin', local: false, note: 'Requires a cloud ASR provider (e.g. Deepgram) with Pidgin support; falls back to English acoustic model.' },
  { code: 'yo', name: 'Yorùbá', local: false, note: 'Requires a cloud ASR provider with Yorùbá support.' },
];

export const ASR_CAPABILITIES = {
  'local-vosk': { diarization: false, languages: ['en'], wordTimestamps: true },
  openai: { diarization: false, languages: ['en', 'pcm', 'yo'], wordTimestamps: true },
  deepgram: { diarization: true, languages: ['en', 'pcm', 'yo'], wordTimestamps: true },
};

export function availableProviders() {
  const list = [];
  if (fs.existsSync(config.asr.voskModelDir)) list.push('local-vosk');
  if (config.asr.openaiKey) list.push('openai');
  if (config.asr.deepgramKey) list.push('deepgram');
  return list;
}

export function resolveProvider(preferred = null) {
  const available = availableProviders();
  if (preferred && available.includes(preferred)) return preferred;
  if (available.includes(config.asr.provider)) return config.asr.provider;
  return available[0] || null;
}

function pythonBin() {
  return process.env.PYTHON_BIN || 'python3';
}

function runPython(args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Local ASR timed out'));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ASR sidecar exited ${code}: ${stderr.slice(-400)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`ASR sidecar returned invalid JSON: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

export async function transcribeLocalVosk(wavPath, language = 'en') {
  if (!fs.existsSync(config.asr.voskModelDir)) {
    throw new Error('Local ASR model is not installed. Run: npm run setup:models');
  }
  return runPython([ASR_SCRIPT, config.asr.voskModelDir, wavPath, language]);
}

export async function transcribeOpenAI(wavPath, language = 'en') {
  const key = config.asr.openaiKey;
  if (!key) throw new Error('OPENAI_API_KEY is not configured');
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(wavPath);
  const form = new FormData();
  form.append('file', new Blob([buf]), 'audio.wav');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  if (language) form.append('language', language === 'pcm' ? 'en' : language);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ASR failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const words = (data.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end, conf: 0.95 }));
  const segments = (data.segments || []).map((s) => ({
    start: s.start, end: s.end, text: s.text.trim(),
    words: words.filter((w) => w.start >= s.start - 0.01 && w.end <= s.end + 0.01),
  }));
  return {
    language: data.language || language,
    provider: 'openai',
    text: data.text || '',
    words, segments,
    energy: null,
    speech_regions: [],
    diarization: 'unsupported',
  };
}

export async function transcribeDeepgram(wavPath, language = 'en') {
  const key = config.asr.deepgramKey;
  if (!key) throw new Error('DEEPGRAM_API_KEY is not configured');
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(wavPath);
  const params = new URLSearchParams({ model: 'nova-2', smart_format: 'true', words: 'true', diarize: 'true' });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
    body: buf,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deepgram ASR failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) throw new Error('Deepgram returned no transcript');
  const words = (alt.words || []).map((w) => ({
    word: w.word, start: w.start, end: w.end, conf: w.confidence ?? 0.9,
    speaker: w.speaker ?? null,
  }));
  const speakers = [...new Set(words.map((w) => w.speaker).filter((s) => s !== null))]
    .map((s) => ({ id: `Speaker ${s + 1}`, channel: s }));
  const segments = [];
  for (const w of words) {
    const last = segments[segments.length - 1];
    if (last && last.speaker === w.speaker && w.start - last.end < 0.6) {
      last.end = w.end;
      last.text += ' ' + w.word;
      last.words.push(w);
    } else {
      segments.push({ start: w.start, end: w.end, text: w.word, words: [w], speaker: w.speaker });
    }
  }
  return {
    language: data.results?.channels?.[0]?.detected_language || language,
    provider: 'deepgram',
    text: alt.transcript || '',
    words, segments,
    energy: null,
    speech_regions: [],
    diarization: speakers.length ? 'provider' : 'none',
    speakers,
  };
}

export async function transcribe(wavPath, { language = 'en', preferred = null } = {}) {
  const provider = resolveProvider(preferred);
  if (!provider) {
    throw new Error('No ASR provider available. Run npm run setup:models (local Vosk) or configure a cloud provider key.');
  }
  if (provider === 'local-vosk' && !LANGUAGES.find((l) => l.code === language)?.local) {
    const result = await transcribeLocalVosk(wavPath, 'en');
    result.note = `Local model supports English only; requested language "${language}" was processed with the English acoustic model. Configure a cloud provider for full ${language} support.`;
    return result;
  }
  if (provider === 'local-vosk') return transcribeLocalVosk(wavPath, language);
  if (provider === 'openai') return transcribeOpenAI(wavPath, language);
  if (provider === 'deepgram') return transcribeDeepgram(wavPath, language);
  throw new Error(`Unknown ASR provider: ${provider}`);
}
