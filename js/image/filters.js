/* Core raster filters: blur, gradients, edge detection, morphology, luminance maps. */
import { clamp } from '../core/util.js';
import { luma } from './color.js';

export function cloneImageData(img) {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

export function makeImageData(w, h, fill = [0, 0, 0, 0]) {
  const img = new ImageData(w, h);
  if (fill[3] !== 0) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = fill[3];
    }
  }
  return img;
}

/** Float32 luminance map, 0..255. */
export function lumaMap(img) {
  const { width: w, height: h, data: d } = img;
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const a = d[i + 3] / 255;
    // Un-matted alpha: treat transparency as white so cut-outs trace cleanly.
    out[p] = luma(d[i], d[i + 1], d[i + 2]) * a + 255 * (1 - a);
  }
  return out;
}

/** Separable box blur on a Float32 plane; repeat 3x to approximate a gaussian. */
export function boxBlurPlane(src, w, h, radius, passes = 3) {
  if (radius <= 0) return src;
  let a = Float32Array.from(src);
  let b = new Float32Array(w * h);
  const r = Math.max(1, Math.round(radius));
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += a[row + clamp(i, 0, w - 1)];
      const inv = 1 / (2 * r + 1);
      for (let x = 0; x < w; x++) {
        b[row + x] = sum * inv;
        sum += a[row + clamp(x + r + 1, 0, w - 1)] - a[row + clamp(x - r, 0, w - 1)];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += b[clamp(i, 0, h - 1) * w + x];
      const inv = 1 / (2 * r + 1);
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum * inv;
        sum += b[clamp(y + r + 1, 0, h - 1) * w + x] - b[clamp(y - r, 0, h - 1) * w + x];
      }
    }
  }
  return a;
}

/** Blur an ImageData in place-ish (returns a new ImageData). */
export function blurImage(img, radius, passes = 3) {
  if (radius <= 0) return img;
  const { width: w, height: h } = img;
  const planes = [0, 1, 2, 3].map((c) => {
    const pl = new Float32Array(w * h);
    for (let i = 0, p = 0; p < w * h; i += 4, p++) pl[p] = img.data[i + c];
    return boxBlurPlane(pl, w, h, radius, passes);
  });
  const out = new ImageData(w, h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    out.data[i] = planes[0][p];
    out.data[i + 1] = planes[1][p];
    out.data[i + 2] = planes[2][p];
    out.data[i + 3] = planes[3][p];
  }
  return out;
}

/** Sobel gradients. Returns {mag, dir} where dir is the gradient angle in radians. */
export function sobel(lum, w, h) {
  const mag = new Float32Array(w * h);
  const dir = new Float32Array(w * h);
  const at = (x, y) => lum[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const gx = -tl - 2 * l - bl + tr + 2 * r + br;
      const gy = -tl - 2 * t - tr + bl + 2 * b + br;
      const i = y * w + x;
      mag[i] = Math.hypot(gx, gy);
      dir[i] = Math.atan2(gy, gx);
    }
  }
  return { mag, dir };
}

/** Canny-style edge map (0/1) with non-maximum suppression + hysteresis. */
export function canny(lum, w, h, { blur = 1.2, low = 20, high = 55 } = {}) {
  const sm = boxBlurPlane(lum, w, h, blur, 2);
  const { mag, dir } = sobel(sm, w, h);
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let a = ((dir[i] * 180) / Math.PI + 180) % 180;
      let p, q;
      if (a < 22.5 || a >= 157.5) { p = mag[i - 1]; q = mag[i + 1]; }
      else if (a < 67.5) { p = mag[i - w - 1]; q = mag[i + w + 1]; }
      else if (a < 112.5) { p = mag[i - w]; q = mag[i + w]; }
      else { p = mag[i - w + 1]; q = mag[i + w - 1]; }
      nms[i] = mag[i] >= p && mag[i] >= q ? mag[i] : 0;
    }
  }
  const out = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < nms.length; i++) if (nms[i] >= high) { out[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!out[j] && nms[j] >= low) { out[j] = 1; stack.push(j); }
      }
    }
  }
  return out;
}

