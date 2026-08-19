/* Pre-processing stage: tonal + colour adjustments applied before any transform. */
import { clamp } from '../core/util.js';
import { rgbToHsl, hslToRgb, luma } from './color.js';
import { blurImage, cloneImageData, lumaMap, boxBlurPlane, kuwahara } from './filters.js';

export const ADJUST_DEFAULTS = {
  exposure: 0,      // -100..100
  contrast: 0,      // -100..100
  saturation: 0,    // -100..100
  vibrance: 0,      // -100..100
  hue: 0,           // -180..180
  temperature: 0,   // -100..100
  gamma: 1,         // 0.2..3
  blackPoint: 0,    // 0..100
  whitePoint: 100,  // 0..100
  blur: 0,          // 0..12
  sharpen: 0,       // 0..100
  denoise: 0,       // 0..6 (edge-preserving)
  invert: false,
  grayscale: false,
};

function buildLut(a) {
  const lut = new Uint8ClampedArray(256);
  const exposure = Math.pow(2, a.exposure / 50);
  const c = a.contrast / 100;
  const contrast = c >= 0 ? 1 + c * 2 : 1 + c;
  const bp = (a.blackPoint / 100) * 255;
  const wp = (a.whitePoint / 100) * 255;
  const span = Math.max(1, wp - bp);
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v *= exposure;
    v = (v - 0.5) * contrast + 0.5;
    v = Math.pow(clamp(v, 0, 1), 1 / a.gamma);
    v = (v * 255 - bp) / span;
    lut[i] = clamp(v * 255, 0, 255);
  }
  return lut;
}

export function applyAdjustments(img, adjRaw) {
  const a = { ...ADJUST_DEFAULTS, ...adjRaw };
  let out = cloneImageData(img);

  if (a.denoise > 0) out = kuwahara(out, Math.round(a.denoise));
  if (a.blur > 0) out = blurImage(out, a.blur);

  if (a.sharpen > 0) {
    const soft = blurImage(out, 1.6, 2);
    const amt = a.sharpen / 100 * 1.8;
    const d = out.data, s = soft.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp(d[i] + (d[i] - s[i]) * amt, 0, 255);
      d[i + 1] = clamp(d[i + 1] + (d[i + 1] - s[i + 1]) * amt, 0, 255);
      d[i + 2] = clamp(d[i + 2] + (d[i + 2] - s[i + 2]) * amt, 0, 255);
    }
  }

  const lut = buildLut(a);
  const sat = 1 + a.saturation / 100;
  const vib = a.vibrance / 100;
  const hueShift = a.hue / 360;
  const temp = a.temperature / 100;
  const d = out.data;

  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];

    if (temp !== 0) {
      r = clamp(r + temp * 40, 0, 255);
      b = clamp(b - temp * 40, 0, 255);
      g = clamp(g + temp * 8, 0, 255);
    }

    if (a.grayscale) {
      const l = luma(r, g, b);
      r = g = b = l;
    } else if (sat !== 1 || vib !== 0 || hueShift !== 0) {
      let [hh, ss, ll] = rgbToHsl(r, g, b);
      if (hueShift) hh += hueShift;
      if (vib) ss += vib * (1 - ss) * 0.9;
      ss = clamp(ss * sat, 0, 1);
      [r, g, b] = hslToRgb(hh, ss, ll);
    }

    if (a.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }

    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return out;
}

/** Local-contrast boost used by several line-based transforms. */
export function localContrast(img, amount = 0.5, radius = 24) {
  if (amount <= 0) return img;
  const { width: w, height: h } = img;
  const lum = lumaMap(img);
  const base = boxBlurPlane(lum, w, h, radius, 2);
  const out = cloneImageData(img);
  const d = out.data;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const delta = (lum[p] - base[p]) * amount;
    d[i] = clamp(d[i] + delta, 0, 255);
    d[i + 1] = clamp(d[i + 1] + delta, 0, 255);
    d[i + 2] = clamp(d[i + 2] + delta, 0, 255);
  }
  return out;
}
