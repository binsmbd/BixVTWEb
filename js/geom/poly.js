/* Polyline simplification, smoothing and SVG path emission. */
import { n } from '../core/util.js';

/** Ramer–Douglas–Peucker simplification (iterative, no recursion blow-ups). */
export function simplify(points, tolerance = 1) {
  if (tolerance <= 0 || points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1, fd = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) {
        d = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d > fd) { fd = d; far = i; }
    }
    if (fd > t2 && far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a closed ring while keeping it closed. */
export function simplifyClosed(points, tolerance = 1) {
  if (points.length < 4) return points;
  const closed = points.concat([points[0]]);
  const s = simplify(closed, tolerance);
  s.pop();
  return s;
}

export function perimeter(points, closed = false) {
  let p = 0;
  for (let i = 1; i < points.length; i++) p += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (closed && points.length > 2) p += Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]);
  return p;
}

export function bounds(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Chaikin corner cutting — cheap organic rounding before curve fitting. */
export function chaikin(points, iterations = 1, closed = true) {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    const len = pts.length;
    const limit = closed ? len : len - 1;
    if (!closed) out.push(pts[0]);
    for (let i = 0; i < limit; i++) {
      const a = pts[i], b = pts[(i + 1) % len];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(pts[len - 1]);
    pts = out;
  }
  return pts;
}

function angleAt(prev, cur, next) {
  const a1 = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]);
  const a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
  let d = a2 - a1;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * Emit an SVG path for a ring, converting smooth runs into cubic béziers via
 * Catmull–Rom and keeping sharp corners as hard vertices.
 * smooth = 0 → pure polygon, 1 → fully rounded.
 */
export function ringToPath(points, { smooth = 0.6, cornerAngle = 1.05, cornerMinLen = 2.2, precision = 2 } = {}) {
  const pts = points;
  const len = pts.length;
  if (len < 3) return '';
  if (smooth <= 0.001) {
    let d = `M${n(pts[0][0], precision)} ${n(pts[0][1], precision)}`;
    for (let i = 1; i < len; i++) d += `L${n(pts[i][0], precision)} ${n(pts[i][1], precision)}`;
    return d + 'Z';
  }
  // A vertex only counts as a real corner when the turn is sharp *and* both of
  // its segments are long enough to be a deliberate edge. Without the length
  // test every 90° step of the pixel staircase reads as a corner and the curve
  // fitter degenerates back into a polygon.
  const segLen = (i) => Math.hypot(pts[(i + 1) % len][0] - pts[i][0], pts[(i + 1) % len][1] - pts[i][1]);
  const corner = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const p = pts[(i - 1 + len) % len], c = pts[i], nx = pts[(i + 1) % len];
    const sharp = angleAt(p, c, nx) > cornerAngle;
    const solid = Math.min(segLen((i - 1 + len) % len), segLen(i)) >= cornerMinLen;
    corner[i] = sharp && solid ? 1 : 0;
  }
  const k = smooth / 6;
  let d = `M${n(pts[0][0], precision)} ${n(pts[0][1], precision)}`;
  for (let i = 0; i < len; i++) {
    const p0 = pts[(i - 1 + len) % len];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % len];
    const p3 = pts[(i + 2) % len];
    if (corner[i] && corner[(i + 1) % len]) {
      d += `L${n(p2[0], precision)} ${n(p2[1], precision)}`;
      continue;
    }
    const t1 = corner[i] ? 0 : k;
    const t2 = corner[(i + 1) % len] ? 0 : k;
    const c1x = p1[0] + (p2[0] - p0[0]) * t1;
    const c1y = p1[1] + (p2[1] - p0[1]) * t1;
    const c2x = p2[0] - (p3[0] - p1[0]) * t2;
    const c2y = p2[1] - (p3[1] - p1[1]) * t2;
    d += `C${n(c1x, precision)} ${n(c1y, precision)} ${n(c2x, precision)} ${n(c2y, precision)} ${n(p2[0], precision)} ${n(p2[1], precision)}`;
  }
  return d + 'Z';
}

/** Same idea for open polylines (strokes). */
export function polylineToPath(points, { smooth = 0.6, precision = 2, close = false } = {}) {
  const len = points.length;
  if (len < 2) return '';
  if (smooth <= 0.001) {
    let d = `M${n(points[0][0], precision)} ${n(points[0][1], precision)}`;
    for (let i = 1; i < len; i++) d += `L${n(points[i][0], precision)} ${n(points[i][1], precision)}`;
    return d + (close ? 'Z' : '');
  }
  const k = smooth / 6;
  let d = `M${n(points[0][0], precision)} ${n(points[0][1], precision)}`;
  for (let i = 0; i < len - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(len - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) * k;
    const c1y = p1[1] + (p2[1] - p0[1]) * k;
    const c2x = p2[0] - (p3[0] - p1[0]) * k;
    const c2y = p2[1] - (p3[1] - p1[1]) * k;
    d += `C${n(c1x, precision)} ${n(c1y, precision)} ${n(c2x, precision)} ${n(c2y, precision)} ${n(p2[0], precision)} ${n(p2[1], precision)}`;
  }
  return d + (close ? 'Z' : '');
}

/** Scale + offset a set of rings (used to fit traces back to source resolution). */
export function transformRings(rings, sx, sy, ox = 0, oy = 0) {
  return rings.map((r) => r.map(([x, y]) => [x * sx + ox, y * sy + oy]));
}

/**
 * Build a variable-width ribbon polygon around a polyline.
 * Gives true tapering strokes that stay a single filled path in the SVG.
 */
export function ribbon(points, widths) {
  const L = points.length;
  if (L < 2) return [];
  const left = [], right = [];
  for (let i = 0; i < L; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(L - 1, i + 1)];
    let tx = next[0] - prev[0], ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    const hw = Math.max(0.02, (widths[i] ?? widths[0]) / 2);
    left.push([points[i][0] - ty * hw, points[i][1] + tx * hw]);
    right.push([points[i][0] + ty * hw, points[i][1] - tx * hw]);
  }
  return left.concat(right.reverse());
}