/** Difference of gaussians — softer, more illustrative edges than Sobel. */
export function dog(lum, w, h, { r1 = 1, r2 = 3, sharpness = 1 } = {}) {
  const a = boxBlurPlane(lum, w, h, r1, 2);
  const b = boxBlurPlane(lum, w, h, r2, 2);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (a[i] - b[i]) * sharpness;
  return out;
}

/** Binary threshold of a luminance plane, optionally adaptive (local mean). */
export function threshold(lum, w, h, level = 128, { adaptive = false, radius = 12, bias = 6, invert = false } = {}) {
  const mask = new Uint8Array(w * h);
  if (adaptive) {
    const mean = boxBlurPlane(lum, w, h, radius, 2);
    for (let i = 0; i < mask.length; i++) {
      const on = lum[i] < mean[i] - bias;
      mask[i] = (invert ? !on : on) ? 1 : 0;
    }
  } else {
    for (let i = 0; i < mask.length; i++) {
      const on = lum[i] < level;
      mask[i] = (invert ? !on : on) ? 1 : 0;
    }
  }
  return mask;
}

/** Otsu automatic threshold level for a luminance plane. */
export function otsu(lum) {
  const hist = new Float64Array(256);
  for (let i = 0; i < lum.length; i++) hist[clamp(Math.round(lum[i]), 0, 255)]++;
  const total = lum.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

export function dilate(mask, w, h, r = 1) {
  if (r <= 0) return mask;
  let cur = mask;
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1 && !v; dy++) {
          for (let dx = -1; dx <= 1 && !v; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (cur[ny * w + nx]) v = 1;
          }
        }
        out[y * w + x] = v;
      }
    }
    cur = out;
  }
  return cur;
}

export function erode(mask, w, h, r = 1) {
  if (r <= 0) return mask;
  let cur = mask;
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 1;
        for (let dy = -1; dy <= 1 && v; dy++) {
          for (let dx = -1; dx <= 1 && v; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !cur[ny * w + nx]) v = 0;
          }
        }
        out[y * w + x] = v;
      }
    }
    cur = out;
  }
  return cur;
}

/** Zhang–Suen thinning — reduces a mask to a 1px skeleton for centreline tracing. */
export function skeletonize(mask, w, h, maxIter = 60) {
  const img = Uint8Array.from(mask);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  let changed = true, iter = 0;
  while (changed && iter++ < maxIter) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      const kill = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!at(x, y)) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const bp = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (bp < 2 || bp > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let ap = 0;
          for (let i = 0; i < 8; i++) if (seq[i] === 0 && seq[i + 1] === 1) ap++;
          if (ap !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          kill.push(y * w + x);
        }
      }
      if (kill.length) { changed = true; for (const i of kill) img[i] = 0; }
    }
  }
  return img;
}

/** Connected-component labelling (4 or 8 connectivity) over an index map. */
export function labelComponents(indexMap, w, h, connectivity = 8) {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const values = [];
  const stack = new Int32Array(w * h);
  let next = 0;
  const neigh4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const neigh8 = [...neigh4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const nb = connectivity === 4 ? neigh4 : neigh8;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== -1) continue;
    const val = indexMap[i];
    const id = next++;
    let sp = 0, count = 0;
    stack[sp++] = i;
    labels[i] = id;
    while (sp > 0) {
      const cur = stack[--sp];
      count++;
      const cx = cur % w, cy = (cur / w) | 0;
      for (const [dx, dy] of nb) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (labels[j] === -1 && indexMap[j] === val) { labels[j] = id; stack[sp++] = j; }
      }
    }
    sizes.push(count);
    values.push(val);
  }
  return { labels, sizes, values, count: next };
}

