/* Cross-hatching — tonal bands rendered as layered pen strokes at different angles. */
import { P, darknessMap, fitToLongEdge } from './_shared.js';
import { blurImage } from '../image/filters.js';
import { svgDoc, group } from '../export/svg.js';
import { n, deg, mulberry32 } from '../core/util.js';

export default {
  id: 'crosshatch',
  label: 'Cross Hatch',
  group: 'Line',
  icon: 'M4 14 L14 4 M8 18 L18 8 M4 6 L18 20',
  blurb: 'Engraving-style hatching: each tonal band adds another pen pass.',
  output: 'svg',
  params: [
    P.group('Hatching'),
    P.range('layers', 'Hatch passes', 1, 6, 1, 4),
    P.range('spacing', 'Line spacing', 1.5, 30, 0.5, 7, { unit: 'px' }),
    P.range('baseAngle', 'First angle', 0, 180, 1, 45, { unit: '°' }),
    P.range('angleStep', 'Angle step', 0, 90, 1, 40, { unit: '°' }),
    P.range('strokeWidth', 'Pen width', 0.1, 4, 0.05, 0.75, { unit: 'px' }),
    P.range('gamma', 'Tone curve', 0.3, 3, 0.05, 1.35),
    P.range('jitter', 'Hand jitter', 0, 3, 0.05, 0.35, { unit: 'px' }),
    P.range('overshoot', 'Overshoot', 0, 12, 0.5, 2, { unit: 'px', hint: 'Lets strokes run past the tone band, like a real pen.' }),
    P.toggle('invert', 'Invert tone', false),
    P.range('preBlur', 'Smooth input', 0, 12, 0.5, 1.5),
    P.seed('seed', 'Seed', 4),
    P.group('Colour'),
    P.color('inkColor', 'Ink', '#12151b'),
    P.toggle('tintLayers', 'Tint each pass', false),
    P.color('inkB', 'Second ink', '#c1121f', { showIf: (v) => v.tintLayers }),
    P.range('opacity', 'Opacity', 0.1, 1, 0.02, 0.9),
    P.toggle('background', 'Fill background', true),
    P.color('bgColor', 'Paper', '#f8f5ee'),
  ],
  presets: [
    { name: 'Engraving', values: { layers: 4, spacing: 4, strokeWidth: 0.5, angleStep: 40 } },
    { name: 'Sketchbook', values: { layers: 3, spacing: 7, strokeWidth: 0.9, jitter: 1.2, overshoot: 6 } },
    { name: 'Dense mezzotint', values: { layers: 6, spacing: 2.5, strokeWidth: 0.35, angleStep: 30 } },
    { name: 'Two-colour print', values: { layers: 4, tintLayers: true, spacing: 5, opacity: 0.8 } },
  ],

  run(ctx) {
    const p = ctx.params;
    const { img: work } = fitToLongEdge(ctx.img, 1100);
    const src = p.preBlur > 0 ? blurImage(work, p.preBlur, 2) : work;
    const w = src.width, h = src.height;
    const kx = ctx.srcWidth / w, ky = ctx.srcHeight / h;
    const k = (kx + ky) / 2;
    const rnd = mulberry32(p.seed);
    const dark = darknessMap(src, { gamma: p.gamma, invert: p.invert });
    for (let i = 0, pi = 3; i < dark.length; i++, pi += 4) if (src.data[pi] < 8) dark[i] = 0;

    const toneAt = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      return dark[(Math.round(y) | 0) * w + (Math.round(x) | 0)];
    };

    const body = [];
    const diag = Math.hypot(w, h);
    const spacing = p.spacing / k;
    let strokes = 0;

    for (let layer = 0; layer < p.layers; layer++) {
      // Each successive pass only inks progressively darker tone.
      const cut = (layer + 1) / (p.layers + 1);
      const a = deg(p.baseAngle + layer * p.angleStep);
      const ca = Math.cos(a), sa = Math.sin(a);
      const segs = [];
      const step = Math.max(0.7, spacing / 3);
      for (let off = -diag / 2; off <= diag / 2; off += spacing) {
        let run = null;
        for (let t = -diag / 2; t <= diag / 2; t += step) {
          const x = w / 2 + t * ca - off * sa;
          const y = h / 2 + t * sa + off * ca;
          const inside = x >= 0 && y >= 0 && x < w && y < h;
          const on = inside && toneAt(x, y) >= cut;
          if (on) {
            if (!run) run = [[x, y]];
            else run.push([x, y]);
          } else if (run) {
            if (run.length > 1) segs.push(run);
            run = null;
          }
        }
        if (run && run.length > 1) segs.push(run);
      }
      const d = [];
      for (const seg of segs) {
        const first = seg[0], last = seg[seg.length - 1];
        const over = p.overshoot / k;
        const jx = (rnd() - 0.5) * p.jitter / k, jy = (rnd() - 0.5) * p.jitter / k;
        const x1 = (first[0] - ca * over + jx) * kx, y1 = (first[1] - sa * over + jy) * ky;
        const x2 = (last[0] + ca * over + jx) * kx, y2 = (last[1] + sa * over + jy) * ky;
        // A gentle bow keeps the stroke from looking machine-made.
        const mx = (x1 + x2) / 2 - sa * (rnd() - 0.5) * p.jitter * 3;
        const my = (y1 + y2) / 2 + ca * (rnd() - 0.5) * p.jitter * 3;
        d.push(`M${n(x1)} ${n(y1)}Q${n(mx)} ${n(my)} ${n(x2)} ${n(y2)}`);
        strokes++;
      }
      if (!d.length) continue;
      const ink = p.tintLayers && layer % 2 === 1 ? p.inkB : p.inkColor;
      body.push(`<path d="${d.join('')}" fill="none" stroke="${ink}" stroke-width="${n(p.strokeWidth)}" stroke-linecap="round" data-bix-layer="hatch-${layer + 1}"/>`);
    }

    const svg = svgDoc({
      width: ctx.srcWidth, height: ctx.srcHeight,
      bg: p.background ? p.bgColor : null,
      body: [group({ opacity: p.opacity < 1 ? p.opacity : null }, body)],
      meta: { transform: 'Cross Hatch' },
    });
    return { type: 'svg', svg, stats: { strokes, passes: p.layers } };
  },
};
