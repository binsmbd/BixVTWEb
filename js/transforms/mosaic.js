/* Mosaic / tessellation: voronoi, hex, brick, triangle and diamond cell art. */
import { P, fitToLongEdge } from './_shared.js';
import { voronoi } from '../geom/voronoi.js';
import { importanceSample, relax } from '../geom/sampling.js';
import { sobel, lumaMap, boxBlurPlane, blurImage, averageRegion } from '../image/filters.js';
import { svgDoc, group, rgbCss, polygonEl } from '../export/svg.js';
import { clamp, n, mulberry32 } from '../core/util.js';
import { luma } from '../image/color.js';

const LAYOUTS = ['voronoi', 'square', 'hex', 'brick', 'triangle', 'diamond', 'scales'];

function polyCentroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

function gridCells(layout, w, h, size, rnd) {
  const cells = [];
  const push = (pts) => cells.push(pts);
  const rows = Math.ceil(h / size) + 1;
  const cols = Math.ceil(w / size) + 1;
  if (layout === 'square') {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * size, y = r * size;
      push([[x, y], [x + size, y], [x + size, y + size], [x, y + size]]);
    }
  } else if (layout === 'brick') {
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * size * 0.5;
      for (let c = -1; c < cols; c++) {
        const x = c * size + off, y = r * size * 0.55;
        push([[x, y], [x + size, y], [x + size, y + size * 0.55], [x, y + size * 0.55]]);
      }
    }
  } else if (layout === 'hex') {
    const R = size / 2;
    const dx = R * Math.sqrt(3), dy = R * 1.5;
    for (let r = -1; r < rows + 1; r++) {
      for (let c = -1; c < cols + 1; c++) {
        const cx = c * dx + (r % 2 ? dx / 2 : 0), cy = r * dy;
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 180 * (60 * i - 90);
          pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
        }
        push(pts);
      }
    }
  } else if (layout === 'triangle') {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * size, y = r * size;
      if ((r + c) % 2 === 0) {
        push([[x, y], [x + size, y], [x, y + size]]);
        push([[x + size, y], [x + size, y + size], [x, y + size]]);
      } else {
        push([[x, y], [x + size, y], [x + size, y + size]]);
        push([[x, y], [x + size, y + size], [x, y + size]]);
      }
    }
  } else if (layout === 'diamond') {
    for (let r = -1; r < rows * 2; r++) for (let c = -1; c < cols; c++) {
      const cx = c * size + (r % 2 ? size / 2 : 0), cy = r * size * 0.5;
      push([[cx, cy - size / 2], [cx + size / 2, cy], [cx, cy + size / 2], [cx - size / 2, cy]]);
    }
  } else if (layout === 'scales') {
    const R = size * 0.62;
    for (let r = -1; r < rows + 1; r++) for (let c = -1; c < cols + 1; c++) {
      const cx = c * size + (r % 2 ? size / 2 : 0), cy = r * size * 0.62;
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI + (Math.PI * i) / 12;
        pts.push([cx + R * Math.cos(a), cy - R * Math.sin(a) * 0.9]);
      }
      push(pts);
    }
  }
  return cells;
}

