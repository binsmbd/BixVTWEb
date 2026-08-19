/* Bowyer–Watson Delaunay triangulation (compact, allocation-light). */

export function triangulate(points) {
  const nPts = points.length;
  if (nPts < 3) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  const dx = maxX - minX || 1, dy = maxY - minY || 1;
  const dmax = Math.max(dx, dy) * 12;
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;

  const pts = points.slice();
  // super-triangle
  pts.push([mx - dmax, my - dmax], [mx + dmax, my - dmax], [mx, my + dmax]);
  const s0 = nPts, s1 = nPts + 1, s2 = nPts + 2;

  let tris = [makeTri(pts, s0, s1, s2)];

  for (let i = 0; i < nPts; i++) {
    const [px, py] = pts[i];
    const bad = [];
    const kept = [];
    for (const t of tris) {
      const ddx = px - t.cx, ddy = py - t.cy;
      if (ddx * ddx + ddy * ddy <= t.r2) bad.push(t); else kept.push(t);
    }
    if (!bad.length) continue;
    // Boundary of the cavity = edges that appear exactly once.
    const edgeCount = new Map();
    for (const t of bad) {
      for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        const k = a < b ? a + ',' + b : b + ',' + a;
        edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
      }
    }
    for (const [k, c] of edgeCount) {
      if (c !== 1) continue;
      const [a, b] = k.split(',').map(Number);
      const t = makeTri(pts, a, b, i);
      if (t) kept.push(t);
    }
    tris = kept;
  }

  return tris
    .filter((t) => t.a !== s0 && t.a !== s1 && t.a !== s2 && t.b !== s0 && t.b !== s1 && t.b !== s2 && t.c !== s0 && t.c !== s1 && t.c !== s2)
    .map((t) => [t.a, t.b, t.c]);
}

function makeTri(pts, a, b, c) {
  const [ax, ay] = pts[a], [bx, by] = pts[b], [cx0, cy0] = pts[c];
  const d = 2 * (ax * (by - cy0) + bx * (cy0 - ay) + cx0 * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx0 * cx0 + cy0 * cy0;
  const cx = (a2 * (by - cy0) + b2 * (cy0 - ay) + c2 * (ay - by)) / d;
  const cy = (a2 * (cx0 - bx) + b2 * (ax - cx0) + c2 * (bx - ax)) / d;
  const r2 = (ax - cx) ** 2 + (ay - cy) ** 2;
  return { a, b, c, cx, cy, r2 };
}
