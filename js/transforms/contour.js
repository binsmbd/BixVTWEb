/* Topographic contour lines — iso-luminance curves, optionally filled like a map. */
import { P, fitToLongEdge } from './_shared.js';
import { lumaMap, boxBlurPlane } from '../image/filters.js';
import { marchingSquares } from '../geom/trace.js';
import { simplify, polylineToPath } from '../geom/poly.js';
import { svgDoc, group, rgbCss } from '../export/svg.js';
import { rampColor, GRADIENTS } from '../image/color.js';
import { n } from '../core/util.js';

export default {
  id: 'contour',
  label: 'Contour Map',
  group: 'Line',
  icon: 'M4 18 C8 10 16 16 20 8 M4 13 C9 6 15 12 20 4',
  blurb: 'Iso-luminance curves — turns any photo into a topographic map.',
  output: 'svg',
  params: [
    P.group('Levels'),
    P.range('resolution', 'Detail', 200, 1600, 20, 700, { unit: 'px' }),
    P.range('levels', 'Contour levels', 2, 40, 1, 12),
    P.range('smoothing', 'Field smoothing', 0, 20, 0.5, 3),
    P.range('tolerance', 'Simplify', 0, 4, 0.05, 0.5),
    P.range('curve', 'Curve smoothing', 0, 1.6, 0.02, 1),
    P.range('minLength', 'Min line length', 0, 200, 1, 12, { unit: 'px' }),
    P.toggle('invert', 'Invert levels', false),
    P.group('Style'),
    P.select('style', 'Style', ['lines', 'filled', 'both'], 'lines'),
    P.gradient('ramp', 'Fill ramp', 'ocean', { showIf: (v) => v.style !== 'lines' }),
    P.color('lineColor', 'Line colour', '#11202b', { showIf: (v) => v.style !== 'filled' }),
    P.range('strokeWidth', 'Line width', 0.1, 5, 0.05, 0.8, { unit: 'px' }),
    P.toggle('indexLines', 'Bold every 5th', true, { showIf: (v) => v.style !== 'filled' }),
    P.range('opacity', 'Opacity', 0.1, 1, 0.02, 1),
    P.toggle('background', 'Fill background', true),
    P.color('bgColor', 'Background', '#f4f1e8'),
  ],
  presets: [
    { name: 'Topo map', values: { levels: 14, style: 'both', ramp: 'earth', strokeWidth: 0.6 } },
    { name: 'Fine engraving', values: { levels: 26, style: 'lines', strokeWidth: 0.4, smoothing: 2 } },
    { name: 'Bold poster', values: { levels: 6, style: 'filled', ramp: 'sunrise', smoothing: 8 } },
    { name: 'Depth chart', values: { levels: 18, style: 'both', ramp: 'ocean', bgColor: '#031424', lineColor: '#8fd3e8' } },
  ],

  run(ctx) {
    const p = ctx.params;
    const { img: work } = fitToLongEdge(ctx.img, p.resolution);
    const w = work.width, h = work.height;
    let lum = lumaMap(work);
    if (p.smoothing > 0) lum = boxBlurPlane(lum, w, h, p.smoothing, 3);
    if (p.invert) for (let i = 0; i < lum.length; i++) lum[i] = 255 - lum[i];

    const stops = GRADIENTS[p.ramp] || GRADIENTS.ocean;
    const body = [];
    let lines = 0, points = 0;

    // Filled bands are drawn dark→light so each level stacks over the last.
    if (p.style !== 'lines') {
      const fills = [];
      for (let i = 0; i < p.levels; i++) {
        const t = i / (p.levels - 1 || 1);
        const level = 255 * t;
        const paths = marchingSquares(lum, w, h, level)
          .filter((pl) => pl.length > 3)
          .map((pl) => polylineToPath(simplify(pl, p.tolerance), { smooth: p.curve, close: true }));
        if (!paths.length) continue;
        fills.push(`<path d="${paths.join('')}" fill="${rgbCss(rampColor(stops, t))}" fill-rule="evenodd"/>`);
      }
      body.push(group({ 'data-bix-layer': 'contour-fill' }, fills));
    }

    if (p.style !== 'filled') {
      for (let i = 1; i <= p.levels; i++) {
        const t = i / (p.levels + 1);
        const level = 255 * t;
        const paths = [];
        for (const pl of marchingSquares(lum, w, h, level)) {
          let total = 0;
          for (let j = 1; j < pl.length; j++) total += Math.hypot(pl[j][0] - pl[j - 1][0], pl[j][1] - pl[j - 1][1]);
          if (total < p.minLength) continue;
          const s = simplify(pl, p.tolerance);
          points += s.length;
          lines++;
          paths.push(polylineToPath(s, { smooth: p.curve }));
        }
        if (!paths.length) continue;
        const bold = p.indexLines && i % 5 === 0;
        body.push(`<path d="${paths.join('')}" fill="none" stroke="${p.lineColor}" `
          + `stroke-width="${n(p.strokeWidth * (bold ? 2.1 : 1))}" stroke-linejoin="round" stroke-linecap="round" `
          + `data-bix-layer="contour-${i}"/>`);
      }
    }

    const svg = svgDoc({
      width: ctx.srcWidth, height: ctx.srcHeight,
      bg: p.background ? p.bgColor : null,
      body: [group({
        transform: `scale(${(ctx.srcWidth / w).toFixed(6)} ${(ctx.srcHeight / h).toFixed(6)})`,
        opacity: p.opacity < 1 ? p.opacity : null,
      }, body)],
      meta: { transform: 'Contour Map' },
    });
    return { type: 'svg', svg, stats: { lines, points, levels: p.levels } };
  },
};
