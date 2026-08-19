/*
 * Pixel-boundary contour tracing.
 *
 * Walks the exact boundary between "on" and "off" pixels, so contours of
 * neighbouring colour regions share identical vertices — no seams or hairline
 * gaps in the exported SVG. Loops come out with consistent winding (outer
 * boundaries one way, holes the other) so SVG's nonzero fill-rule just works.
 */

/**
 * @param {Uint8Array|Int32Array} mask  1 = inside, 0 = outside
 * @returns {Array<Array<[number,number]>>} closed loops in pixel coordinates
 */
export function traceMask(mask, w, h, { connectivity = 4 } = {}) {
  // Directions: 0 = +x, 1 = +y, 2 = -x, 3 = -y
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const gw = w + 1;

  // Bucket every boundary edge by its start vertex.
  const heads = new Int32Array(gw * (h + 1)).fill(-1);
  const nextEdge = [];
  const edgeSX = [], edgeSY = [], edgeDir = [];
  const used = [];

  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x] ? 1 : 0);

  function addEdge(sx, sy, dir) {
    const id = edgeDir.length;
    edgeSX.push(sx); edgeSY.push(sy); edgeDir.push(dir); used.push(0);
    const key = sy * gw + sx;
    nextEdge.push(heads[key]);
    heads[key] = id;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) addEdge(x, y, 0);           // top edge, +x
      if (!at(x + 1, y)) addEdge(x + 1, y, 1);       // right edge, +y
      if (!at(x, y + 1)) addEdge(x + 1, y + 1, 2);   // bottom edge, -x
      if (!at(x - 1, y)) addEdge(x, y + 1, 3);       // left edge, -y
    }
  }

  // Turn preference at a vertex shared by two diagonal cells:
  //   4-connected foreground keeps the diagonal touch split,
  //   8-connected merges the two regions into one contour.
  const order = connectivity === 8 ? [3, 0, 1] : [1, 0, 3];

  const loops = [];
  for (let start = 0; start < edgeDir.length; start++) {
    if (used[start]) continue;
    const pts = [];
    let e = start;
    let guard = edgeDir.length * 4 + 8;
    while (e !== -1 && !used[e] && guard-- > 0) {
      used[e] = 1;
      pts.push([edgeSX[e], edgeSY[e]]);
      const ex = edgeSX[e] + DX[edgeDir[e]];
      const ey = edgeSY[e] + DY[edgeDir[e]];
      const d = edgeDir[e];
      let found = -1;
      for (const turn of order) {
        const want = (d + turn) % 4;
        for (let c = heads[ey * gw + ex]; c !== -1; c = nextEdge[c]) {
          if (!used[c] && edgeDir[c] === want) { found = c; break; }
        }
        if (found !== -1) break;
      }
      e = found;
    }
    if (pts.length >= 4) loops.push(pts);
  }
  return loops;
}

/** Signed area (positive = clockwise in screen coords with y pointing down). */
export function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] * pts[i][1]) - (pts[i][0] * pts[j][1]);
  }
  return a / 2;
}

/** Extract a binary mask for one index value out of an index map. */
export function maskFromIndex(indexMap, w, h, value) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = indexMap[i] === value ? 1 : 0;
  return m;
}

/**
 * Marching squares over a scalar field — used for topographic contour lines and
 * for tracing soft (anti-aliased) thresholds where sub-pixel accuracy matters.
 * Returns open/closed polylines at the given iso level.
 */
