/* Edge, emboss, neon and blueprint renders — structure over colour. */
import { P } from './_shared.js';
import { lumaMap, boxBlurPlane, sobel, canny, dog, blurImage } from '../image/filters.js';
import { hexToRgb, rampColor, GRADIENTS } from '../image/color.js';
import { clamp } from '../core/util.js';

export default {
  id: 'edges',
  label: 'Edge & Glow',
  group: 'Artistic',
  icon: 'M4 20 L12 4 L20 20 Z',
  blurb: 'Sobel, Canny and DoG edge maps rendered as blueprint, neon or embossed metal.',
  output: 'raster',
  params: [
    P.group('Detection'),
    P.select('method', 'Method', ['sobel', 'canny', 'dog', 'emboss'], 'sobel'),
    P.range('blur', 'Pre-blur', 0, 10, 0.5, 1),
    P.range('low', 'Low threshold', 2, 120, 1, 18, { showIf: (v) => v.method === 'canny' }),
    P.range('high', 'High threshold', 5, 220, 1, 46, { showIf: (v) => v.method === 'canny' }),
    P.range('radius1', 'Inner radius', 0.5, 8, 0.5, 1, { showIf: (v) => v.method === 'dog' }),
    P.range('radius2', 'Outer radius', 1, 20, 0.5, 4, { showIf: (v) => v.method === 'dog' }),
    P.range('angle', 'Light angle', 0, 360, 1, 135, { unit: '°', showIf: (v) => v.method === 'emboss' }),
    P.range('gain', 'Edge gain', 0.1, 6, 0.05, 1.4),
    P.range('cutoff', 'Cutoff', 0, 240, 1, 12),
    P.range('thickness', 'Thickness', 0, 4, 1, 0, { unit: 'px' }),
    P.group('Render'),
    P.select('style', 'Style', ['ink-on-paper', 'glow', 'blueprint', 'chrome', 'gradient'], 'ink-on-paper'),
    P.color('inkColor', 'Ink', '#0d1117', { showIf: (v) => v.style === 'ink-on-paper' }),
    P.color('paperColor', 'Paper', '#fbfaf6', { showIf: (v) => v.style === 'ink-on-paper' }),
    P.color('glowColor', 'Glow', '#3ef2ff', { showIf: (v) => v.style === 'glow' }),
    P.gradient('ramp', 'Gradient', 'cyberpunk', { showIf: (v) => v.style === 'gradient' }),
    P.range('bloom', 'Bloom', 0, 14, 0.5, 4, { showIf: (v) => v.style === 'glow' }),
    P.toggle('invert', 'Invert', false),
  ],
  presets: [
    { name: 'Technical ink', values: { method: 'canny', style: 'ink-on-paper', low: 16, high: 44 } },
    { name: 'Neon wireframe', values: { method: 'sobel', style: 'glow', glowColor: '#48f7ff', bloom: 6, gain: 1.8 } },
    { name: 'Blueprint', values: { method: 'canny', style: 'blueprint', low: 14, high: 40, thickness: 1 } },
    { name: 'Embossed metal', values: { method: 'emboss', style: 'chrome', gain: 1.2 } },
    { name: 'Spectral edges', values: { method: 'dog', style: 'gradient', ramp: 'violet', gain: 2.4 } },
  ],

  run(ctx) {
    const p = ctx.params;
    const src = ctx.img;
    const w = src.width, h = src.height;
    let lum = lumaMap(src);
    if (p.blur > 0) lum = boxBlurPlane(lum, w, h, p.blur, 2);

    let field = new Float32Array(w * h);
    if (p.method === 'canny') {
      const m = canny(lum, w, h, { blur: 0.5, low: p.low, high: p.high });
      for (let i = 0; i < field.length; i++) field[i] = m[i] ? 255 : 0;
    } else if (p.method === 'dog') {
      const d = dog(lum, w, h, { r1: p.radius1, r2: p.radius2, sharpness: 6 });
      for (let i = 0; i < field.length; i++) field[i] = Math.abs(d[i]);
    } else if (p.method === 'emboss') {
      const a = (p.angle * Math.PI) / 180;
      const dx = Math.cos(a), dy = Math.sin(a);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const gx = lum[i + 1] - lum[i - 1];
          const gy = lum[i + w] - lum[i - w];
          field[i] = 128 + (gx * dx + gy * dy) * 0.9;
        }
      }
    } else {
      const { mag } = sobel(lum, w, h);
      field = mag;
    }

    if (p.thickness > 0) {
      // Simple max-dilate to thicken thin edges.
      for (let pass = 0; pass < p.thickness; pass++) {
        const cp = Float32Array.from(field);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            field[i] = Math.max(cp[i], cp[i - 1], cp[i + 1], cp[i - w], cp[i + w]);
          }
        }
      }
    }

    const out = new ImageData(w, h);
    const d = out.data;
    const ink = hexToRgb(p.inkColor), paper = hexToRgb(p.paperColor), glow = hexToRgb(p.glowColor);
    const stops = GRADIENTS[p.ramp] || GRADIENTS.cyberpunk;

    for (let q = 0, i = 0; q < w * h; q++, i += 4) {
      let e = p.method === 'emboss' ? field[q] / 255 : clamp((field[q] - p.cutoff) / 255 * p.gain, 0, 1);
      if (p.method === 'emboss') e = clamp(e * p.gain - (p.gain - 1) * 0.5, 0, 1);
      if (p.invert) e = 1 - e;
      let c;
      switch (p.style) {
        case 'glow': c = [glow[0] * e, glow[1] * e, glow[2] * e]; break;
        case 'blueprint': c = [
          11 + (200 - 11) * e, 37 + (225 - 37) * e, 69 + (255 - 69) * e]; break;
        case 'chrome': {
          const v = clamp(e * 255, 0, 255);
          c = [v * 0.92 + 12, v * 0.95 + 14, v + 18];
          break;
        }
        case 'gradient': c = rampColor(stops, e); break;
        default: c = [
          paper[0] + (ink[0] - paper[0]) * e,
          paper[1] + (ink[1] - paper[1]) * e,
          paper[2] + (ink[2] - paper[2]) * e];
      }
      d[i] = clamp(c[0], 0, 255);
      d[i + 1] = clamp(c[1], 0, 255);
      d[i + 2] = clamp(c[2], 0, 255);
      d[i + 3] = 255;
    }

    if (p.style === 'glow' && p.bloom > 0) {
      const soft = blurImage(out, p.bloom, 2);
      const s = soft.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp(d[i] + s[i] * 0.75, 0, 255);
        d[i + 1] = clamp(d[i + 1] + s[i + 1] * 0.75, 0, 255);
        d[i + 2] = clamp(d[i + 2] + s[i + 2] * 0.75, 0, 255);
      }
    }

    return { type: 'raster', imageData: out, stats: { method: p.method, style: p.style } };
  },
};