/** Remove specks smaller than minArea by absorbing them into the dominant neighbour. */
export function despeckle(indexMap, w, h, minArea, connectivity = 8) {
  if (minArea <= 1) return indexMap;
  const out = Int32Array.from(indexMap);
  const { labels, sizes } = labelComponents(indexMap, w, h, connectivity);
  const small = new Set();
  for (let i = 0; i < sizes.length; i++) if (sizes[i] < minArea) small.add(i);
  if (!small.size) return out;
  // Repeat a few times so nested specks collapse outward.
  for (let pass = 0; pass < 3 && small.size; pass++) {
    const changes = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!small.has(labels[i])) continue;
        const tally = new Map();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (labels[j] === labels[i]) continue;
          tally.set(out[j], (tally.get(out[j]) || 0) + 1);
        }
        let bestV = null, bestC = 0;
        for (const [v, c] of tally) if (c > bestC) { bestC = c; bestV = v; }
        if (bestV != null) changes.push([i, bestV]);
      }
    }
    if (!changes.length) break;
    for (const [i, v] of changes) out[i] = v;
  }
  return out;
}

/** Kuwahara filter — the classic "oil paint" look, edge preserving. */
export function kuwahara(img, radius = 4) {
  const { width: w, height: h, data: d } = img;
  const out = new ImageData(w, h);
  const o = out.data;
  const r = Math.max(1, radius | 0);
  const quads = [[-r, -r], [0, -r], [-r, 0], [0, 0]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let bestVar = Infinity, bR = 0, bG = 0, bB = 0;
      for (const [ox, oy] of quads) {
        let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, cnt = 0;
        for (let dy = 0; dy <= r; dy++) {
          const yy = clamp(y + oy + dy, 0, h - 1);
          for (let dx = 0; dx <= r; dx++) {
            const xx = clamp(x + ox + dx, 0, w - 1);
            const i = (yy * w + xx) * 4;
            const R = d[i], G = d[i + 1], B = d[i + 2];
            const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
            sr += R; sg += G; sb += B; sl += L; sl2 += L * L; cnt++;
          }
        }
        const mean = sl / cnt;
        const varr = sl2 / cnt - mean * mean;
        if (varr < bestVar) { bestVar = varr; bR = sr / cnt; bG = sg / cnt; bB = sb / cnt; }
      }
      const i = (y * w + x) * 4;
      o[i] = bR; o[i + 1] = bG; o[i + 2] = bB; o[i + 3] = d[i + 3];
    }
  }
  return out;
}

/** Bilinear sample of an ImageData; returns [r,g,b,a]. */
export function sampleBilinear(img, x, y) {
  const { width: w, height: h, data: d } = img;
  const x0 = clamp(Math.floor(x), 0, w - 1), y0 = clamp(Math.floor(y), 0, h - 1);
  const x1 = clamp(x0 + 1, 0, w - 1), y1 = clamp(y0 + 1, 0, h - 1);
  const fx = clamp(x - x0, 0, 1), fy = clamp(y - y0, 0, 1);
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const a = d[(y0 * w + x0) * 4 + c] * (1 - fx) + d[(y0 * w + x1) * 4 + c] * fx;
    const b = d[(y1 * w + x0) * 4 + c] * (1 - fx) + d[(y1 * w + x1) * 4 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
}

/** Average colour of a rectangular region. */
export function averageRegion(img, x0, y0, x1, y1) {
  const { width: w, height: h, data: d } = img;
  x0 = clamp(Math.floor(x0), 0, w - 1); x1 = clamp(Math.ceil(x1), 1, w);
  y0 = clamp(Math.floor(y0), 0, h - 1); y1 = clamp(Math.ceil(y1), 1, h);
  let r = 0, g = 0, b = 0, a = 0, c = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; c++;
    }
  }
  if (!c) return [0, 0, 0, 0];
  return [r / c, g / c, b / c, a / c];
}