export function marchingSquares(field, w, h, level) {
  const segs = [];
  const interp = (x1, y1, v1, x2, y2, v2) => {
    const t = (level - v1) / (v2 - v1 || 1e-6);
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = field[y * w + x], tr = field[y * w + x + 1];
      const bl = field[(y + 1) * w + x], br = field[(y + 1) * w + x + 1];
      let idx = 0;
      if (tl > level) idx |= 1;
      if (tr > level) idx |= 2;
      if (br > level) idx |= 4;
      if (bl > level) idx |= 8;
      if (idx === 0 || idx === 15) continue;
      const top = () => interp(x, y, tl, x + 1, y, tr);
      const right = () => interp(x + 1, y, tr, x + 1, y + 1, br);
      const bottom = () => interp(x + 1, y + 1, br, x, y + 1, bl);
      const left = () => interp(x, y + 1, bl, x, y, tl);
      switch (idx) {
        case 1: case 14: segs.push([left(), top()]); break;
        case 2: case 13: segs.push([top(), right()]); break;
        case 3: case 12: segs.push([left(), right()]); break;
        case 4: case 11: segs.push([right(), bottom()]); break;
        case 6: case 9: segs.push([top(), bottom()]); break;
        case 7: case 8: segs.push([left(), bottom()]); break;
        case 5: segs.push([left(), top()], [right(), bottom()]); break;
        case 10: segs.push([top(), right()], [left(), bottom()]); break;
      }
    }
  }
  return linkSegments(segs);
}

/** Join loose segments into polylines by matching endpoints on a hash grid. */
export function linkSegments(segs, eps = 0.02) {
  const key = (p) => `${Math.round(p[0] / eps)}_${Math.round(p[1] / eps)}`;
  const map = new Map();
  segs.forEach((s, i) => {
    for (const p of [s[0], s[1]]) {
      const k = key(p);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const paths = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const path = [segs[i][0], segs[i][1]];
    // extend both ends
    for (let dir = 0; dir < 2; dir++) {
      let guard = segs.length + 4;
      while (guard-- > 0) {
        const end = dir === 0 ? path[path.length - 1] : path[0];
        const cands = map.get(key(end)) || [];
        let next = -1, np = null;
        for (const c of cands) {
          if (used[c]) continue;
          const s = segs[c];
          if (key(s[0]) === key(end)) { next = c; np = s[1]; break; }
          if (key(s[1]) === key(end)) { next = c; np = s[0]; break; }
        }
        if (next === -1) break;
        used[next] = 1;
        if (dir === 0) path.push(np); else path.unshift(np);
      }
    }
    if (path.length >= 2) paths.push(path);
  }
  return paths;
}

/**
 * Walk a 1px skeleton into polylines, splitting at junctions.
 * Powers centreline (stroke) vectorisation.
 */
export function traceSkeleton(skel, w, h, { minLength = 3 } = {}) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : skel[y * w + x]);
  const NB = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const degree = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      let d = 0;
      for (const [dx, dy] of NB) if (at(x + dx, y + dy)) d++;
      degree[y * w + x] = d;
    }
  }
  const visitedEdge = new Set();
  const ekey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
  const paths = [];

  function walk(sx, sy) {
    let cx = sx, cy = sy;
    const pts = [[cx + 0.5, cy + 0.5]];
    for (;;) {
      const ci = cy * w + cx;
      let nx = -1, ny = -1;
      for (const [dx, dy] of NB) {
        const tx = cx + dx, ty = cy + dy;
        if (!at(tx, ty)) continue;
        const k = ekey(ci, ty * w + tx);
        if (visitedEdge.has(k)) continue;
        nx = tx; ny = ty;
        break;
      }
      if (nx === -1) break;
      visitedEdge.add(ekey(ci, ny * w + nx));
      cx = nx; cy = ny;
      pts.push([cx + 0.5, cy + 0.5]);
      if (degree[cy * w + cx] !== 2) break; // stop at endpoints and junctions
    }
    if (pts.length >= minLength) paths.push(pts);
  }

  // Start from endpoints and junctions first so strokes read naturally…
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      const d = degree[y * w + x];
      if (d === 2) continue;
      let guard = 10;
      while (guard-- > 0) {
        const before = visitedEdge.size;
        walk(x, y);
        if (visitedEdge.size === before) break;
      }
    }
  }
  // …then pick up any remaining closed rings.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      const ci = y * w + x;
      let free = false;
      for (const [dx, dy] of NB) {
        const tx = x + dx, ty = y + dy;
        if (at(tx, ty) && !visitedEdge.has(ekey(ci, ty * w + tx))) { free = true; break; }
      }
      if (free) walk(x, y);
    }
  }
  return paths;
}
