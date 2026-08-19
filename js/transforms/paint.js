/* Painterly rasterisers: oil, watercolour, pencil, charcoal and comic ink. */
import { P } from './_shared.js';
import { cloneImageData, kuwahara, blurImage, lumaMap, boxBlurPlane, canny } from '../image/filters.js';
import { luma } from '../image/color.js';
import { buildPalette } from '../image/quantize.js';
import { quantizeToPalette } from '../image/dither.js';
import { clamp, mulberry32 } from '../core/util.js';

function edgeMask(img, strength, low, high) {
  const { width: w, height: h } = img;
  const lum = lumaMap(img);
  return canny(lum, w, h, { blur: 1, low, high });
}

export default {
  id: 'paint',
  label: 'Painterly',
  group: 'Artistic',
  icon: 'M5 19 C5 12 10 5 16 5 C20 5 21 9 18 11 C15 13 12 12 12 15 C12 18 9 20 5 19 Z',
  blurb: 'Oil, watercolour, pencil, charcoal and comic-ink renders with edge-aware brushes.',
  output: 'raster',
  params: [
    P.group('Medium'),
    P.select('mode', 'Medium', ['oil', 'watercolor', 'pencil', 'charcoal', 'comic'], 'oil'),
    P.range('brush', 'Brush size', 1, 14, 1, 4),
    P.range('detail', 'Detail retention', 0, 1, 0.02, 0.45),
    P.range('passes', 'Passes', 1, 3, 1, 1),
    P.group('Ink & paper'),
    P.range('edgeStrength', 'Edge ink', 0, 1, 0.02, 0.55),
    P.range('edgeLow', 'Edge sensitivity', 4, 90, 1, 22),
    P.range('colorLevels', 'Colour levels', 0, 32, 1, 0, { hint: '0 keeps full colour; low values flatten into poster inks.' }),
    P.range('saturation', 'Saturation', -100, 100, 1, 12),
    P.range('grain', 'Paper grain', 0, 100, 1, 12),
    P.range('bleed', 'Bleed / wash', 0, 12, 0.5, 3, { showIf: (v) => v.mode === 'watercolor' }),
    P.toggle('paperWhite', 'Lift paper white', true, { showIf: (v) => v.mode === 'pencil' || v.mode === 'charcoal' }),
    P.seed('seed', 'Grain seed', 21),
  ],
  presets: [
    { name: 'Oil portrait', values: { mode: 'oil', brush: 5, edgeStrength: 0.35, saturation: 18 } },
    { name: 'Loose watercolour', values: { mode: 'watercolor', brush: 6, bleed: 6, edgeStrength: 0.5, grain: 26 } },
    { name: 'Graphite sketch', values: { mode: 'pencil', brush: 2, edgeStrength: 0.85, grain: 30 } },
    { name: 'Charcoal study', values: { mode: 'charcoal', brush: 3, edgeStrength: 0.7, grain: 45 } },
    { name: 'Comic ink', values: { mode: 'comic', colorLevels: 6, edgeStrength: 0.9, edgeLow: 16 } },
  ],

  run(ctx) {
    const p = ctx.params;
    let img = cloneImageData(ctx.img);
    const w = img.width, h = img.height;
    const rnd = mulberry32(p.seed);

    if (p.mode === 'oil' || p.mode === 'watercolor' || p.mode === 'comic') {
      for (let i = 0; i < p.passes; i++) img = kuwahara(img, p.brush);
      if (p.detail < 1) {
        // Blend a little of the original back for retained detail.
        const orig = ctx.img.data, d = img.data;
        const t = p.detail;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = d[i] * (1 - t) + orig[i] * t;
          d[i + 1] = d[i + 1] * (1 - t) + orig[i + 1] * t;
          d[i + 2] = d[i + 2] * (1 - t) + orig[i + 2] * t;
        }
      }
    }

    if (p.mode === 'watercolor') {
      const soft = blurImage(img, p.bleed, 2);
      const d = img.data, s = soft.data;
      for (let i = 0; i < d.length; i += 4) {
        // Screen the wash back over the paint for translucency.
        d[i] = 255 - ((255 - d[i]) * (255 - s[i] * 0.35)) / 255;
        d[i + 1] = 255 - ((255 - d[i + 1]) * (255 - s[i + 1] * 0.35)) / 255;
        d[i + 2] = 255 - ((255 - d[i + 2]) * (255 - s[i + 2] * 0.35)) / 255;
      }
    }

    if (p.mode === 'pencil' || p.mode === 'charcoal') {
      const lum = lumaMap(img);
      const inv = new Float32Array(w * h);
      for (let i = 0; i < lum.length; i++) inv[i] = 255 - lum[i];
      const blurred = boxBlurPlane(inv, w, h, Math.max(1, p.brush * 2), 2);
      const d = img.data;
      for (let q = 0, i = 0; q < w * h; q++, i += 4) {
        // Colour-dodge blend — the classic pencil recipe.
        const base = lum[q], top = blurred[q];
        let v = top >= 255 ? 255 : Math.min(255, (base * 255) / (255 - top));
        if (p.mode === 'charcoal') v = clamp((v - 128) * 1.5 + 110, 0, 255);
        if (p.paperWhite) v = clamp((v - 40) * (255 / 215), 0, 255);
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }

    if (p.colorLevels > 0 && p.mode !== 'pencil' && p.mode !== 'charcoal') {
      const palette = buildPalette(img, { colors: p.colorLevels, paletteName: 'auto', refine: 3 });
      const { imageData } = quantizeToPalette(img, palette, { dither: 'none' });
      img = imageData;
    }

    if (p.edgeStrength > 0) {
      const mask = edgeMask(ctx.img, p.edgeStrength, p.edgeLow, p.edgeLow * 2.4);
      const d = img.data;
      const inkT = p.edgeStrength;
      for (let q = 0, i = 0; q < w * h; q++, i += 4) {
        if (!mask[q]) continue;
        d[i] = d[i] * (1 - inkT);
        d[i + 1] = d[i + 1] * (1 - inkT);
        d[i + 2] = d[i + 2] * (1 - inkT);
      }
    }

    if (p.saturation !== 0 && p.mode !== 'pencil' && p.mode !== 'charcoal') {
      const k = 1 + p.saturation / 100;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = luma(d[i], d[i + 1], d[i + 2]);
        d[i] = clamp(l + (d[i] - l) * k, 0, 255);
        d[i + 1] = clamp(l + (d[i + 1] - l) * k, 0, 255);
        d[i + 2] = clamp(l + (d[i + 2] - l) * k, 0, 255);
      }
    }

    if (p.grain > 0) {
      const amt = p.grain / 100 * 46;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = (rnd() - 0.5) * amt;
        d[i] = clamp(d[i] + g, 0, 255);
        d[i + 1] = clamp(d[i + 1] + g, 0, 255);
        d[i + 2] = clamp(d[i + 2] + g, 0, 255);
      }
    }

    return { type: 'raster', imageData: img, stats: { medium: p.mode } };
  },
};
