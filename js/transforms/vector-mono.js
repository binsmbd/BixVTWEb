/* Stencil / screen-print vectoriser: tonal levels traced as stacked flat layers. */
import { P, fitToLongEdge } from './_shared.js';
import { lumaMap, boxBlurPlane, threshold, otsu, dilate, erode, despeckle } from '../image/filters.js';
import { traceMask, signedArea } from '../geom/trace.js';
import { simplifyClosed, ringToPath } from '../geom/poly.js';
import { svgDoc, pathEl, group, rgbCss } from '../export/svg.js';
import { rampColor, GRADIENTS, hexToRgb } from '../image/color.js';

export default {
  id: 'vector-mono',
  label: 'Stencil / Screenprint',
  group: 'Vector',
  icon: 'M5 5 h14 v6 h-8 v8 H5 Z',
  blurb: 'Threshold or posterise into stacked ink layers — cutting files, stencils, screen prints.',
  output: 'svg',
  params: [
    P.group('Tone'),
    P.range('resolution', 'Trace detail', 200, 2000, 20, 900, { unit: 'px' }),
    P.select('mode', 'Mode', ['threshold', 'levels'], 'threshold'),
    P.range('levels', 'Ink levels', 2, 10, 1, 4, { showIf: (v) => v.mode === 'levels' }),
    P.toggle('auto', 'Auto threshold (Otsu)', true, { showIf: (v) => v.mode === 'threshold' }),
    P.range('level', 'Threshold', 0, 255, 1, 128, { showIf: (v) => v.mode === 'threshold' && !v.auto }),
    P.toggle('adaptive', 'Adaptive (local)', false, { showIf: (v) => v.mode === 'threshold' }),
    P.range('adaptRadius', 'Local radius', 2, 60, 1, 14, { showIf: (v) => v.adaptive }),
    P.range('adaptBias', 'Local bias', -30, 30, 1, 6, { showIf: (v) => v.adaptive }),
    P.toggle('invert', 'Invert', false),
    P.range('preBlur', 'Smooth input', 0, 8, 0.5, 1),
    P.group('Cleanup'),
    P.range('grow', 'Grow / shrink', -4, 4, 1, 0, { unit: 'px' }),
    P.range('despeckle', 'Despeckle', 0, 600, 5, 40, { unit: 'px²' }),
    P.range('tolerance', 'Simplify', 0, 6, 0.05, 1.1, { unit: 'px' }),
    P.range('smooth', 'Curve smoothing', 0, 1.6, 0.02, 0.9),
    P.range('corner', 'Corner threshold', 0.2, 2.4, 0.05, 1.1),
    P.range('cornerMinLen', 'Corner min length', 0, 8, 0.1, 2.2, { unit: 'px', hint: 'Segments shorter than this are treated as pixel stair-stepping and smoothed away.' }),
    P.group('Ink'),
    P.gradient('ramp', 'Ink ramp', 'ink', { showIf: (v) => v.mode === 'levels' }),
    P.color('inkColor', 'Ink colour', '#111318', { showIf: (v) => v.mode === 'threshold' }),
    P.toggle('background', 'Fill background', true),
    P.color('bgColor', 'Background', '#f7f4ee'),
  ],
  presets: [
    { name: 'Vinyl cut', values: { mode: 'threshold', auto: true, tolerance: 2, smooth: 1.1, despeckle: 160 } },
    { name: 'Screenprint 4', values: { mode: 'levels', levels: 4, ramp: 'ember', tolerance: 1.2, smooth: 0.9 } },
    { name: 'Comic ink', values: { mode: 'threshold', adaptive: true, adaptRadius: 10, adaptBias: 8, tolerance: 0.6, smooth: 0.6 } },
    { name: 'Duotone poster', values: { mode: 'levels', levels: 6, ramp: 'violet', tolerance: 1.5, smooth: 1.0 } },
  ],

  run(ctx) {
    const p = ctx.params;
    const { img: work } = fitToLongEdge(ctx.img, p.resolution);
    const w = work.width, h = work.height;
    let lum = lumaMap(work);
    if (p.preBlur > 0) lum = boxBlurPlane(lum, w, h, p.preBlur, 2);

    const layers = [];
    if (p.mode === 'threshold') {
      const lvl = p.auto ? otsu(lum) : p.level;
      layers.push({ mask: threshold(lum, w, h, lvl, {
        adaptive: p.adaptive, radius: p.adaptRadius, bias: p.adaptBias, invert: p.invert,
      }), color: hexToRgb(p.inkColor) });
    } else {
      const stops = GRADIENTS[p.ramp] || GRADIENTS.ink;
      for (let i = 1; i <= p.levels; i++) {
        const cut = 255 * (1 - i / (p.levels + 1));
        const m = threshold(lum, w, h, cut, { invert: p.invert });
        const t = i / p.levels;
        layers.push({ mask: m, color: rampColor(stops, p.invert ? 1 - t : t) });
      }
      // Darkest ink last so layers stack correctly.
      layers.reverse();
    }

    const body = [];
    let pathCount = 0, pointCount = 0;
    for (const layer of layers) {
      let mask = layer.mask;
      if (p.grow > 0) mask = dilate(mask, w, h, p.grow);
      else if (p.grow < 0) mask = erode(mask, w, h, -p.grow);
      if (p.despeckle > 0) {
        const cleaned = despeckle(mask, w, h, p.despeckle, 8);
        mask = Uint8Array.from(cleaned, (v) => (v ? 1 : 0));
      }
      const loops = traceMask(mask, w, h, { connectivity: 8 });
      const subs = [];
      for (const loop of loops) {
        if (Math.abs(signedArea(loop)) < 2) continue;
        const s = simplifyClosed(loop, p.tolerance);
        if (s.length < 3) continue;
        pointCount += s.length;
        const d = ringToPath(s, { smooth: p.smooth, cornerAngle: p.corner, cornerMinLen: p.cornerMinLen });
        if (d) subs.push(d);
      }
      if (!subs.length) continue;
      pathCount++;
      body.push(pathEl(subs.join(''), {
        fill: rgbCss(layer.color), 'fill-rule': 'nonzero', 'data-bix-layer': 'ink',
      }));
    }

    const svg = svgDoc({
      width: ctx.srcWidth,
      height: ctx.srcHeight,
      bg: p.background ? p.bgColor : null,
      body: [group({ transform: `scale(${(ctx.srcWidth / w).toFixed(6)} ${(ctx.srcHeight / h).toFixed(6)})` }, body)],
      meta: { transform: 'Stencil' },
    });
    return { type: 'svg', svg, stats: { paths: pathCount, points: pointCount, colors: layers.length } };
  },
};
