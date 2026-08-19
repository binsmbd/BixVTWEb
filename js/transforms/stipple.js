/* Stippling / pointillism — weighted dot fields with optional Lloyd relaxation. */
import { P, darknessMap, fitToLongEdge } from './_shared.js';
import { importanceSample, relax } from '../geom/sampling.js';
import { blurImage, averageRegion } from '../image/filters.js';
import { svgDoc, group, rgbCss } from '../export/svg.js';
import { clamp, n } from '../core/util.js';

export default {
  id: 'stipple',
  label: 'Stipple / Dots',
  group: 'Geometric',
  icon: 'M6 6 a1 1 0 1 0 .1 0 M12 8 a1.5 1.5 0 1 0 .1 0 M8 14 a1.2 1.2 0 1 0 .1 0 M16 13 a2 2 0 1 0 .1 0',
  blurb: 'Ink-style dot fields that follow tone — plotter friendly and infinitely scalable.',
  output: 'svg',
  params: [
    P.group('Points'),
    P.range('count', 'Dot count', 200, 60000, 100, 16000),
    P.range('bias', 'Tone bias', 0.4, 3, 0.05, 1.7, { hint: 'Higher pushes dots harder into the shadows.' }),
    P.range('relaxIterations', 'Relaxation', 0, 4, 1, 1),
    P.seed('seed', 'Seed', 3),
    P.toggle('invert', 'Invert tone', false),
    P.range('preBlur', 'Smooth input', 0, 10, 0.5, 1),
    P.group('Dots'),
    P.select('shape', 'Dot shape', ['circle', 'square', 'dash', 'triangle', 'plus'], 'circle'),
    P.range('minSize', 'Min size', 0.1, 6, 0.05, 0.35, { unit: 'px' }),
    P.range('maxSize', 'Max size', 0.3, 16, 0.05, 2.6, { unit: 'px' }),
    P.range('sizeByTone', 'Size follows tone', 0, 1, 0.02, 0.85),
    P.range('rotation', 'Dash angle', 0, 180, 1, 45, { unit: '°', showIf: (v) => v.shape === 'dash' }),
    P.group('Colour'),
    P.select('colorMode', 'Colour', ['ink', 'image'], 'ink'),
    P.color('inkColor', 'Ink', '#14161c', { showIf: (v) => v.colorMode === 'ink' }),
    P.range('opacity', 'Dot opacity', 0.1, 1, 0.02, 1),
    P.toggle('background', 'Fill background', true),
    P.color('bgColor', 'Paper', '#faf7f0'),
  ],
  presets: [
    { name: 'Ink portrait', values: { count: 12000, bias: 1.5, maxSize: 1.8, relaxIterations: 2 } },
    { name: 'Pointillism', values: { count: 9000, colorMode: 'image', maxSize: 4.5, minSize: 1.4, bias: 0.9, bgColor: '#101318' } },
    { name: 'Sparse plotter', values: { count: 2500, maxSize: 1.2, minSize: 0.4, relaxIterations: 3 } },
    { name: 'Rain dashes', values: { shape: 'dash', count: 7000, rotation: 60, maxSize: 3 } },
  ],

  run(ctx) {
    const p = ctx.params;
    const { img: work } = fitToLongEdge(ctx.img, 1000);
    const src = p.preBlur > 0 ? blurImage(work, p.preBlur, 2) : work;
    const w = src.width, h = src.height;
    const dark = darknessMap(src, { gamma: 1, invert: p.invert });

    // Alpha-aware: fully transparent areas get no ink.
    for (let i = 0, pi = 3; i < dark.length; i++, pi += 4) {
      if (src.data[pi] < 8) dark[i] = 0;
    }

    let pts = importanceSample(dark, w, h, Math.round(p.count), { seed: p.seed, candidates: 5, bias: p.bias });
    if (p.relaxIterations > 0) pts = relax(pts, dark, w, h, p.relaxIterations, 2);

    const kx = ctx.srcWidth / w, ky = ctx.srcHeight / h;
    const k = (kx + ky) / 2;
    const parts = [];
    const rot = (p.rotation * Math.PI) / 180;

    for (const [x, y] of pts) {
      const xi = clamp(Math.round(x), 0, w - 1), yi = clamp(Math.round(y), 0, h - 1);
      const t = clamp(dark[yi * w + xi], 0, 1);
      if (t <= 0.002) continue;
      const size = (p.minSize + (p.maxSize - p.minSize) * Math.pow(t, 1) * p.sizeByTone
        + (p.maxSize - p.minSize) * (1 - p.sizeByTone) * 0.5) * k;
      if (size < 0.03) continue;
      const cx = x * kx, cy = y * ky;
      let fill = p.inkColor;
      if (p.colorMode === 'image') fill = rgbCss(averageRegion(src, x - 1, y - 1, x + 1, y + 1));
      switch (p.shape) {
        case 'square':
          parts.push(`<rect x="${n(cx - size)}" y="${n(cy - size)}" width="${n(size * 2)}" height="${n(size * 2)}" fill="${fill}"/>`);
          break;
        case 'dash': {
          const dx = Math.cos(rot) * size * 2.4, dy = Math.sin(rot) * size * 2.4;
          parts.push(`<line x1="${n(cx - dx)}" y1="${n(cy - dy)}" x2="${n(cx + dx)}" y2="${n(cy + dy)}" stroke="${fill}" stroke-width="${n(size * 0.9)}" stroke-linecap="round"/>`);
          break;
        }
        case 'triangle':
          parts.push(`<polygon points="${n(cx)},${n(cy - size * 1.2)} ${n(cx + size)},${n(cy + size * 0.8)} ${n(cx - size)},${n(cy + size * 0.8)}" fill="${fill}"/>`);
          break;
        case 'plus':
          parts.push(`<path d="M${n(cx - size)} ${n(cy)}H${n(cx + size)}M${n(cx)} ${n(cy - size)}V${n(cy + size)}" stroke="${fill}" stroke-width="${n(size * 0.6)}" stroke-linecap="round"/>`);
          break;
        default:
          parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(size)}" fill="${fill}"/>`);
      }
    }

    const svg = svgDoc({
      width: ctx.srcWidth, height: ctx.srcHeight,
      bg: p.background ? p.bgColor : null,
      body: [group({ 'data-bix-layer': 'stipple', opacity: p.opacity < 1 ? p.opacity : null }, parts)],
      meta: { transform: 'Stipple' },
    });
    return { type: 'svg', svg, stats: { dots: parts.length } };
  },
};
