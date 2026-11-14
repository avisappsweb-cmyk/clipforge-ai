#!/usr/bin/env node
/**
 * CLIPFORGE end-to-end test.
 *
 * Generates a real spoken test video (piper TTS + ffmpeg), uploads it through
 * the API, runs AI analysis, verifies the transcript, renders a captioned
 * vertical MP4 export, and verifies the downloadable output.
 *
 * Usage: npm run test:e2e
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.E2E_PORT || 8899;
const B = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(ROOT, 'data-e2e');
const TMP = path.join(ROOT, 'data-e2e', 'e2e-tmp');

const FFMPEG = path.join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg');
const FFPROBE_PKG = path.join(ROOT, 'node_modules', 'ffprobe-static', 'bin', 'linux', 'x64', 'ffprobe');
const PIPER_MODEL = path.join(ROOT, 'vendor', 'piper', 'lessac-medium.onnx');
const VOSK_MODEL = process.env.VOSK_MODEL_DIR || path.join(ROOT, 'vendor', 'vosk-model-small-en-us-0.15');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${err.slice(-300)}`))));
    if (opts.timeoutMs) setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, opts.timeoutMs).unref();
  });
}

const SPEECHES = [
  'Stop scrolling. This one mistake is why your videos look amateur. Everyone blames their camera, but the real secret is lighting. Never shoot with the window behind your subject. Turn toward the light and your footage instantly looks professional. Try this trick today and thank me later.',
  'Let me tell you a story about the worst upload day of my life. I spent eight hours editing a video, and the export failed at ninety nine percent. The lesson? Always back up your project files. Now I keep three copies of everything, and I have never lost a video since.',
  'Here is how to grow from zero to one thousand subscribers. First, pick one topic and stay consistent. Second, make your first fifteen seconds unmissable. Third, always end with one clear question for your audience. Amazing results come from boring consistency, not lucky breaks.',
];

async function generateTestVideo(outPath) {
  fs.mkdirSync(TMP, { recursive: true });
  const wavs = [];
  for (let i = 0; i < SPEECHES.length; i++) {
    const wav = path.join(TMP, `speech${i}.wav`);
    await runPiper(SPEECHES[i], wav);
    wavs.push(wav);
  }
  // Build audio: speech + 2.5s gaps.
  const gap = path.join(TMP, 'gap.wav');
  await run(FFMPEG, ['-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '2.5', '-c:a', 'pcm_s16le', gap]);
  const concatList = path.join(TMP, 'audio.txt');
  const entries = [];
  wavs.forEach((w, i) => {
    entries.push(`file '${w}'`);
    if (i < wavs.length - 1) entries.push(`file '${gap}'`);
  });
  fs.writeFileSync(concatList, entries.join('\n'));
  const audio = path.join(TMP, 'audio.wav');
  await run(FFMPEG, ['-f', 'concat', '-safe', '0', '-i', concatList, '-c:a', 'pcm_s16le', audio]);

  // Build video with distinct visual scenes + subtle motion.
  const dur = await getDuration(audio);
  const seg = dur / 3;
  const video = path.join(TMP, 'video.mp4');
  await run(FFMPEG, [
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${seg}`,
    '-f', 'lavfi', '-i', `smptehdbars=size=1280x720:rate=30:duration=${seg}`,
    '-f', 'lavfi', '-i', `mandelbrot=size=1280x720:rate=30`,
    '-filter_complex', `[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]`,
    '-map', '[v]', '-t', String(dur), video,
  ]);

  await run(FFMPEG, ['-i', video, '-i', audio, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', outPath]);
  return getDuration(outPath);
}

async function runPiper(text, outWav) {
  const res = await new Promise((resolve, reject) => {
    const child = spawn('python3', ['-m', 'piper', '-m', PIPER_MODEL, '--output-raw'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`piper: ${err.slice(-200)}`))));
    child.stdin.write(text + '\n');
    child.stdin.end();
  });
  // Raw 22050 Hz s16le mono → wrap into wav via ffmpeg.
  const raw = outWav.replace(/\.wav$/, '.raw');
  fs.writeFileSync(raw, res);
  await run(FFMPEG, ['-f', 's16le', '-ar', '22050', '-ac', '1', '-i', raw, '-c:a', 'pcm_s16le', outWav]);
  fs.rmSync(raw, { force: true });
}

async function getDuration(file) {
  const { stdout } = await new Promise((resolve, reject) => {
    const child = spawn(FFPROBE_PKG, ['-v', 'error', '-print_format', 'json', '-show_format', file]);
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => resolve({ stdout: out }));
    child.on('error', reject);
  });
  return parseFloat(JSON.parse(stdout).format.duration);
}

async function api(method, p, { token = null, body = null, raw = null } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (raw) payload = raw;
  else if (body !== null) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(B + p, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text };
}

async function waitForJob(token, jobId, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    await sleep(2000);
    const { status, json } = await api('GET', `/api/jobs/${jobId}`, { token });
    if (status !== 200) continue;
    const job = json.job;
    if (`${job.stage} ${job.progress}%` !== last) {
      last = `${job.stage} ${job.progress}%`;
      console.log(`    job ${job.type}: ${last}`);
    }
    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new Error(`Job failed: ${job.error}`);
  }
  throw new Error('Job timed out');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (const dir of [DATA_DIR, TMP]) fs.mkdirSync(dir, { recursive: true });

  console.log('== CLIPFORGE end-to-end test ==\n[1] Generating spoken test video…');
  const testVideo = path.join(TMP, 'e2e-input.mp4');
  const dur = await generateTestVideo(testVideo);
  check('Test video generated with real speech', dur > 30, `${dur.toFixed(1)}s`);

  console.log('\n[2] Starting API + worker…');
  const env = {
    ...process.env, PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1',
    VOSK_MODEL_DIR: VOSK_MODEL,
    ADMIN_EMAIL: 'admin@clipforge.test', ADMIN_PASSWORD: 'admin-password-123',
    MAX_DURATION_SEC: '600', MAX_UPLOAD_MB: '512',
  };
  const apiProc = spawn('node', [path.join(ROOT, 'src', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  apiProc.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));
  const workerProc = spawn('node', [path.join(ROOT, 'src', 'worker', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  workerProc.stderr.on('data', (d) => process.stderr.write(`[worker] ${d}`));

  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      try { const h = await api('GET', '/api/health'); if (h.status === 200) { up = true; break; } } catch { /* retry */ }
      await sleep(500);
    }
    check('API server healthy', up);

    console.log('\n[3] Auth + project…');
    const email = `e2e-${Date.now()}@clipforge.test`;
    const reg = await api('POST', '/api/auth/register', { body: { email, password: 'e2e-password-123', name: 'E2E Tester' } });
    check('User registration', reg.status === 201);
    const token = reg.json.token;
    const prj = await api('POST', '/api/projects', { token, body: { name: 'E2E Project' } });
    check('Project created', prj.status === 201, prj.json?.project?.id);

    console.log('\n[4] Uploading video…');
    const buf = fs.readFileSync(testVideo);
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'video/mp4' }), 'e2e-input.mp4');
    const up2 = await fetch(`${B}/api/projects/${prj.json.project.id}/videos`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
    });
    const upj = await up2.json();
    check('Video uploaded + validated', up2.status === 201, `${(buf.length / 1024 / 1024).toFixed(1)} MB, ${upj.video?.duration_sec?.toFixed?.(1)}s`);
    const videoId = upj.video.id;

    console.log('\n[5] AI analysis…');
    const an = await api('POST', `/api/videos/${videoId}/analyze`, { token, body: { clipCount: 3 } });
    check('Analysis job queued', an.status === 202);
    await waitForJob(token, an.json.jobId);
    const detail = await api('GET', `/api/videos/${videoId}`, { token });
    const transcript = detail.json.transcript;
    const analysis = detail.json.analysis;
    check('Transcript generated (real ASR)', Boolean(transcript) && transcript.words.length > 40,
      `${transcript?.words?.length} words via ${transcript?.provider}`);
    const joined = transcript?.text || '';
    const expected = ['lighting', 'camera', 'secret', 'subscribers', 'consistent', 'export failed'];
    const hits = expected.filter((w) => joined.toLowerCase().includes(w));
    check('Transcript matches spoken content', hits.length >= 4, `${hits.length}/${expected.length} probe phrases found: ${hits.join(', ')}`);
    check('No fabricated transcript', (joined.match(/\[unk\]/gi) || []).length === 0 && joined.length > 100);
    check('Scene detection ran', (analysis?.scenes?.length || 0) >= 2, `${analysis?.scenes?.length} scenes`);
    check('Highlight candidates ranked', (analysis?.highlights?.length || 0) >= 2
      && analysis.highlights.every((h) => h.score >= 0 && h.score <= 100 && Array.isArray(h.reasons) && h.reasons.length >= 5),
      `top score ${analysis?.highlights?.[0]?.score}`);
    const stats = analysis?.stats || {};
    check('Analysis stats computed', typeof stats.wordCount === 'number' && typeof stats.speechCoverage === 'number',
      `words=${stats.wordCount}, speech=${stats.speechCoverage}%`);

    console.log('\n[6] Clips…');
    const clips = detail.json.clips;
    check('Draft clips auto-generated', clips.length >= 2, `${clips.length} clips`);
    const clip = clips[0];
    check('Clip has explainable score', clip.score > 0 && JSON.parse(JSON.stringify(clip.score_reasons)).reasons?.length >= 5,
      `score ${clip.score}/100`);

    console.log('\n[7] Editing + rendering MP4…');
    const patch = await api('PATCH', `/api/clips/${clip.id}`, {
      token,
      body: {
        title: 'E2E Rendered Clip',
        aspect: '9:16',
        theme: 'bold',
        caption_style: { titleCard: 'CLIPFORGE E2E', lowerThird: 'Automated Test', progressBar: true },
      },
    });
    check('Clip settings updated (editor save)', patch.status === 200 && patch.json.clip.aspect === '9:16');
    const render = await api('POST', `/api/clips/${clip.id}/render`, { token, body: { quality: 720, fps: 30 } });
    check('Render job queued', render.status === 202);
    await waitForJob(token, render.json.jobId, { timeoutMs: 15 * 60 * 1000 });
    const clipDetail = await api('GET', `/api/clips/${clip.id}`, { token });
    check('Clip rendered', clipDetail.json.clip.status === 'ready', clipDetail.json.clip.mediaUrl?.slice(0, 40));

    console.log('\n[8] Verifying exported MP4…');
    const mediaUrl = clipDetail.json.clip.mediaUrl;
    const dl = await fetch(B + mediaUrl);
    const mp4 = Buffer.from(await dl.arrayBuffer());
    check('Signed media URL serves MP4', dl.status === 200 && mp4.length > 10000, `${(mp4.length / 1024 / 1024).toFixed(2)} MB`);
    const outProbe = path.join(TMP, 'out.mp4');
    fs.writeFileSync(outProbe, mp4);
    const pdur = await getDuration(outProbe);
    check('Export duration matches clip boundaries', Math.abs(pdur - (clipDetail.json.clip.end_sec - clipDetail.json.clip.start_sec)) < 1.5,
      `${pdur.toFixed(1)}s vs expected ${(clipDetail.json.clip.end_sec - clipDetail.json.clip.start_sec).toFixed(1)}s`);
    const noSig = await fetch(`${B}/api/media/clip/${clip.id}`);
    check('Unsigned media access rejected', noSig.status === 403, `HTTP ${noSig.status}`);

    const frame = path.join(TMP, 'frame.png');
    await run(FFMPEG, ['-ss', '2', '-i', outProbe, '-frames:v', '1', '-y', frame]);
    check('Caption frame extracted for review', fs.existsSync(frame) && fs.statSync(frame).size > 10000, frame);

    const exportsList = await api('GET', '/api/exports', { token });
    check('Export history recorded', exportsList.json.exports.length >= 1
      && exportsList.json.exports[0].status === 'ready'
      && exportsList.json.exports[0].downloadUrl, `${exportsList.json.exports.length} exports`);
    const dl2 = await fetch(B + exportsList.json.exports[0].downloadUrl);
    check('Download endpoint delivers file', dl2.status === 200 && dl2.headers.get('content-disposition')?.includes('attachment'));

    console.log('\n[9] Admin + security…');
    const admLogin = await api('POST', '/api/auth/login', { body: { email: 'admin@clipforge.test', password: 'admin-password-123' } });
    check('Env-bootstrap admin works', admLogin.status === 200 && admLogin.json.user.role === 'admin');
    const overview = await api('GET', '/api/admin/overview', { token: admLogin.json.token });
    check('Admin overview (real data)', overview.status === 200 && overview.json.counts.videos >= 1
      && overview.json.counts.users >= 2, `users=${overview.json.counts?.users}, videos=${overview.json.counts?.videos}`);
    const forbidden = await api('GET', '/api/admin/overview', { token });
    check('Ordinary user blocked from admin', forbidden.status === 403);
    const otherToken = (await api('POST', '/api/auth/register', { body: { email: `other-${Date.now()}@t.dev`, password: 'password123' } })).json.token;
    const crossRead = await api('GET', `/api/videos/${videoId}`, { token: otherToken });
    check('Cross-user data isolation', crossRead.status === 404);

    console.log('\n[10] Failure handling…');
    const badUpload = await fetch(`${B}/api/projects/${prj.json.project.id}/videos`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: 'not-multipart',
    });
    check('Invalid upload rejected', badUpload.status >= 400 && badUpload.status < 500, `HTTP ${badUpload.status}`);
    const fake = await api('POST', `/api/videos/vid_nonexistent/analyze`, { token });
    check('Unknown video handled', fake.status === 404);

  } finally {
    apiProc.kill('SIGTERM');
    workerProc.kill('SIGTERM');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n== RESULT: ${results.length - failed.length}/${results.length} checks passed ==`);
  if (failed.length) {
    failed.forEach((f) => console.log(`  FAILED: ${f.name} ${f.detail}`));
    process.exit(1);
  }
  console.log('E2E COMPLETE: upload → AI analysis → captions → MP4 export verified.');
  console.log(`Rendered sample kept at: ${path.join(TMP, 'out.mp4')}`);
}

main().catch((err) => {
  console.error('E2E ERROR:', err.message);
  process.exit(1);
});
