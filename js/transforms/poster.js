/* Tonal re-mapping: posterise, duotone, gradient map, threshold and colour-shift. */
import { P } from './_shared.js';
import { cloneImageData, lumaMap, boxBlurPlane, otsu, threshold } from '../image/filters.js';
import { rampColor, GRADIENTS, hexToRgb, luma } from '../image/color.js';
import { buildPalette } from '../image/quantize.js';
import { quantizeToPalette, DITHER_MODES } from '../image/dither.js';
import { clamp } from '../core/util.js';

export default {
  id: 'poster',
  label: 'Posterize & Duotone',
  group: 'Tone',
  icon: 'M4 20 L4 4 L20 4 M8 20 L8 8 L20 8 M12 20 L12 12 L20 12',
  blurb: 'Flatten tone into bands, map it through a gradient, or split into ink duotones.',
  output: 'raster',
  params: [
    P.group('Mapping'),
    P.select('mode', 'Mode', ['posterize', 'gradient-map', 'duotone', 'tritone', 'threshold', 'palette-lock'], 'posterize'),
    P.range('levels', 'Tone levels', 2, 32, 1, 6, { showIf: (v) => v.mode === 'posterize' }),
    P.gradient('ramp', 'Gradient', 'sunrise', { showIf: (v) => v.mode === 'gradient-map' }),
    P.color('shadow', 'Shadow ink', '#0b1d3a', { showIf: (v) => v.mode === 'duotone' || v.mode === 'tritone' }),
    P.color('mid', 'Mid ink', '#e63946', { showIf: (v) => v.mode === 'tritone' }),
    P.color('highlight', 'Highlight ink', '#ffe8c2', { showIf: (v) => v.mode === 'duotone' || v.mode === 'tritone' }),
    P.toggle('autoThreshold', 'Auto threshold', true, { showIf: (v) => v.mode === 'threshold' }),
    P.range('level', 'Threshold', 0, 255, 1, 128, { showIf: (v) => v.mode === 'threshold' && !v.autoThreshold }),
    P.palette('palette', 'Palette', 'risograph', { showIf: (v) => v.mode === 'palette-lock' }),
    P.range('colors', 'Colours', 2, 48, 1, 10, { showIf: (v) => v.mode === 'palette-lock' && v.palette === 'auto' }),
    P.select('dither', 'Dither', DITHER_MODES, 'none'),
    P.range('ditherStrength', 'Dither strength', 0, 1.5, 0.05, 0.8),
    P.group('Tone'),
    P.range('gamma', 'Tone curve', 0.3, 3, 0.02, 1),
    P.range('contrast', 'Contrast', -100, 100, 1, 0),
    P.range('preBlur', 'Smooth input', 0, 12, 0.5, 0),
    P.toggle('invert', 'Invert', false),
    P.toggle('keepColor', 'Keep original hue', true, { showIf: (v) => v.mode === 'posterize' }),
  ],
  presets: [
    { name: 'Screenprint 5', values: { mode: 'posterize', levels: 5, contrast: 20, keepColor: true } },
    { name: 'Grayscale bands', values: { mode: 'posterize', levels: 6, keepColor: false, contrast: 15 } },
    { name: 'Cinematic duotone', values: { mode: 'duotone', shadow: '#0a1128', highlight: '#ffd6a5' } },
    { name: 'Thermal map', values: { mode: 'gradient-map', ramp: 'ember', contrast: 15 } },
    { name: 'Riso two-colour', values: { mode: 'palette-lock', palette: 'risograph', dither: 'bayer-4' } },
    { name: 'High-contrast B/W', values: { mode: 'threshold', autoThreshold: true } },
    { name: 'Neon grade', values: { mode: 'gradient-map', ramp: 'cyberpunk', gamma: 1.2 } },
  ],

  run(ctx) {
    const p = ctx.params;
    let img = cloneImageData(ctx.img);
    const w = img.width, h = img.height;
    if (p.preBlur > 0) {
      const planes = [];
      for (let c = 0; c < 3; c++) {
        const pl = new Float32Array(w * h);
        for (let i = 0, q = 0; q < w * h; i += 4, q++) pl[q] = img.data[i + c];
        planes.push(boxBlurPlane(pl, w, h, p.preBlur, 2));
      }
      for (let q = 0, i = 0; q < w * h; q++, i += 4) {
        img.data[i] = planes[0][q]; img.data[i + 1] = planes[1][q]; img.data[i + 2] = planes[2][q];
      }
    }

    const d = img.data;
    const kc = 1 + p.contrast / 100 * 1.6;
    const tone = (v) => {
      let t = clamp(v / 255, 0, 1);
      t = clamp((t - 0.5) * kc + 0.5, 0, 1);
      t = Math.pow(t, p.gamma);
      return p.invert ? 1 - t : t;
    };

    if (p.mode === 'palette-lock') {
      const palette = buildPalette(img, { colors: p.colors, paletteName: p.palette });
      const { imageData } = quantizeToPalette(img, palette, { dither: p.dither, strength: p.ditherStrength });
      return { type: 'raster', imageData, stats: { colors: palette.length }, palette };
    }

    const stops = GRADIENTS[p.ramp] || GRADIENTS.sunrise;
    const sh = hexToRgb(p.shadow), hi = hexToRgb(p.highlight), md = hexToRgb(p.mid);
    const lvl = p.mode === 'threshold' && p.autoThreshold ? otsu(lumaMap(img)) : p.level;

    // Ordered dithering nudge, so banded modes can still hold a gradient.
    const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const l = luma(d[i], d[i + 1], d[i + 2]);
        let t = tone(l);
        if (p.dither !== 'none' && p.mode !== 'palette-lock') {
          const jitter = p.dither === 'noise'
            ? (Math.random() - 0.5)
            : ((bayer[y % 4][x % 4] + 0.5) / 16 - 0.5);
          t = clamp(t + jitter * 0.14 * p.ditherStrength, 0, 1);
        }
        let out;
        switch (p.mode) {
          case 'gradient-map': out = rampColor(stops, t); break;
          case 'duotone': out = [
            sh[0] + (hi[0] - sh[0]) * t, sh[1] + (hi[1] - sh[1]) * t, sh[2] + (hi[2] - sh[2]) * t]; break;
          case 'tritone': out = t < 0.5
            ? [sh[0] + (md[0] - sh[0]) * t * 2, sh[1] + (md[1] - sh[1]) * t * 2, sh[2] + (md[2] - sh[2]) * t * 2]
            : [md[0] + (hi[0] - md[0]) * (t - 0.5) * 2, md[1] + (hi[1] - md[1]) * (t - 0.5) * 2, md[2] + (hi[2] - md[2]) * (t - 0.5) * 2];
            break;
          case 'threshold': {
            const on = (p.invert ? 255 - l : l) < lvl;
            out = on ? [12, 14, 18] : [250, 249, 245];
            break;
          }
          default: {
            const q = Math.round(t * (p.levels - 1)) / (p.levels - 1);
            if (p.keepColor) {
              const scale = l > 1 ? (q * 255) / l : 0;
              out = [d[i] * scale, d[i + 1] * scale, d[i + 2] * scale];
            } else {
              out = [q * 255, q * 255, q * 255];
            }
          }
        }
        d[i] = clamp(out[0], 0, 255);
        d[i + 1] = clamp(out[1], 0, 255);
        d[i + 2] = clamp(out[2], 0, 255);
      }
    }
    return { type: 'raster', imageData: img, stats: { mode: p.mode } };
  },
};
