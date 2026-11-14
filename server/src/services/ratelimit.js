const buckets = new Map();

export function rateLimit({ windowMs = 60000, max = 30, key = null } = {}) {
  return (req, reply, done) => {
    const ip = req.ip || 'unknown';
    const bucketKey = `${key || req.url.split('?')[0]}:${ip}`;
    const now = Date.now();
    let b = buckets.get(bucketKey);
    if (!b || now - b.start > windowMs) {
      b = { start: now, count: 0 };
      buckets.set(bucketKey, b);
    }
    b.count += 1;
    if (b.count > max) {
      reply.code(429).send({ error: 'Too many requests. Please slow down and try again shortly.' });
      return;
    }
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) {
        if (now - v.start > windowMs * 2) buckets.delete(k);
      }
    }
    done();
  };
}