export default {
  id: 'mosaic',
  label: 'Mosaic / Tessellation',
  group: 'Geometric',
  icon: 'M4 4h7v7H4Z M13 4h7v7h-7Z M4 13h7v7H4Z M13 13h7v7h-7Z',
  blurb: 'Voronoi shards, hex tiles, brickwork and fish-scale patterns rebuilt from your image.',
  output: 'svg',
  params: [
    P.group('Tiles'),
    P.select('layout', 'Layout', LAYOUTS, 'voronoi'),
    P.range('cells', 'Cell count', 40, 6000, 20, 900, { showIf: (v) => v.layout === 'voronoi' }),
    P.range('size', 'Tile size', 4, 120, 1, 26, { unit: 'px', showIf: (v) => v.layout !== 'voronoi' }),
    P.range('edgeBias', 'Follow edges', 0, 1, 0.02, 0.55, { showIf: (v) => v.layout === 'voronoi' }),
    P.range('relaxIterations', 'Even spacing', 0, 4, 1, 2, { showIf: (v) => v.layout === 'voronoi' }),
    P.range('rotate', 'Rotate grid', -45, 45, 1, 0, { unit: '°', showIf: (v) => v.layout !== 'voronoi' }),
    P.seed('seed', 'Seed', 5),
    P.group('Look'),
    P.range('inset', 'Grout / inset', 0, 0.35, 0.005, 0.03),
    P.range('round', 'Corner rounding', 0, 1, 0.02, 0),
    P.range('saturate', 'Saturation', -100, 100, 1, 8),
    P.range('preBlur', 'Smooth input', 0, 10, 0.5, 1),
    P.range('strokeWidth', 'Tile outline', 0, 4, 0.05, 0),
    P.color('strokeColor', 'Outline colour', '#0b0d12'),
    P.toggle('background', 'Fill background', true),
    P.color('bgColor', 'Grout colour', '#0b0d12'),
  ],
  presets: [
    { name: 'Stained glass', values: { layout: 'voronoi', cells: 500, strokeWidth: 1.6, strokeColor: '#0a0a0f', inset: 0.02, saturate: 30 } },
    { name: 'Ceramic hex', values: { layout: 'hex', size: 30, inset: 0.06, bgColor: '#f2ede3' } },
    { name: 'Brick wall', values: { layout: 'brick', size: 40, inset: 0.05, bgColor: '#2a2320' } },
    { name: 'Fish scales', values: { layout: 'scales', size: 26, inset: 0.02 } },
    { name: 'Crystal shards', values: { layout: 'voronoi', cells: 2200, edgeBias: 0.85, relaxIterations: 0, inset: 0 } },
  ],

  run(ctx) {
    const p = ctx.params;
    const { img: work } = fitToLongEdge(ctx.img, 900);
    const src = p.preBlur > 0 ? blurImage(work, p.preBlur, 2) : work;
    const w = src.width, h = src.height;
    const rnd = mulberry32(p.seed);
    const kx = ctx.srcWidth / w, ky = ctx.srcHeight / h;

    let cells = [];
    if (p.layout === 'voronoi') {
      const lum = lumaMap(src);
      const { mag } = sobel(boxBlurPlane(lum, w, h, 1, 2), w, h);
      let mx = 1e-6;
      for (let i = 0; i < mag.length; i++) if (mag[i] > mx) mx = mag[i];
      const density = new Float32Array(w * h);
      for (let i = 0; i < density.length; i++) {
        density[i] = (1 - p.edgeBias) * 0.4 + p.edgeBias * Math.pow(mag[i] / mx, 0.7) + 0.02;
      }
      let pts = importanceSample(density, w, h, Math.round(p.cells), { seed: p.seed, candidates: 6 });
      if (p.relaxIterations) pts = relax(pts, density, w, h, p.relaxIterations, 3);
      cells = voronoi(pts, w, h).filter(Boolean);
    } else {
      const size = p.size / Math.max(kx, 0.001);
      const raw = gridCells(p.layout, w, h, size, rnd);
      if (p.rotate !== 0) {
        const a = (p.rotate * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
        const cx0 = w / 2, cy0 = h / 2;
        const pad = Math.max(w, h);
        cells = gridCells(p.layout, w + pad * 2, h + pad * 2, size, rnd).map((poly) =>
          poly.map(([x, y]) => {
            const dx = x - pad - cx0, dy = y - pad - cy0;
            return [cx0 + dx * ca - dy * sa, cy0 + dx * sa + dy * ca];
          }));
        cells = cells.filter((poly) => {
          const [cx, cy] = polyCentroid(poly);
          return cx > -size && cy > -size && cx < w + size && cy < h + size;
        });
      } else {
        cells = raw;
      }
    }

    const sat = 1 + p.saturate / 100;
    const parts = [];
    for (const poly of cells) {
      const [cx, cy] = polyCentroid(poly);
      if (cx < -2 || cy < -2 || cx > w + 2 || cy > h + 2) continue;
      const col = averageRegion(src, cx - 2, cy - 2, cx + 2, cy + 2);
      if (col[3] < 6) continue;
      const l = luma(col[0], col[1], col[2]);
      const fill = rgbCss([
        clamp(l + (col[0] - l) * sat, 0, 255),
        clamp(l + (col[1] - l) * sat, 0, 255),
        clamp(l + (col[2] - l) * sat, 0, 255),
      ]);
      const shrunk = poly.map(([x, y]) => [
        (x + (cx - x) * p.inset) * kx,
        (y + (cy - y) * p.inset) * ky,
      ]);
      if (p.round > 0) {
        // Round corners by cutting each vertex toward its neighbours.
        const d = [];
        const L = shrunk.length;
        for (let i = 0; i < L; i++) {
          const prev = shrunk[(i - 1 + L) % L], cur = shrunk[i], nxt = shrunk[(i + 1) % L];
          const t = 0.5 * p.round;
          const a = [cur[0] + (prev[0] - cur[0]) * t, cur[1] + (prev[1] - cur[1]) * t];
          const b = [cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t];
          d.push(i === 0 ? `M${n(a[0])} ${n(a[1])}` : `L${n(a[0])} ${n(a[1])}`);
          d.push(`Q${n(cur[0])} ${n(cur[1])} ${n(b[0])} ${n(b[1])}`);
        }
        parts.push(`<path d="${d.join('')}Z" fill="${fill}"/>`);
      } else {
        parts.push(polygonEl(shrunk, { fill }));
      }
    }

    const svg = svgDoc({
      width: ctx.srcWidth, height: ctx.srcHeight,
      bg: p.background ? p.bgColor : null,
      body: [group({
        'data-bix-layer': 'mosaic',
        stroke: p.strokeWidth > 0 ? p.strokeColor : null,
        'stroke-width': p.strokeWidth > 0 ? p.strokeWidth : null,
        'stroke-linejoin': 'round',
      }, parts)],
      meta: { transform: 'Mosaic' },
    });
    return { type: 'svg', svg, stats: { tiles: parts.length, layout: p.layout } };
  },
};
