/* Colour quantisation: median cut, k-means refinement and fixed palettes. */
import { PALETTES, paletteHexToRgb, rgbDist2, luma } from './color.js';
import { mulberry32 } from '../core/util.js';

/** Collect pixels (optionally subsampled) as a flat array of [r,g,b]. */
function collect(img, maxSamples = 30000) {
  const { data: d } = img;
  const total = d.length / 4;
  const step = Math.max(1, Math.floor(total / maxSamples));
  const out = [];
  for (let p = 0; p < total; p += step) {
    const i = p * 4;
    if (d[i + 3] < 8) continue;
    out.push([d[i], d[i + 1], d[i + 2]]);
  }
  return out;
}

export function medianCut(img, count, opts = {}) {
  const pixels = collect(img, opts.samples || 30000);
  if (!pixels.length) return [[0, 0, 0]];
  let boxes = [pixels];
  while (boxes.length < count) {
    // Split the box with the largest weighted channel range.
    let bi = -1, bScore = -1, bChan = 0;
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i];
      if (bx.length < 2) continue;
      let mn = [255, 255, 255], mx = [0, 0, 0];
      for (const p of bx) {
        for (let c = 0; c < 3; c++) {
          if (p[c] < mn[c]) mn[c] = p[c];
          if (p[c] > mx[c]) mx[c] = p[c];
        }
      }
      const w = [1.0, 1.2, 0.8];
      for (let c = 0; c < 3; c++) {
        const score = (mx[c] - mn[c]) * w[c] * Math.log2(bx.length + 1);
        if (score > bScore) { bScore = score; bi = i; bChan = c; }
      }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    box.sort((a, b) => a[bChan] - b[bChan]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter((b) => b.length).map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    return [r / b.length, g / b.length, bl / b.length];
  });
}

/** Lloyd/k-means refinement of an initial palette — noticeably cleaner banding. */
export function kmeansRefine(img, palette, iterations = 4, samples = 20000) {
  if (iterations <= 0) return palette;
  const pixels = collect(img, samples);
  let pal = palette.map((p) => p.slice());
  for (let it = 0; it < iterations; it++) {
    const sums = pal.map(() => [0, 0, 0, 0]);
    for (const px of pixels) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < pal.length; i++) {
        const d = rgbDist2(px[0], px[1], px[2], pal[i][0], pal[i][1], pal[i][2]);
        if (d < bd) { bd = d; best = i; }
      }
      const s = sums[best];
      s[0] += px[0]; s[1] += px[1]; s[2] += px[2]; s[3]++;
    }
    pal = pal.map((p, i) => (sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : p));
  }
  return pal;
}

/** Build the palette a transform should use, honouring the palette picker. */
export function buildPalette(img, { colors = 12, paletteName = 'auto', refine = 3, customHex = null } = {}) {
  if (customHex && customHex.length) return paletteHexToRgb(customHex);
  if (paletteName && paletteName !== 'auto' && PALETTES[paletteName]) {
    return paletteHexToRgb(PALETTES[paletteName]);
  }
  const base = medianCut(img, Math.max(2, colors));
  const pal = kmeansRefine(img, base, refine);
  return pal.sort((a, b) => luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]));
}

/** Grayscale ramp palette of N steps. */
export function grayPalette(steps) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const v = (i / (steps - 1)) * 255;
    out.push([v, v, v]);
  }
  return out;
}

/** Random but stable palette shuffle helper for the "surprise me" button. */
export function randomPaletteName(seed) {
  const keys = Object.keys(PALETTES).filter((k) => k !== 'auto');
  const rnd = mulberry32(seed);
  return keys[Math.floor(rnd() * keys.length)];
}
