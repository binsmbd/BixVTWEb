/* Palette mapping with a full set of dithering kernels. */
import { clamp } from '../core/util.js';
import { rgbDist2 } from './color.js';

/* Error-diffusion kernels: [dx, dy, weight] with a shared divisor. */
const KERNELS = {
  'floyd-steinberg': { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  'atkinson': { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  'jarvis': { div: 48, taps: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
  'stucki': { div: 42, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
  'sierra': { div: 32, taps: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]] },
  'sierra-lite': { div: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
  'burkes': { div: 32, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
};

export const DITHER_MODES = [
  'none', 'floyd-steinberg', 'atkinson', 'jarvis', 'stucki', 'sierra', 'sierra-lite', 'burkes',
  'bayer-2', 'bayer-4', 'bayer-8', 'noise', 'halftone-dot',
];

function bayerMatrix(size) {
  if (size === 2) return [[0, 2], [3, 1]];
  const prev = bayerMatrix(size / 2);
  const m = [];
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    m[y] = [];
    for (let x = 0; x < size; x++) {
      const q = (y < half ? 0 : 2) + (x < half ? 0 : 1);
      const base = [0, 2, 3, 1][q];
      m[y][x] = prev[y % half][x % half] * 4 + base;
    }
  }
  return m;
}

const BAYER = { 2: bayerMatrix(2), 4: bayerMatrix(4), 8: bayerMatrix(8) };

function nearest(pal, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i];
    const d = rgbDist2(r, g, b, p[0], p[1], p[2]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Map an ImageData onto a palette.
 * Returns { indexMap:Int32Array, imageData:ImageData } — indexMap feeds the vector tracers.
 */
export function quantizeToPalette(img, palette, { dither = 'none', strength = 1, serpentine = true, keepAlpha = true } = {}) {
  const { width: w, height: h } = img;
  const src = img.data;
  const indexMap = new Int32Array(w * h);
  const out = new ImageData(w, h);
  const o = out.data;

  const bayerKey = dither.startsWith('bayer-') ? Number(dither.split('-')[1]) : 0;
  const kernel = KERNELS[dither];

  if (kernel) {
    // Error diffusion needs a float working buffer.
    const buf = new Float32Array(w * h * 3);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      buf[p * 3] = src[i]; buf[p * 3 + 1] = src[i + 1]; buf[p * 3 + 2] = src[i + 2];
    }
    for (let y = 0; y < h; y++) {
      const leftToRight = !serpentine || y % 2 === 0;
      for (let k = 0; k < w; k++) {
        const x = leftToRight ? k : w - 1 - k;
        const p = y * w + x;
        const r = buf[p * 3], g = buf[p * 3 + 1], b = buf[p * 3 + 2];
        const idx = nearest(palette, r, g, b);
        const pc = palette[idx];
        indexMap[p] = idx;
        const er = (r - pc[0]) * strength, eg = (g - pc[1]) * strength, eb = (b - pc[2]) * strength;
        for (const [dx, dy, wt] of kernel.taps) {
          const nx = x + (leftToRight ? dx : -dx), ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = (ny * w + nx) * 3;
          const f = wt / kernel.div;
          buf[q] += er * f; buf[q + 1] += eg * f; buf[q + 2] += eb * f;
        }
      }
    }
  } else {
    const m = BAYER[bayerKey];
    const msize = bayerKey || 1;
    const spread = 42 * strength;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const i = p * 4;
        let r = src[i], g = src[i + 1], b = src[i + 2];
        if (m) {
          const t = (m[y % msize][x % msize] + 0.5) / (msize * msize) - 0.5;
          r += t * spread; g += t * spread; b += t * spread;
        } else if (dither === 'noise') {
          const t = (Math.random() - 0.5) * spread;
          r += t; g += t; b += t;
        } else if (dither === 'halftone-dot') {
          // 4x4 clustered-dot screen — reads like coarse print.
          const cd = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
          const t = (cd[y % 4][x % 4] + 0.5) / 16 - 0.5;
          r += t * spread; g += t * spread; b += t * spread;
        }
        indexMap[p] = nearest(palette, clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255));
      }
    }
  }

  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const c = palette[indexMap[p]];
    o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2];
    o[i + 3] = keepAlpha ? src[i + 3] : 255;
  }
  return { indexMap, imageData: out, palette };
}
