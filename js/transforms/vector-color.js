/* Full-colour vectoriser: quantise → clean → trace → curve-fit → layered SVG. */
import { P, fitToLongEdge } from './_shared.js';
import { buildPalette } from '../image/quantize.js';
import { quantizeToPalette, DITHER_MODES } from '../image/dither.js';
import { despeckle, blurImage } from '../image/filters.js';
import { traceMask, maskFromIndex, signedArea } from '../geom/trace.js';
import { simplifyClosed, ringToPath } from '../geom/poly.js';
import { svgDoc, pathEl, group, rgbCss } from '../export/svg.js';
import { luma } from '../image/color.js';

export default {
  id: 'vector-color',
  label: 'Color Trace',
  group: 'Vector',
  icon: 'M4 18 L9 6 L14 14 L17 9 L20 18 Z',
  blurb: 'Traces the image into flat colour shapes with real, editable Bézier paths.',
  output: 'svg',
  params: [
    P.group('Trace'),
    P.range('resolution', 'Trace detail', 200, 2000, 20, 800, { unit: 'px', hint: 'Working resolution — higher keeps fine detail, lower gives cleaner shapes.' }),
    P.range('colors', 'Colours', 2, 64, 1, 14),
    P.palette('palette', 'Palette', 'auto'),
    P.select('dither', 'Pre-dither', DITHER_MODES, 'none', { hint: 'Adds texture inside gradients before tracing.' }),
    P.range('preBlur', 'Smooth input', 0, 8, 0.5, 1),
    P.group('Shapes'),
    P.range('despeckle', 'Despeckle', 0, 400, 4, 24, { unit: 'px²' }),
    P.range('tolerance', 'Simplify', 0, 6, 0.05, 0.9, { unit: 'px' }),
    P.range('smooth', 'Curve smoothing', 0, 1.6, 0.02, 0.85 ),
    P.range('corner', 'Corner threshold', 0.2, 2.4, 0.05, 1.05, { hint: 'Higher keeps more sharp corners as corners.' }),
    P.range('cornerMinLen', 'Corner min length', 0, 8, 0.1, 2.2, { unit: 'px', hint: 'Segments shorter than this are treated as pixel stair-stepping and smoothed away.' }),
    P.range('minArea', 'Min shape area', 0, 500, 5, 10, { unit: 'px²' }),
    P.group('Style'),
    P.select('layerOrder', 'Layer order', ['area-desc', 'dark-first', 'light-first'], 'area-desc'),
    P.range('seam', 'Seam fill', 0, 3, 0.05, 0.9, { unit: 'px', hint: 'Hairline stroke in each layer’s own colour. Closes the sub-pixel cracks that appear where two smoothed regions meet.' }),
    P.range('strokeWidth', 'Outline', 0, 6, 0.1, 0, { unit: 'px' }),
    P.color('strokeColor', 'Outline colour', '#101014'),
    P.toggle('keepTransparent', 'Keep transparency', true, { hint: 'Leaves transparent source pixels empty instead of tracing them as shapes.' }),
    P.toggle('background', 'Fill background', true, { hint: 'Ignored while “Keep transparency” is on and the image actually has transparent pixels.' }),
    P.color('bgColor', 'Background', '#ffffff'),
    P.toggle('useBgFromImage', 'Background from image', true),
  ],
  presets: [
    { name: 'Poster art', values: { colors: 8, tolerance: 1.4, smooth: 1.0, despeckle: 60, resolution: 700 } },
    { name: 'Photo faithful', values: { colors: 32, tolerance: 0.5, smooth: 0.7, despeckle: 8, resolution: 1200, minArea: 4 } },
    { name: 'Sticker / logo', values: { colors: 5, tolerance: 2.2, smooth: 1.2, despeckle: 140, strokeWidth: 2.4, resolution: 600 } },
    { name: 'Papercut', values: { colors: 4, tolerance: 3, smooth: 0.2, corner: 0.5, despeckle: 200, resolution: 500 } },
    { name: 'Riso print', values: { colors: 6, palette: 'risograph', dither: 'bayer-4', tolerance: 1, smooth: 0.6 } },
  ],

  run(ctx) {
    const p = ctx.params;
    const { img: work } = fitToLongEdge(ctx.img, p.resolution);
    const src = p.preBlur > 0 ? blurImage(work, p.preBlur, 2) : work;
    const w = src.width, h = src.height;

    const palette = buildPalette(src, { colors: p.colors, paletteName: p.palette });
    const { indexMap } = quantizeToPalette(src, palette, { dither: p.dither, strength: 1 });
    let cleaned = p.despeckle > 0 ? despeckle(indexMap, w, h, p.despeckle, 8) : indexMap;
    // Transparent source pixels belong to no layer at all. The 50% cut also
    // drops the anti-aliased halo around cut-outs, which would otherwise trace
    // as a pale outline ring of its own.
    let transparentPixels = 0;
    if (p.keepTransparent) {
      cleaned = Int32Array.from(cleaned);
      for (let i = 0, a = 3; i < cleaned.length; i++, a += 4) {
        if (src.data[a] < 128) { cleaned[i] = -1; transparentPixels++; }
      }
    }
    const hasAlpha = transparentPixels > cleaned.length * 0.005;

    // Area per colour drives layer order and the background pick.
    const areas = new Array(palette.length).fill(0);
    for (let i = 0; i < cleaned.length; i++) if (cleaned[i] >= 0) areas[cleaned[i]]++;

    let order = palette.map((c, i) => i).filter((i) => areas[i] > 0);
    if (p.layerOrder === 'area-desc') order.sort((a, b) => areas[b] - areas[a]);
    else if (p.layerOrder === 'dark-first') order.sort((a, b) => luma(...palette[a]) - luma(...palette[b]));
    else order.sort((a, b) => luma(...palette[b]) - luma(...palette[a]));

    const body = [];
    let pathCount = 0, pointCount = 0;

    const bgIndex = order.slice().sort((a, b) => areas[b] - areas[a])[0];
    const bgFill = p.useBgFromImage && bgIndex != null ? rgbCss(palette[bgIndex]) : p.bgColor;

    for (const idx of order) {
      const mask = maskFromIndex(cleaned, w, h, idx);
      const loops = traceMask(mask, w, h, { connectivity: 4 });
      const subpaths = [];
      for (const loop of loops) {
        if (Math.abs(signedArea(loop)) < p.minArea) continue;
        const simple = simplifyClosed(loop, p.tolerance);
        if (simple.length < 3) continue;
        pointCount += simple.length;
        const d = ringToPath(simple, { smooth: p.smooth, cornerAngle: p.corner, cornerMinLen: p.cornerMinLen, precision: 2 });
        if (d) subpaths.push(d);
      }
      if (!subpaths.length) continue;
      pathCount++;
      const fill = rgbCss(palette[idx]);
      body.push(pathEl(subpaths.join(''), {
        fill,
        'fill-rule': 'nonzero',
        stroke: p.seam > 0 ? fill : (p.strokeWidth > 0 ? p.strokeColor : null),
        'stroke-width': p.seam > 0 ? p.seam : (p.strokeWidth > 0 ? p.strokeWidth : null),
        'stroke-linejoin': 'round',
        'data-bix-layer': `color-${idx}`,
      }));
      if (p.seam > 0 && p.strokeWidth > 0) {
        body.push(pathEl(subpaths.join(''), {
          fill: 'none', stroke: p.strokeColor, 'stroke-width': p.strokeWidth, 'stroke-linejoin': 'round',
        }));
      }
    }

    const svg = svgDoc({
      width: ctx.srcWidth,
      height: ctx.srcHeight,
      // Real transparency wins over the background fill: a cut-out should stay
      // a cut-out. Switch "Keep transparency" off to get a solid backdrop.
      bg: p.background && !hasAlpha ? bgFill : null,
      body: [group(
        { transform: `scale(${(ctx.srcWidth / w).toFixed(6)} ${(ctx.srcHeight / h).toFixed(6)})`, 'data-bix': 'trace' },
        body,
      )],
      meta: { transform: 'Color Trace' },
    });

    return { type: 'svg', svg, stats: { paths: pathCount, points: pointCount, colors: order.length } };
  },
};
