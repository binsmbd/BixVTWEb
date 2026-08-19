/* Helpers shared by transforms: working-size scaling, density maps, param sugar. */
import { clamp } from '../core/util.js';
import { lumaMap, boxBlurPlane } from '../image/filters.js';

/** Downscale an ImageData to a target long edge, using a canvas for smooth filtering. */
export function resizeImageData(img, targetW, targetH) {
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  src.getContext('2d').putImageData(img, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = Math.max(1, Math.round(targetW));
  dst.height = Math.max(1, Math.round(targetH));
  const ctx = dst.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, dst.width, dst.height);
  return ctx.getImageData(0, 0, dst.width, dst.height);
}

/** Fit an image inside a maximum long edge, returning the image plus its scale. */
export function fitToLongEdge(img, maxEdge) {
  const long = Math.max(img.width, img.height);
  if (long <= maxEdge) return { img, scale: 1 };
  const k = maxEdge / long;
  return { img: resizeImageData(img, img.width * k, img.height * k), scale: k };
}

/** Darkness map (0..1, 1 = ink) used to drive stipple/hatch/halftone density. */
export function darknessMap(img, { blur = 0, gamma = 1, invert = false } = {}) {
  const { width: w, height: h } = img;
  let lum = lumaMap(img);
  if (blur > 0) lum = boxBlurPlane(lum, w, h, blur, 2);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    let v = 1 - lum[i] / 255;
    if (invert) v = 1 - v;
    out[i] = Math.pow(clamp(v, 0, 1), gamma);
  }
  return out;
}

export function sampleField(field, w, h, x, y) {
  const xi = clamp(Math.round(x), 0, w - 1);
  const yi = clamp(Math.round(y), 0, h - 1);
  return field[yi * w + xi];
}

export function pixelAt(img, x, y) {
  const xi = clamp(Math.round(x), 0, img.width - 1);
  const yi = clamp(Math.round(y), 0, img.height - 1);
  const i = (yi * img.width + xi) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

/** Convenience for param definitions. */
export const P = {
  range: (k, label, min, max, step, def, extra = {}) => ({ k, label, type: 'range', min, max, step, def, ...extra }),
  select: (k, label, options, def, extra = {}) => ({ k, label, type: 'select', options, def, ...extra }),
  toggle: (k, label, def, extra = {}) => ({ k, label, type: 'toggle', def, ...extra }),
  color: (k, label, def, extra = {}) => ({ k, label, type: 'color', def, ...extra }),
  palette: (k, label, def = 'auto', extra = {}) => ({ k, label, type: 'palette', def, ...extra }),
  gradient: (k, label, def = 'ink', extra = {}) => ({ k, label, type: 'gradient', def, ...extra }),
  seed: (k = 'seed', label = 'Seed', def = 7) => ({ k, label, type: 'seed', def }),
  text: (k, label, def, extra = {}) => ({ k, label, type: 'text', def, ...extra }),
  group: (label) => ({ type: 'group', label }),
};

/** Merge declared defaults with stored values. */
export function withDefaults(tool, values = {}) {
  const out = {};
  for (const p of tool.params) {
    if (p.type === 'group') continue;
    out[p.k] = values[p.k] !== undefined ? values[p.k] : p.def;
  }
  return out;
}
