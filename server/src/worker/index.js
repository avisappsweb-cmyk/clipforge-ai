import { db, getSetting, migrate } from '../db.js';
import { runJob } from './pipeline.js';
import { config } from '../config.js';
import { ensureMediaDirs } from '../services/storage.js';

migrate();
ensureMediaDirs();

let running = false;
let stopped = false;

function claimNext() {
  const tx = db.transaction(() => {
    const limit = getSetting('limits.maxConcurrentJobs', config.limits.maxConcurrentJobs);
    const active = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'running'").get().n;
    if (active >= limit) return null;
    const job = db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get();
    return job || null;
  });
  return tx();
}

async function tick() {
  const job = claimNext();
  if (!job) return false;
  console.log(`[worker] running ${job.type} job ${job.id}`);
  try {
    await runJob(job);
    console.log(`[worker] job ${job.id} done`);
  } catch (err) {
    console.error(`[worker] job ${job.id} error: ${err.message}`);
  }
  return true;
}

export function startWorker() {
  console.log('[worker] CLIPFORGE worker started');
  const loop = async () => {
    while (!stopped) {
      try {
        const worked = await tick();
        if (!worked) await new Promise((r) => setTimeout(r, 1500));
      } catch (err) {
        console.error('[worker] loop error:', err.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };
  loop();
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (stopped) process.exit(0);
    stopped = true;
    console.log('[worker] shutting down after current job…');
    setTimeout(() => process.exit(0), 5000);
  });
}

startWorker();
