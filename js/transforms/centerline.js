/* Centreline tracer — turns strokes, sketches and lettering into single-line paths.
   Ideal for pen plotters, laser engravers and editable line art. */
import { P, fitToLongEdge } from './_shared.js';
import { lumaMap, boxBlurPlane, threshold, otsu, skeletonize, dilate, canny } from '../image/filters.js';
import { traceSkeleton } from '../geom/trace.js';
import { simplify, polylineToPath, perimeter } from '../geom/poly.js';
import { svgDoc, pathEl, group } from '../export/svg.js';

export default {
  id: 'centerline',
  label: 'Centerline / Plotter',
  group: 'Vector',
  icon: 'M4 16 C8 4 14 20 20 8',
  blurb: 'Single-stroke skeleton paths — the format pen plotters and laser cutters want.',
  output: 'svg',
  params: [
    P.group('Source'),
    P.range('resolution', 'Trace detail', 200, 1600, 20, 800, { unit: 'px' }),
    P.select('source', 'Line source', ['edges', 'dark-areas'], 'edges',
      { hint: '"Edges" skeletonises detected contours — better for photos.' }),
    P.toggle('auto', 'Auto threshold', true, { showIf: (v) => v.source === 'dark-areas' }),
    P.range('level', 'Threshold', 0, 255, 1, 140, { showIf: (v) => v.source === 'dark-areas' && !v.auto }),
    P.toggle('adaptive', 'Adaptive', false, { showIf: (v) => v.source === 'dark-areas' }),
    P.range('adaptRadius', 'Local radius', 2, 60, 1, 16, { showIf: (v) => v.adaptive }),
    P.range('edgeLow', 'Edge low', 2, 120, 1, 14, { showIf: (v) => v.source === 'edges' }),
    P.range('edgeHigh', 'Edge high', 5, 200, 1, 38, { showIf: (v) => v.source === 'edges' }),
    P.toggle('invert', 'Invert', false),
    P.range('preBlur', 'Smooth input', 0, 8, 0.5, 1),
    P.range('thicken', 'Thicken before thinning', 0, 4, 1, 0, { unit: 'px' }),
    P.group('Strokes'),
    P.range('minLength', 'Min stroke length', 0, 120, 1, 6, { unit: 'px' }),
    P.range('tolerance', 'Simplify', 0, 6, 0.05, 1),
    P.range('smooth', 'Curve smoothing', 0, 1.6, 0.02, 0.9),
    P.range('strokeWidth', 'Stroke width', 0.1, 12, 0.1, 1.4, { unit: 'px' }),
    P.color('strokeColor', 'Stroke colour', '#14161c'),
    P.select('cap', 'Line cap', ['round', 'butt', 'square'], 'round'),
    P.toggle('background', 'Fill background', true),
    P.color('bgColor', 'Background', '#ffffff'),
  ],
  presets: [
    { name: 'Pen plotter', values: { source: 'edges', strokeWidth: 1, smooth: 1, minLength: 12 } },
    { name: 'Silhouette strokes', values: { source: 'dark-areas', auto: true, strokeWidth: 1.6, minLength: 14, thicken: 1 } },
    { name: 'Photo linework', values: { source: 'edges', edgeLow: 16, edgeHigh: 42, strokeWidth: 1.1, minLength: 10, resolution: 1000 } },
    { name: 'Bold marker', values: { strokeWidth: 5, smooth: 1.2, minLength: 24, tolerance: 2, thicken: 1 } },
    { name: 'Signature clean-up', values: { source: 'dark-areas', adaptive: true, strokeWidth: 2, minLength: 6 } },
  ],

  run(ctx) {
    const p = ctx.params;
    const { img: work } = fitToLongEdge(ctx.img, p.resolution);
    const w = work.width, h = work.height;
    let lum = lumaMap(work);
    if (p.preBlur > 0) lum = boxBlurPlane(lum, w, h, p.preBlur, 2);

    let mask;
    if (p.source === 'edges') {
      mask = canny(lum, w, h, { blur: 1, low: p.edgeLow, high: p.edgeHigh });
      if (p.invert) for (let i = 0; i < mask.length; i++) mask[i] = mask[i] ? 0 : 1;
    } else {
      const lvl = p.auto ? otsu(lum) : p.level;
      mask = threshold(lum, w, h, lvl, {
        adaptive: p.adaptive, radius: p.adaptRadius, bias: 6, invert: p.invert,
      });
    }
    if (p.thicken > 0) mask = dilate(mask, w, h, p.thicken);

    const skel = skeletonize(mask, w, h);
    const raw = traceSkeleton(skel, w, h, { minLength: 3 });

    const body = [];
    let strokes = 0, points = 0, ink = 0;
    const subs = [];
    for (const line of raw) {
      if (perimeter(line) < p.minLength) continue;
      const s = simplify(line, p.tolerance);
      if (s.length < 2) continue;
      strokes++; points += s.length; ink += perimeter(s);
      subs.push(polylineToPath(s, { smooth: p.smooth }));
    }
    if (subs.length) {
      body.push(pathEl(subs.join(''), {
        fill: 'none',
        stroke: p.strokeColor,
        'stroke-width': p.strokeWidth,
        'stroke-linecap': p.cap,
        'stroke-linejoin': 'round',
        'data-bix-layer': 'centerline',
      }));
    }

    const svg = svgDoc({
      width: ctx.srcWidth,
      height: ctx.srcHeight,
      bg: p.background ? p.bgColor : null,
      body: [group({ transform: `scale(${(ctx.srcWidth / w).toFixed(6)} ${(ctx.srcHeight / h).toFixed(6)})` }, body)],
      meta: { transform: 'Centerline' },
    });
    return { type: 'svg', svg, stats: { paths: strokes, points, length: Math.round(ink * (ctx.srcWidth / w)) } };
  },
};
