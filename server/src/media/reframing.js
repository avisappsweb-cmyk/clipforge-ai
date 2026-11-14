export function computeTrackingKeyframes({ energy, speechRegions, scenes, duration, clipStart, clipEnd, windowSec = 2.0 }) {
  // Build a subject-centroid proxy trajectory from audio attention: the energy
  // centroid over a sliding window biases the crop center, smoothed per second.
  const keyframes = [];
  const hop = energy?.hop || 0.05;
  const vals = energy?.values || [];
  for (let t = clipStart; t <= clipEnd; t += 0.5) {
    let offset = 0;
    if (vals.length) {
      const i0 = Math.max(0, Math.floor((t - windowSec) / hop));
      const i1 = Math.min(vals.length, Math.ceil(t / hop));
      let weighted = 0;
      let total = 0;
      for (let i = i0; i < i1; i++) {
        const time = i * hop;
        const w = vals[i] + 1e-4;
        weighted += (time - t) * w;
        total += w;
      }
      const centroid = total > 0 ? weighted / total : 0;
      offset = Math.max(-1, Math.min(1, centroid / (windowSec / 2)));
    }
    keyframes.push({ t: Math.round((t - clipStart) * 10) / 10, offset: Math.round(offset * 100) / 100 });
  }
  return keyframes;
}

export function buildCropExpression(keyframes, inW, outW, maxShiftFrac = 0.6) {
  const maxShift = Math.floor((inW - outW) / 2 * maxShiftFrac);
  const center = Math.round((inW - outW) / 2);
  if (!keyframes.length || maxShift <= 2) return String(center);
  let pts = keyframes.slice();
  if (pts.length > 20) {
    const stride = Math.ceil(pts.length / 20);
    const reduced = pts.filter((_, i) => i % stride === 0);
    if (reduced[reduced.length - 1].t !== pts[pts.length - 1].t) reduced.push(pts[pts.length - 1]);
    pts = reduced;
  }
  const xs = pts.map((p) => Math.round(center + p.offset * maxShift));
  const ts = pts.map((p) => p.t);
  let expr = String(xs[xs.length - 1]);
  for (let i = xs.length - 2; i >= 0; i--) {
    const span = Math.max(0.01, ts[i + 1] - ts[i]);
    const lerp = `(${xs[i]}+(${xs[i + 1]}-(${xs[i]}))*min(1,max(0,(t-${ts[i]})/${span})))`;
    expr = `if(lt(t,${ts[i + 1]}),${lerp},${expr})`;
  }
  return expr;
}
