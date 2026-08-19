/* Point distributions used by low-poly, stipple, mosaic and particle transforms. */
import { mulberry32, clamp } from '../core/util.js';

/**
 * Importance sampling with a blue-noise flavour: candidates are drawn where the
 * density map is high, then Mitchell's best-candidate keeps them well spaced.
 */
export function importanceSample(density, w, h, count, { seed = 1, candidates = 8, bias = 1 } = {}) {
  const rnd = mulberry32(seed);
  // Build a cumulative distribution over rows then columns for fast draws.
  const rowSum = new Float64Array(h);
  const cdf = new Float64Array(w * h);
  let total = 0;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = 0; x < w; x++) {
      const v = Math.pow(Math.max(0, density[y * w + x]), bias);
      acc += v;
      cdf[y * w + x] = acc;
    }
    rowSum[y] = acc;
    total += acc;
  }
  const rowCdf = new Float64Array(h);
  let acc = 0;
  for (let y = 0; y < h; y++) { acc += rowSum[y]; rowCdf[y] = acc; }
  if (total <= 0) return [];

  const pick = () => {
    const r = rnd() * total;
    let lo = 0, hi = h - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rowCdf[mid] < r) lo = mid + 1; else hi = mid; }
    const y = lo;
    const base = y > 0 ? rowCdf[y - 1] : 0;
    const rr = r - base;
    let a = 0, b = w - 1;
    while (a < b) { const mid = (a + b) >> 1; if (cdf[y * w + mid] < rr) a = mid + 1; else b = mid; }
    return [a + rnd(), y + rnd()];
  };

  const pts = [];
  const cell = Math.max(2, Math.sqrt((w * h) / Math.max(1, count)));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Map();
  const gkey = (x, y) => ((y / cell) | 0) * gw + ((x / cell) | 0);

  for (let i = 0; i < count; i++) {
    let best = null, bestD = -1;
    for (let c = 0; c < candidates; c++) {
      const p = pick();
      let nearest = Infinity;
      const gx = (p[0] / cell) | 0, gy = (p[1] / cell) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = gx + ox, ny = gy + oy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const bucket = grid.get(ny * gw + nx);
          if (!bucket) continue;
          for (const q of bucket) {
            const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
            if (d < nearest) nearest = d;
          }
        }
      }
      if (nearest > bestD) { bestD = nearest; best = p; }
    }
    if (!best) break;
    pts.push(best);
    const k = gkey(clamp(best[0], 0, w - 1), clamp(best[1], 0, h - 1));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(best);
  }
  return pts;
}

/**
 * Lloyd relaxation against a density field — turns rough samples into the even,
 * organic spacing that makes stipple and mosaic output look hand-made.
 */
export function relax(points, density, w, h, iterations = 1, step = 2) {
  if (iterations <= 0 || points.length < 2) return points;
  let pts = points.map((p) => p.slice());
  const cell = Math.max(2, Math.sqrt((w * h) / pts.length));
  for (let it = 0; it < iterations; it++) {
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const grid = new Map();
    pts.forEach((p, i) => {
      const k = Math.min(gh - 1, (p[1] / cell) | 0) * gw + Math.min(gw - 1, (p[0] / cell) | 0);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const sums = pts.map(() => [0, 0, 0]);
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const wgt = Math.max(1e-4, density[y * w + x]);
        const gx = Math.min(gw - 1, (x / cell) | 0), gy = Math.min(gh - 1, (y / cell) | 0);
        let best = -1, bd = Infinity;
        for (let r = 1; r <= 2 && best === -1; r++) {
          for (let oy = -r; oy <= r; oy++) {
            for (let ox = -r; ox <= r; ox++) {
              const nx = gx + ox, ny = gy + oy;
              if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
              const bucket = grid.get(ny * gw + nx);
              if (!bucket) continue;
              for (const i of bucket) {
                const d = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2;
                if (d < bd) { bd = d; best = i; }
              }
            }
          }
        }
        if (best === -1) continue;
        sums[best][0] += x * wgt;
        sums[best][1] += y * wgt;
        sums[best][2] += wgt;
      }
    }
    pts = pts.map((p, i) => (sums[i][2] > 0 ? [sums[i][0] / sums[i][2], sums[i][1] / sums[i][2]] : p));
  }
  return pts;
}

/** Plain jittered grid — predictable structure for mosaics and halftones. */
export function jitteredGrid(w, h, spacing, jitter = 0.4, seed = 1) {
  const rnd = mulberry32(seed);
  const pts = [];
  for (let y = spacing / 2; y < h; y += spacing) {
    for (let x = spacing / 2; x < w; x += spacing) {
      pts.push([x + (rnd() - 0.5) * spacing * jitter, y + (rnd() - 0.5) * spacing * jitter]);
    }
  }
  return pts;
}

/** Hexagonal lattice — used by the hex mosaic mode. */
export function hexGrid(w, h, spacing) {
  const pts = [];
  const dy = spacing * 0.866;
  let row = 0;
  for (let y = 0; y <= h + dy; y += dy, row++) {
    const off = row % 2 ? spacing / 2 : 0;
    for (let x = off; x <= w + spacing; x += spacing) pts.push([x, y]);
  }
  return pts;
}
