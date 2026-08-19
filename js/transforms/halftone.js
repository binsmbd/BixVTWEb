/* Halftone screens — dots, lines, crosses and true 4-colour CMYK separations. */
import { P, darknessMap } from './_shared.js';
import { svgDoc, group, rgbCss } from '../export/svg.js';
import { clamp, deg, n, mulberry32 } from '../core/util.js';
import { hexToRgb } from '../image/color.js';
import { blurImage } from '../image/filters.js';

const SHAPES = ['dot', 'square', 'diamond', 'line', 'cross', 'ring', 'triangle', 'plus'];

/** Sample average colour of the source over a cell, in image space. */
function cellSample(img, cx, cy, r) {
  const w = img.width, h = img.height;
  const x0 = clamp(Math.floor(cx - r), 0, w - 1), x1 = clamp(Math.ceil(cx + r), 1, w);
  const y0 = clamp(Math.floor(cy - r), 0, h - 1), y1 = clamp(Math.ceil(cy + r), 1, h);
  let R = 0, G = 0, B = 0, A = 0, c = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * w + x) * 4;
      R += img.data[i]; G += img.data[i + 1]; B += img.data[i + 2]; A += img.data[i + 3]; c++;
    }
  }
  if (!c) return [255, 255, 255, 0];
  return [R / c, G / c, B / c, A / c];
}

function shapeMarkup(shape, cx, cy, size, angle, color) {
  const s = Math.max(0.02, size);
  switch (shape) {
    case 'square':
      return `<rect x="${n(cx - s)}" y="${n(cy - s)}" width="${n(s * 2)}" height="${n(s * 2)}" fill="${color}" transform="rotate(${n(angle)} ${n(cx)} ${n(cy)})"/>`;
    case 'diamond':
      return `<rect x="${n(cx - s)}" y="${n(cy - s)}" width="${n(s * 2)}" height="${n(s * 2)}" fill="${color}" transform="rotate(${n(angle + 45)} ${n(cx)} ${n(cy)})"/>`;
    case 'line':
      return `<rect x="${n(cx - s * 2.2)}" y="${n(cy - s * 0.62)}" width="${n(s * 4.4)}" height="${n(s * 1.24)}" fill="${color}" transform="rotate(${n(angle)} ${n(cx)} ${n(cy)})"/>`;
    case 'cross':
      return `<g transform="rotate(${n(angle)} ${n(cx)} ${n(cy)})" fill="${color}">`
        + `<rect x="${n(cx - s * 1.9)}" y="${n(cy - s * 0.34)}" width="${n(s * 3.8)}" height="${n(s * 0.68)}"/>`
        + `<rect x="${n(cx - s * 0.34)}" y="${n(cy - s * 1.9)}" width="${n(s * 0.68)}" height="${n(s * 3.8)}"/></g>`;
    case 'ring':
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(s)}" fill="none" stroke="${color}" stroke-width="${n(Math.max(0.15, s * 0.45))}"/>`;
    case 'triangle': {
      const p1 = `${n(cx)},${n(cy - s * 1.15)}`;
      const p2 = `${n(cx + s)},${n(cy + s * 0.75)}`;
      const p3 = `${n(cx - s)},${n(cy + s * 0.75)}`;
      return `<polygon points="${p1} ${p2} ${p3}" fill="${color}" transform="rotate(${n(angle)} ${n(cx)} ${n(cy)})"/>`;
    }
    case 'plus':
      return `<path d="M${n(cx - s)} ${n(cy)}H${n(cx + s)}M${n(cx)} ${n(cy - s)}V${n(cy + s)}" stroke="${color}" stroke-width="${n(Math.max(0.2, s * 0.55))}" stroke-linecap="round"/>`;
    default:
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(s)}" fill="${color}"/>`;
  }
}

