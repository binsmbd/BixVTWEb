/* Pixel-art engine: grid sampling → palette → dither → shaped pixels.
   Outputs both a crisp raster and an editable run-length SVG. */
import { P, resizeImageData } from './_shared.js';
import { buildPalette } from '../image/quantize.js';
import { quantizeToPalette, DITHER_MODES } from '../image/dither.js';
import { rgbToHex, luma } from '../image/color.js';
import { svgDoc, rectEl, group } from '../export/svg.js';
import { clamp } from '../core/util.js';

const SHAPES = ['square', 'circle', 'diamond', 'rounded', 'cross', 'hex'];

function downsample(img, gw, gh, mode) {
  if (mode === 'average') return resizeImageData(img, gw, gh);
  const out = new ImageData(gw, gh);
  const sx = img.width / gw, sy = img.height / gh;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r, g, b, a = 255;
      if (mode === 'nearest') {
        const cx = clamp(Math.floor((x + 0.5) * sx), 0, img.width - 1);
        const cy = clamp(Math.floor((y + 0.5) * sy), 0, img.height - 1);
        const i = (cy * img.width + cx) * 4;
        r = img.data[i]; g = img.data[i + 1]; b = img.data[i + 2]; a = img.data[i + 3];
      } else {
        const rs = [], gs = [], bs = [], as = [];
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * img.width + xx) * 4;
            rs.push(img.data[i]); gs.push(img.data[i + 1]); bs.push(img.data[i + 2]); as.push(img.data[i + 3]);
          }
        }
        const mid = (arr) => { arr.sort((p, q) => p - q); return arr[arr.length >> 1]; };
        if (mode === 'median') { r = mid(rs); g = mid(gs); b = mid(bs); a = mid(as); }
        else { // "dominant" — the most contrasty pixel wins, keeps sparkle in detail
          let bi = 0, bd = -1;
          for (let i2 = 0; i2 < rs.length; i2++) {
            const l = Math.abs(luma(rs[i2], gs[i2], bs[i2]) - 128);
            if (l > bd) { bd = l; bi = i2; }
          }
          r = rs[bi]; g = gs[bi]; b = bs[bi]; a = as[bi];
        }
      }
      const o = (y * gw + x) * 4;
      out.data[o] = r; out.data[o + 1] = g; out.data[o + 2] = b; out.data[o + 3] = a;
    }
  }
  return out;
}

function shapePath(ctx2d, shape, x, y, s, inset) {
  const r = s / 2 - inset;
  const cx = x + s / 2, cy = y + s / 2;
  ctx2d.beginPath();
  switch (shape) {
    case 'circle': ctx2d.arc(cx, cy, Math.max(0.1, r), 0, Math.PI * 2); break;
    case 'diamond':
      ctx2d.moveTo(cx, cy - r); ctx2d.lineTo(cx + r, cy); ctx2d.lineTo(cx, cy + r); ctx2d.lineTo(cx - r, cy); ctx2d.closePath();
      break;
    case 'rounded': {
      const rr = Math.max(0.5, r * 0.45);
      ctx2d.roundRect(cx - r, cy - r, r * 2, r * 2, rr);
      break;
    }
    case 'cross': {
      const t = r * 0.42;
      ctx2d.rect(cx - t, cy - r, t * 2, r * 2);
      ctx2d.rect(cx - r, cy - t, r * 2, t * 2);
      break;
    }
    case 'hex': {
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        i ? ctx2d.lineTo(px, py) : ctx2d.moveTo(px, py);
      }
      ctx2d.closePath();
      break;
    }
    default: ctx2d.rect(cx - r, cy - r, r * 2, r * 2);
  }
}

