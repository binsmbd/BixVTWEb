/* Colour space conversions, palette maths and named palettes. */
import { clamp, clamp01 } from '../core/util.js';

export function hexToRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r, g, b) {
  const c = (x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Rec.709 luma, 0..255 */
export const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/* sRGB <-> CIE Lab (D65) — used for perceptual palette matching. */
const f1 = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const f2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(r, g, b) {
  const R = f1(r), G = f1(g), B = f1(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = f2(x), fy = f2(y), fz = f2(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labDist2(a, b) {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

/** Squared distance in a cheap perceptually-weighted RGB space. */
export function rgbDist2(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) * 0.5;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

export function nearestIndex(palette, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = rgbDist2(r, g, b, p[0], p[1], p[2]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Sample a gradient defined as an array of hex stops. */
export function rampColor(stops, t) {
  t = clamp01(t);
  const rgb = stops.map(hexToRgb);
  if (rgb.length === 1) return rgb[0];
  const x = t * (rgb.length - 1);
  const i = Math.min(Math.floor(x), rgb.length - 2);
  return mixRgb(rgb[i], rgb[i + 1], x - i);
}

/** Curated palettes — the "swatch library" of the app. */
export const PALETTES = {
  'auto': null,
  'bix-signature': ['#0d0f14', '#1b2430', '#3d5a80', '#98c1d9', '#e0fbfc', '#ee6c4d', '#f4a261'],
  'grayscale-8': ['#000000', '#242424', '#484848', '#6d6d6d', '#919191', '#b6b6b6', '#dadada', '#ffffff'],
  'mono-ink': ['#0b0b0b', '#ffffff'],
  'gameboy': ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  'gameboy-pocket': ['#2b2b26', '#5a5b52', '#9a9b86', '#c4cfa1'],
  'nes-13': ['#000000', '#fcfcfc', '#f8f8f8', '#bcbcbc', '#7c7c7c', '#a4e4fc', '#3cbcfc', '#0078f8',
    '#b8b8f8', '#f8b8f8', '#f87858', '#fca044', '#b8f818'],
  'pico-8': ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  'cga': ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  'commodore-64': ['#000000', '#ffffff', '#880000', '#aaffee', '#cc44cc', '#00cc55', '#0000aa',
    '#eeee77', '#dd8855', '#664400', '#ff7777', '#333333', '#777777', '#aaff66', '#0088ff', '#bbbbbb'],
  'zx-spectrum': ['#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7',
    '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ffff', '#ffff00', '#ffffff'],
  'risograph': ['#f7f5ef', '#ff665e', '#0078bf', '#ffe800', '#00a95c', '#3d3d3d'],
  'blueprint': ['#0b2545', '#13315c', '#134074', '#8da9c4', '#eef4ed'],
  'sepia': ['#2b1d0e', '#5c3d21', '#8c6239', '#c39a6b', '#e8d5b7', '#f7efe2'],
  'neon-night': ['#050014', '#1b0044', '#5a189a', '#9d4edd', '#ff006e', '#fb5607', '#ffbe0b', '#3a86ff'],
  'pastel-dream': ['#ffd6e0', '#ffefcf', '#d0f4de', '#a9def9', '#e4c1f9', '#fcf6bd'],
  'earth-tone': ['#2f3e46', '#354f52', '#52796f', '#84a98c', '#cad2c5', '#b08968', '#7f5539'],
  'cmyk-print': ['#ffffff', '#00aeef', '#ec008c', '#fff200', '#000000'],
  'sunset-8': ['#03071e', '#370617', '#6a040f', '#9d0208', '#d00000', '#dc2f02', '#f48c06', '#ffba08'],
  'nord': ['#2e3440', '#3b4252', '#434c5e', '#4c566a', '#d8dee9', '#88c0d0', '#81a1c1', '#a3be8c',
    '#ebcb8b', '#bf616a'],
};

export const GRADIENTS = {
  'ink': ['#000000', '#ffffff'],
  'sunrise': ['#0b0033', '#7c1f4e', '#f0544f', '#ffd166', '#fff8e7'],
  'ocean': ['#001219', '#005f73', '#0a9396', '#94d2bd', '#e9d8a6'],
  'ember': ['#03071e', '#9d0208', '#f48c06', '#ffe6a7'],
  'violet': ['#10002b', '#5a189a', '#c77dff', '#f8f0fb'],
  'mint': ['#0b3d2e', '#1b7f5f', '#7ee0b8', '#f2fff9'],
  'copper': ['#1a0f0a', '#7a3b18', '#c9762b', '#f2c894'],
  'cyberpunk': ['#0d001a', '#26004d', '#ff007a', '#00e5ff', '#f7fff7'],
  'earth': ['#1b2a1f', '#3c5a40', '#7a8b5a', '#c2b280', '#e9dcc3', '#fffdf7'],
  'ice': ['#04141f', '#0b3c5d', '#3282b8', '#bbe1fa', '#ffffff'],
  'candy': ['#2b0a3d', '#7b2cbf', '#ff70a6', '#ffd670', '#fdfffc'],
  'noir': ['#000000', '#2b2b2b', '#7a7a7a', '#d9d9d9', '#ffffff'],
};

export function paletteHexToRgb(hexList) {
  return hexList.map(hexToRgb);
}
