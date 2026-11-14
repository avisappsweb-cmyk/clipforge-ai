#!/usr/bin/env node
/**
 * CLIPFORGE setup: downloads the local ASR model and caption fonts.
 * Everything is downloaded over HTTPS at install time; nothing is committed.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const FONTS = path.join(VENDOR, 'fonts');

const VOSK_URL = process.env.VOSK_MODEL_URL || 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';
const VOSK_DIR = process.env.VOSK_MODEL_DIR || path.join(VENDOR, 'vosk-model-small-en-us-0.15');

const GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl';
const FONT_SOURCES = [
  { url: `${GF}/inter/Inter%5Bopsz%2Cwght%5D.ttf`, file: 'Inter-VF.ttf' },
  { url: `${GF}/montserrat/Montserrat%5Bwght%5D.ttf`, file: 'Montserrat-VF.ttf' },
  { url: `${GF}/anton/Anton-Regular.ttf`, file: 'Anton-Regular.ttf' },
  { url: `${GF}/lora/Lora-Italic%5Bwght%5D.ttf`, file: 'Lora-Italic-VF.ttf' },
];
const INSTANCES = [
  { src: 'Inter-VF.ttf', axes: { wght: 400 }, out: 'Inter-Regular.ttf' },
  { src: 'Inter-VF.ttf', axes: { wght: 600 }, out: 'Inter-SemiBold.ttf' },
  { src: 'Inter-VF.ttf', axes: { wght: 800 }, out: 'Inter-ExtraBold.ttf' },
  { src: 'Montserrat-VF.ttf', axes: { wght: 600 }, out: 'Montserrat-SemiBold.ttf' },
  { src: 'Montserrat-VF.ttf', axes: { wght: 800 }, out: 'Montserrat-ExtraBold.ttf' },
  { src: 'Lora-Italic-VF.ttf', axes: { wght: 400 }, out: 'Lora-Italic.ttf' },
];

async function download(url, out) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
}

async function npmTarball(pkg) {
  const res = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}`);
  if (!res.ok) throw new Error(`Registry lookup failed for ${pkg}`);
  const meta = await res.json();
  const version = meta['dist-tags'].latest;
  return { url: meta.versions[version].dist.tarball, version };
}

async function installFonts() {
  fs.mkdirSync(FONTS, { recursive: true });
  for (const { url, file } of FONT_SOURCES) {
    const dest = path.join(FONTS, file);
    if (fs.existsSync(dest)) continue;
    process.stdout.write(`[setup] downloading ${file}…\n`);
    await download(url, dest);
  }
  for (const inst of INSTANCES) {
    const out = path.join(FONTS, inst.out);
    if (fs.existsSync(out)) continue;
    const src = path.join(FONTS, inst.src);
    const axisArgs = Object.entries(inst.axes).flatMap(([k, v]) => [`${k}=${v}`]);
    execFileSync(pythonBin(), ['-m', 'fontTools.varLib.instancer', src, ...axisArgs, '-o', out, '--update-name-table']);
  }
  for (const vf of FONT_SOURCES.filter((s) => s.file.includes('VF')).map((s) => s.file)) {
    fs.rmSync(path.join(FONTS, vf), { force: true });
  }
  const installed = fs.readdirSync(FONTS).filter((f) => f.endsWith('.ttf'));
  console.log(`[setup] fonts ready: ${installed.join(', ')}`);
}

function pythonBin() {
  return process.env.PYTHON_BIN || 'python3';
}

async function installVosk() {
  if (fs.existsSync(path.join(VOSK_DIR, 'am', 'final.mdl'))) {
    console.log('[setup] vosk model already installed');
    return;
  }
  console.log('[setup] downloading Vosk ASR model (~40 MB)…');
  const zip = path.join(VENDOR, 'vosk-model.zip');
  await download(VOSK_URL, zip);
  execFileSync('unzip', ['-o', '-q', zip, '-d', VENDOR]);
  fs.rmSync(zip, { force: true });
  console.log('[setup] vosk model ready');
}

try {
  await installVosk();
  await installFonts();
  console.log('[setup] all models and fonts are ready.');
} catch (err) {
  console.error('[setup] FAILED:', err.message);
  process.exit(1);
}
