/* Glitch lab: channel shift, slice displacement, pixel sorting, scanlines, VHS. */
import { P } from './_shared.js';
import { cloneImageData, blurImage } from '../image/filters.js';
import { luma } from '../image/color.js';
import { clamp, mulberry32 } from '../core/util.js';

export default {
  id: 'glitch',
  label: 'Glitch Lab',
  group: 'Artistic',
  icon: 'M4 8h9l-3 4h10 M4 16h7',
  blurb: 'Channel splits, pixel sorting, slice displacement and CRT artefacts.',
  output: 'raster',
  params: [
    P.group('Channels'),
    P.range('rgbShift', 'RGB split', 0, 60, 1, 8, { unit: 'px' }),
    P.range('shiftAngle', 'Split angle', 0, 360, 1, 0, { unit: '°' }),
    P.range('chromaBleed', 'Chroma bleed', 0, 12, 0.5, 0),
    P.group('Displacement'),
    P.range('slices', 'Slice count', 0, 120, 1, 14),
    P.range('sliceShift', 'Slice offset', 0, 200, 1, 30, { unit: 'px' }),
    P.select('sliceAxis', 'Slice axis', ['horizontal', 'vertical'], 'horizontal'),
    P.range('waveAmp', 'Wave distortion', 0, 60, 1, 0, { unit: 'px' }),
    P.range('waveFreq', 'Wave frequency', 0.5, 20, 0.1, 4),
    P.group('Pixel sort'),
    P.toggle('pixelSort', 'Pixel sorting', false),
    P.select('sortAxis', 'Sort axis', ['horizontal', 'vertical'], 'horizontal', { showIf: (v) => v.pixelSort }),
    P.range('sortLow', 'Sort range low', 0, 255, 1, 60, { showIf: (v) => v.pixelSort }),
    P.range('sortHigh', 'Sort range high', 0, 255, 1, 200, { showIf: (v) => v.pixelSort }),
    P.toggle('sortReverse', 'Reverse sort', false, { showIf: (v) => v.pixelSort }),
    P.group('Screen'),
    P.range('scanlines', 'Scanlines', 0, 100, 1, 0),
    P.range('scanlineSize', 'Scanline size', 1, 12, 1, 3),
    P.range('noise', 'Static noise', 0, 100, 1, 6),
    P.range('bloom', 'Bloom', 0, 20, 0.5, 0),
    P.range('vignette', 'Vignette', 0, 100, 1, 0),
    P.seed('seed', 'Seed', 42),
  ],
  presets: [
    { name: 'CRT ghost', values: { rgbShift: 6, scanlines: 45, scanlineSize: 3, noise: 12, bloom: 4, vignette: 30, slices: 0 } },
    { name: 'Datamosh', values: { slices: 40, sliceShift: 90, rgbShift: 16, noise: 8 } },
    { name: 'Pixel sort dream', values: { pixelSort: true, sortLow: 40, sortHigh: 210, rgbShift: 0, slices: 0 } },
    { name: 'VHS tracking', values: { slices: 26, sliceShift: 40, waveAmp: 8, chromaBleed: 5, scanlines: 30, noise: 18 } },
    { name: 'Chromatic drift', values: { rgbShift: 26, shiftAngle: 30, slices: 0, bloom: 6 } },
  ],

  run(ctx) {
    const p = ctx.params;
    const src = ctx.img;
    const w = src.width, h = src.height;
    const rnd = mulberry32(p.seed);
    let img = cloneImageData(src);
    const d = img.data;
    const s = src.data;

    // --- wave + slice displacement (sampled from the source) -------------
    const sliceOffsets = new Int32Array(p.sliceAxis === 'horizontal' ? h : w);
    if (p.slices > 0 && p.sliceShift > 0) {
      const bandSize = Math.max(1, Math.floor(sliceOffsets.length / p.slices));
      for (let i = 0; i < sliceOffsets.length; i += bandSize) {
        const off = Math.round((rnd() * 2 - 1) * p.sliceShift * (rnd() < 0.35 ? 1 : 0.25));
        for (let j = i; j < Math.min(sliceOffsets.length, i + bandSize); j++) sliceOffsets[j] = off;
      }
    }

    const sample = (x, y, c) => {
      const xi = clamp(Math.round(x), 0, w - 1);
      const yi = clamp(Math.round(y), 0, h - 1);
      return s[(yi * w + xi) * 4 + c];
    };

    const ang = (p.shiftAngle * Math.PI) / 180;
    const shx = Math.cos(ang) * p.rgbShift, shy = Math.sin(ang) * p.rgbShift;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let sx = x, sy = y;
        if (p.waveAmp > 0) {
          sx += Math.sin((y / h) * p.waveFreq * Math.PI * 2) * p.waveAmp;
          sy += Math.cos((x / w) * p.waveFreq * Math.PI * 2) * p.waveAmp * 0.35;
        }
        if (p.sliceAxis === 'horizontal') sx += sliceOffsets[y] || 0;
        else sy += sliceOffsets[x] || 0;

        d[i] = sample(sx + shx, sy + shy, 0);
        d[i + 1] = sample(sx, sy, 1);
        d[i + 2] = sample(sx - shx, sy - shy, 2);
        d[i + 3] = sample(sx, sy, 3);
      }
    }

    if (p.chromaBleed > 0) {
      const soft = blurImage(img, p.chromaBleed, 2);
      const b = soft.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp(d[i] * 0.55 + b[i] * 0.45, 0, 255);
        d[i + 2] = clamp(d[i + 2] * 0.55 + b[i + 2] * 0.45, 0, 255);
      }
    }

    // --- pixel sorting ----------------------------------------------------
    if (p.pixelSort) {
      const lo = Math.min(p.sortLow, p.sortHigh), hi = Math.max(p.sortLow, p.sortHigh);
      const horizontal = p.sortAxis === 'horizontal';
      const outer = horizontal ? h : w;
      const inner = horizontal ? w : h;
      const idxOf = (a, b) => (horizontal ? (a * w + b) : (b * w + a)) * 4;
      for (let a = 0; a < outer; a++) {
        let run = [];
        const flush = () => {
          if (run.length > 1) {
            const px = run.map((b) => {
              const i = idxOf(a, b);
              return [d[i], d[i + 1], d[i + 2], d[i + 3]];
            });
            px.sort((u, v) => luma(u[0], u[1], u[2]) - luma(v[0], v[1], v[2]));
            if (p.sortReverse) px.reverse();
            run.forEach((b, k) => {
              const i = idxOf(a, b);
              d[i] = px[k][0]; d[i + 1] = px[k][1]; d[i + 2] = px[k][2]; d[i + 3] = px[k][3];
            });
          }
          run = [];
        };
        for (let b = 0; b < inner; b++) {
          const i = idxOf(a, b);
          const l = luma(d[i], d[i + 1], d[i + 2]);
          if (l >= lo && l <= hi) run.push(b); else flush();
        }
        flush();
      }
    }

    // --- screen effects ---------------------------------------------------
    if (p.scanlines > 0) {
      const amt = p.scanlines / 100;
      for (let y = 0; y < h; y++) {
        const dark = Math.floor(y / p.scanlineSize) % 2 === 0 ? 1 - amt * 0.55 : 1;
        if (dark === 1) continue;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          d[i] *= dark; d[i + 1] *= dark; d[i + 2] *= dark;
        }
      }
    }

    if (p.noise > 0) {
      const amt = (p.noise / 100) * 90;
      for (let i = 0; i < d.length; i += 4) {
        const g = (rnd() - 0.5) * amt;
        d[i] = clamp(d[i] + g, 0, 255);
        d[i + 1] = clamp(d[i + 1] + g, 0, 255);
        d[i + 2] = clamp(d[i + 2] + g, 0, 255);
      }
    }

    if (p.vignette > 0) {
      const amt = p.vignette / 100;
      const cx = w / 2, cy = h / 2, maxD = Math.hypot(cx, cy);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const t = 1 - amt * Math.pow(Math.hypot(x - cx, y - cy) / maxD, 2.2);
          d[i] *= t; d[i + 1] *= t; d[i + 2] *= t;
        }
      }
    }

    if (p.bloom > 0) {
      const soft = blurImage(img, p.bloom, 2);
      const b = soft.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp(d[i] + b[i] * 0.35, 0, 255);
        d[i + 1] = clamp(d[i + 1] + b[i + 1] * 0.35, 0, 255);
        d[i + 2] = clamp(d[i + 2] + b[i + 2] * 0.35, 0, 255);
      }
    }

    return { type: 'raster', imageData: img, stats: { effects: [p.rgbShift && 'rgb', p.pixelSort && 'sort', p.slices && 'slice'].filter(Boolean).join(' · ') || 'clean' } };
  },
};