export default {
  id: 'halftone',
  label: 'Halftone Screen',
  group: 'Print',
  icon: 'M6 6 a2 2 0 1 0 0.1 0 M13 5 a3 3 0 1 0 0.1 0 M7 14 a3.4 3.4 0 1 0 0.1 0 M16 14 a2 2 0 1 0 0.1 0',
  blurb: 'Newsprint dots, line screens and genuine CMYK separations — all vector.',
  output: 'svg',
  params: [
    P.group('Screen'),
    P.select('mode', 'Colour mode', ['mono', 'color', 'cmyk', 'duotone'], 'mono'),
    P.select('shape', 'Dot shape', SHAPES, 'dot'),
    P.range('cell', 'Screen size', 3, 60, 0.5, 9, { unit: 'px' }),
    P.range('angle', 'Screen angle', 0, 90, 1, 45, { unit: '°', showIf: (v) => v.mode !== 'cmyk' }),
    P.range('scale', 'Dot scale', 0.2, 2.2, 0.02, 1.05),
    P.range('gamma', 'Tone curve', 0.3, 3, 0.05, 1),
    P.range('minDot', 'Min dot', 0, 0.6, 0.01, 0),
    P.range('jitter', 'Jitter', 0, 1, 0.02, 0),
    P.toggle('invert', 'Invert tone', false),
    P.range('preBlur', 'Smooth input', 0, 8, 0.5, 0.5),
    P.group('Ink'),
    P.color('inkColor', 'Ink', '#14161c', { showIf: (v) => v.mode === 'mono' }),
    P.color('inkA', 'Ink A (shadow)', '#12224d', { showIf: (v) => v.mode === 'duotone' }),
    P.color('inkB', 'Ink B (highlight)', '#ff5a5f', { showIf: (v) => v.mode === 'duotone' }),
    P.toggle('multiply', 'Multiply blending', true, { showIf: (v) => v.mode === 'cmyk' || v.mode === 'color' }),
    P.toggle('background', 'Fill background', true),
    P.color('bgColor', 'Paper', '#fbf9f4'),
  ],
  presets: [
    { name: 'Newsprint', values: { mode: 'mono', shape: 'dot', cell: 7, angle: 45, gamma: 1.1 } },
    { name: 'CMYK press', values: { mode: 'cmyk', shape: 'dot', cell: 8, scale: 1.15 } },
    { name: 'Line screen', values: { mode: 'mono', shape: 'line', cell: 6, angle: 15 } },
    { name: 'Pop art', values: { mode: 'duotone', shape: 'dot', cell: 12, scale: 1.25, inkA: '#d90429', inkB: '#ffd166' } },
    { name: 'Engraved cross', values: { mode: 'mono', shape: 'cross', cell: 9, angle: 30 } },
    { name: 'Colour dots', values: { mode: 'color', shape: 'dot', cell: 10, scale: 1.2, bgColor: '#ffffff' } },
  ],

  run(ctx) {
    const p = ctx.params;
    const img = p.preBlur > 0 ? blurImage(ctx.img, p.preBlur, 2) : ctx.img;
    const W = ctx.srcWidth, H = ctx.srcHeight;
    const sx = W / img.width, sy = H / img.height;
    const rnd = mulberry32(1337);

    const dark = darknessMap(img, { gamma: 1, invert: p.invert });
    const cell = p.cell / Math.max(sx, 0.0001); // screen size expressed in source px
    const body = [];
    let dots = 0;

    const drawScreen = (angleDeg, tone, colorFn) => {
      const a = deg(angleDeg);
      const ca = Math.cos(a), sa = Math.sin(a);
      const diag = Math.hypot(img.width, img.height);
      const steps = Math.ceil(diag / cell) + 2;
      const parts = [];
      for (let j = -steps; j <= steps; j++) {
        for (let i = -steps; i <= steps; i++) {
          // Rotated lattice position, back in image space
          const lx = i * cell, ly = j * cell;
          let x = lx * ca - ly * sa + img.width / 2;
          let y = lx * sa + ly * ca + img.height / 2;
          if (x < -cell || y < -cell || x > img.width + cell || y > img.height + cell) continue;
          if (p.jitter > 0) {
            x += (rnd() - 0.5) * cell * p.jitter;
            y += (rnd() - 0.5) * cell * p.jitter;
          }
          const t = tone(x, y);
          if (t <= 0.002) continue;
          const size = (cell / 2) * p.scale * Math.pow(clamp(t, 0, 1), 1) + p.minDot * cell * 0.5;
          if (size < 0.05) continue;
          dots++;
          parts.push(shapeMarkup(p.shape, x * sx, y * sy, size * Math.max(sx, sy), angleDeg, colorFn(x, y)));
        }
      }
      return parts;
    };

    const toneAt = (x, y) => {
      const xi = clamp(Math.round(x), 0, img.width - 1);
      const yi = clamp(Math.round(y), 0, img.height - 1);
      return Math.pow(dark[yi * img.width + xi], p.gamma);
    };

    if (p.mode === 'cmyk') {
      const channels = [
        { name: 'cyan', angle: 15, color: '#00aeef' },
        { name: 'magenta', angle: 75, color: '#ec008c' },
        { name: 'yellow', angle: 0, color: '#fff200' },
        { name: 'black', angle: 45, color: '#231f20' },
      ];
      for (const chan of channels) {
        const tone = (x, y) => {
          const c = cellSample(img, x, y, 0.5);
          const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
          const kk = 1 - Math.max(r, g, b);
          const denom = 1 - kk || 1e-6;
          let v;
          if (chan.name === 'cyan') v = (1 - r - kk) / denom;
          else if (chan.name === 'magenta') v = (1 - g - kk) / denom;
          else if (chan.name === 'yellow') v = (1 - b - kk) / denom;
          else v = kk;
          return Math.pow(clamp(p.invert ? 1 - v : v, 0, 1), p.gamma);
        };
        const parts = drawScreen(chan.angle, tone, () => chan.color);
        body.push(group({
          'data-bix-layer': `cmyk-${chan.name}`,
          style: p.multiply ? 'mix-blend-mode:multiply' : null,
        }, parts));
      }
    } else if (p.mode === 'color') {
      const parts = drawScreen(p.angle, toneAt, (x, y) => {
        const c = cellSample(img, x, y, cell / 2);
        return rgbCss(c);
      });
      body.push(group({ 'data-bix-layer': 'halftone-color', style: p.multiply ? 'mix-blend-mode:multiply' : null }, parts));
    } else if (p.mode === 'duotone') {
      const A = hexToRgb(p.inkA), B = hexToRgb(p.inkB);
      const parts = drawScreen(p.angle, toneAt, (x, y) => {
        const t = clamp(toneAt(x, y), 0, 1);
        return rgbCss([B[0] + (A[0] - B[0]) * t, B[1] + (A[1] - B[1]) * t, B[2] + (A[2] - B[2]) * t]);
      });
      body.push(group({ 'data-bix-layer': 'halftone-duotone' }, parts));
    } else {
      const parts = drawScreen(p.angle, toneAt, () => p.inkColor);
      body.push(group({ 'data-bix-layer': 'halftone' }, parts));
    }

    const svg = svgDoc({
      width: W, height: H,
      bg: p.background ? p.bgColor : null,
      body,
      meta: { transform: 'Halftone' },
    });
    return { type: 'svg', svg, stats: { dots, cells: Math.round((img.width * img.height) / (cell * cell)) } };
  },
};