export default {
  id: 'pixel-art',
  label: 'Pixel Art',
  group: 'Pixel',
  icon: 'M4 4h5v5H4Z M11 4h5v5h-5Z M4 11h5v5H4Z M11 11h5v5h-5Z',
  blurb: 'Grid quantisation with real palettes, dithering and shaped pixels.',
  output: 'raster',
  params: [
    P.group('Grid'),
    P.range('pixelSize', 'Pixel size', 2, 64, 1, 10, { unit: 'px' }),
    P.select('sampling', 'Sampling', ['average', 'nearest', 'median', 'dominant'], 'average'),
    P.toggle('squarePixels', 'Force square pixels', true),
    P.group('Colour'),
    P.palette('palette', 'Palette', 'auto'),
    P.range('colors', 'Colours', 2, 64, 1, 16, { showIf: (v) => v.palette === 'auto' }),
    P.select('dither', 'Dither', DITHER_MODES, 'floyd-steinberg'),
    P.range('ditherStrength', 'Dither strength', 0, 1.5, 0.05, 0.85),
    P.range('saturate', 'Saturation boost', -100, 100, 1, 0),
    P.group('Style'),
    P.select('shape', 'Pixel shape', SHAPES, 'square'),
    P.range('gap', 'Pixel gap', 0, 0.45, 0.01, 0),
    P.toggle('grid', 'Grid lines', false),
    P.color('gridColor', 'Grid colour', '#0c0d11'),
    P.range('gridWidth', 'Grid width', 0.2, 4, 0.1, 0.6),
    P.toggle('outline', 'Outline pixels', false),
    P.color('bgColor', 'Background', '#0c0d11'),
    P.toggle('transparentBg', 'Transparent background', false),
  ],
  presets: [
    { name: 'Game Boy', values: { palette: 'gameboy', pixelSize: 8, dither: 'bayer-4', ditherStrength: 1 } },
    { name: 'PICO-8 sprite', values: { palette: 'pico-8', pixelSize: 6, dither: 'floyd-steinberg' } },
    { name: 'Mosaic tiles', values: { shape: 'rounded', gap: 0.12, pixelSize: 16, dither: 'none', colors: 24 } },
    { name: 'LED panel', values: { shape: 'circle', gap: 0.18, pixelSize: 12, transparentBg: false, bgColor: '#08090c', colors: 12 } },
    { name: 'C64 demo', values: { palette: 'commodore-64', pixelSize: 7, dither: 'atkinson' } },
    { name: 'Cross-stitch', values: { shape: 'cross', pixelSize: 14, gap: 0.08, colors: 20, dither: 'none' } },
  ],

  run(ctx) {
    const p = ctx.params;
    const W = ctx.srcWidth, H = ctx.srcHeight;
    const gw = Math.max(1, Math.round(W / p.pixelSize));
    // Non-square mode stretches cells horizontally for a CRT/retro-console feel.
    const gh = Math.max(1, Math.round(H / (p.squarePixels ? p.pixelSize : p.pixelSize * 1.6)));
    const small = downsample(ctx.img, gw, gh, p.sampling);

    if (p.saturate !== 0) {
      const k = 1 + p.saturate / 100;
      const d = small.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = luma(d[i], d[i + 1], d[i + 2]);
        d[i] = clamp(l + (d[i] - l) * k, 0, 255);
        d[i + 1] = clamp(l + (d[i + 1] - l) * k, 0, 255);
        d[i + 2] = clamp(l + (d[i + 2] - l) * k, 0, 255);
      }
    }

    const palette = buildPalette(small, { colors: p.colors, paletteName: p.palette });
    const { indexMap } = quantizeToPalette(small, palette, {
      dither: p.dither, strength: p.ditherStrength,
    });

    const cw = W / gw, ch = H / gh;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    if (!p.transparentBg) { c.fillStyle = p.bgColor; c.fillRect(0, 0, W, H); }

    const inset = (Math.min(cw, ch) * p.gap) / 2;
    const svgBody = [];
    const alphaCut = 8;

    for (let y = 0; y < gh; y++) {
      let runStart = 0, runIdx = -2;
      for (let x = 0; x <= gw; x++) {
        const idx = x < gw ? indexMap[y * gw + x] : -3;
        const a = x < gw ? small.data[(y * gw + x) * 4 + 3] : 0;
        const cur = a < alphaCut ? -1 : idx;
        if (cur !== runIdx) {
          if (runIdx >= 0) {
            const col = palette[runIdx];
            const hex = rgbToHex(col[0], col[1], col[2]);
            const rw = (x - runStart) * cw;
            // Raster: shaped cells (each cell drawn separately when shaped)
            c.fillStyle = hex;
            if (p.shape === 'square' && p.gap === 0) {
              c.fillRect(runStart * cw, y * ch, rw + 0.5, ch + 0.5);
              svgBody.push(rectEl(runStart * cw, y * ch, rw, ch, { fill: hex }));
            } else {
              for (let k = runStart; k < x; k++) {
                shapePath(c, p.shape, k * cw, y * ch, Math.min(cw, ch), inset);
                c.fill();
                if (p.outline) { c.strokeStyle = p.gridColor; c.lineWidth = p.gridWidth; c.stroke(); }
              }
              svgBody.push(rectEl(runStart * cw + inset, y * ch + inset, rw - inset * 2, ch - inset * 2, {
                fill: hex,
                rx: p.shape === 'circle' || p.shape === 'rounded' ? Math.min(cw, ch) * (p.shape === 'circle' ? 0.5 : 0.22) : null,
              }));
            }
          }
          runStart = x; runIdx = cur;
        }
      }
    }

    if (p.grid) {
      c.strokeStyle = p.gridColor;
      c.lineWidth = p.gridWidth;
      c.beginPath();
      for (let x = 0; x <= gw; x++) { c.moveTo(x * cw, 0); c.lineTo(x * cw, H); }
      for (let y = 0; y <= gh; y++) { c.moveTo(0, y * ch); c.lineTo(W, y * ch); }
      c.stroke();
    }

    const svg = svgDoc({
      width: W, height: H,
      bg: p.transparentBg ? null : p.bgColor,
      body: [group({ 'shape-rendering': 'crispEdges', 'data-bix-layer': 'pixels' }, svgBody)],
      meta: { transform: 'Pixel Art' },
    });

    return {
      type: 'raster',
      imageData: c.getImageData(0, 0, W, H),
      svg,
      pixelated: true,
      stats: { grid: `${gw}×${gh}`, colors: palette.length, cells: gw * gh },
      palette,
    };
  },
};
