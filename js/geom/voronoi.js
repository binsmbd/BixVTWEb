/* Voronoi cells built from the Delaunay dual, clipped to the canvas. */
import { triangulate } from './delaunay.js';

function circumcenter(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
  return [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
  ];
}

/** Sutherland–Hodgman clip of a convex-ish polygon against an axis-aligned box. */
export function clipToBox(poly, x0, y0, x1, y1) {
  let out = poly;
  const edges = [
    (p) => p[0] >= x0, (p, q) => interp(p, q, (x0 - p[0]) / (q[0] - p[0])),
    (p) => p[0] <= x1, (p, q) => interp(p, q, (x1 - p[0]) / (q[0] - p[0])),
    (p) => p[1] >= y0, (p, q) => interp(p, q, (y0 - p[1]) / (q[1] - p[1])),
    (p) => p[1] <= y1, (p, q) => interp(p, q, (y1 - p[1]) / (q[1] - p[1])),
  ];
  function interp(p, q, t) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }
  for (let e = 0; e < edges.length; e += 2) {
    const inside = edges[e], cut = edges[e + 1];
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) {
        out.push(cut(prev, cur));
      }
    }
    if (!out.length) return [];
  }
  return out;
}

/**
 * @returns {Array<Array<[number,number]>|null>} one polygon per input point
 */
export function voronoi(points, width, height) {
  const far = Math.max(width, height) * 12;
  const ghosts = [
    [-far, -far], [width + far, -far], [-far, height + far], [width + far, height + far],
    [width / 2, -far], [width / 2, height + far], [-far, height / 2], [width + far, height / 2],
  ];
  const all = points.concat(ghosts);
  const tris = triangulate(all);

  const incident = Array.from({ length: points.length }, () => []);
  const centers = [];
  for (const [a, b, c] of tris) {
    const cc = circumcenter(all[a], all[b], all[c]);
    if (!cc) continue;
    const ci = centers.push(cc) - 1;
    for (const v of [a, b, c]) if (v < points.length) incident[v].push(ci);
  }

  return incident.map((list, i) => {
    if (list.length < 3) return null;
    const [px, py] = points[i];
    const sorted = list
      .map((ci) => centers[ci])
      .sort((p, q) => Math.atan2(p[1] - py, p[0] - px) - Math.atan2(q[1] - py, q[0] - px));
    const clipped = clipToBox(sorted, 0, 0, width, height);
    return clipped.length >= 3 ? clipped : null;
  });
}
