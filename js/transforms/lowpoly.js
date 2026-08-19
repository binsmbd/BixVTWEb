/* Low-poly: edge-aware point sampling → Delaunay → flat or gradient-shaded facets. */
import { P, fitToLongEdge } from './_shared.js';
import { triangulate } from '../geom/delaunay.js';
import { importanceSample, relax } from '../geom/sampling.js';
import { sobel, lumaMap, boxBlurPlane, blurImage, averageRegion } from '../image/filters.js';
import { svgDoc, group, rgbCss } from '../export/svg.js';
import { clamp, n } from '../core/util.js';
import { luma } from '../image/color.js';

export default {
  id: 'lowpoly',
  label: 'Low Poly',
  group: 'Geometric',
  icon: 'M4 19 L10 5 L20 12 Z M4 19 L20 12 L18 19 Z',
  blurb: 'Triangulated facets that follow the image structure — crisp, scalable, editable.',
  output: 'svg',
  params: [
    P.group('Mesh'),
    P.range('points', 'Vertices', 40, 6000, 10, 900),
    P.range('edgeBias', 'Follow edges', 0, 1, 0.02, 0.7, { hint: 'Pushes vertices onto contours so shapes stay readable.' }),
    P.range('relaxIterations', 'Even spacing', 0, 4, 1, 1),
    P.toggle('borderPoints', 'Pin the border', true),
    P.seed('seed', 'Seed', 11),
    P.group('Shading'),
    P.select('fillMode', 'Facet colour', ['centroid', 'average', 'vertex-blend'], 'average'),
    P.range('saturate', 'Saturation', -100, 100, 1, 6),
    P.range('lightness', 'Brightness', -60, 60, 1, 0),
    P.range('preBlur', 'Smooth input', 0, 10, 0.5, 1.5),
    P.group('Style'),
    P.range('strokeWidth', 'Facet outline', 0, 4, 0.05, 0, { unit: 'px' }),
    P.color('strokeColor', 'Outline colour', '#0d0f14'),
    P.range('gapScale', 'Facet inset', 0, 0.2, 0.005, 0, { hint: 'Shrinks each triangle for a shattered-glass look.' }),
    P.toggle('background', 'Fill background', true),
    P.color('bgColor', 'Background', '#0b0d12'),
  ],
  presets: [
    { name: 'Portrait facets', values: { points: 1400, edgeBias: 0.8, fillMode: 'average', relaxIterations: 1 } },
    { name: 'Poster crystal', values: { points: 350, edgeBias: 0.5, strokeWidth: 0.6, strokeColor: '#ffffff' } },
    { name: 'Shattered glass', values: { points: 700, gapScale: 0.06, strokeWidth: 0.4, bgColor: '#05060a' } },
    { name: 'Ultra fine', values: { points: 4000, edgeBias: 0.85, preBlur: 0.5, relaxIterations: 0 } },
  ],

  run(ctx) {
    const p = ctx.params;
    const { img: work } = fitToLongEdge(ctx.img, 900);
    const src = p.preBlur > 0 ? blurImage(work, p.preBlur, 2) : work;
    const w = src.width, h = src.height;

    // Density = edge energy blended with a uniform floor.
    const lum = lumaMap(src);
    const { mag } = sobel(boxBlurPlane(lum, w, h, 1, 2), w, h);
    let maxMag = 1e-6;
    for (let i = 0; i < mag.length; i++) if (mag[i] > maxMag) maxMag = mag[i];
    const density = new Float32Array(w * h);
    for (let i = 0; i < density.length; i++) {
      const e = mag[i] / maxMag;
      density[i] = (1 - p.edgeBias) * 0.35 + p.edgeBias * Math.pow(e, 0.7) + 0.02;
    }

    let pts = importanceSample(density, w, h, Math.round(p.points), { seed: p.seed, candidates: 6, bias: 1 });
    if (p.relaxIterations > 0) pts = relax(pts, density, w, h, p.relaxIterations, 3);

    if (p.borderPoints) {
      const steps = Math.max(4, Math.round(Math.sqrt(p.points) / 1.4));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        pts.push([t * (w - 1), 0], [t * (w - 1), h - 1], [0, t * (h - 1)], [w - 1, t * (h - 1)]);
      }
    }

    const tris = triangulate(pts);
    const kx = ctx.srcWidth / w, ky = ctx.srcHeight / h;
    const sat = 1 + p.saturate / 100;
    const parts = [];

    for (const [ia, ib, ic] of tris) {
      const A = pts[ia], B = pts[ib], C = pts[ic];
      const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3;
      let col;
      if (p.fillMode === 'centroid') {
        col = averageRegion(src, cx - 1, cy - 1, cx + 1, cy + 1);
      } else if (p.fillMode === 'vertex-blend') {
        const a = averageRegion(src, A[0] - 1, A[1] - 1, A[0] + 1, A[1] + 1);
        const b = averageRegion(src, B[0] - 1, B[1] - 1, B[0] + 1, B[1] + 1);
        const c = averageRegion(src, C[0] - 1, C[1] - 1, C[0] + 1, C[1] + 1);
        col = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3, 255];
      } else {
        // Barycentric multi-sample keeps facets faithful without full rasterisation.
        let r = 0, g = 0, b = 0, cnt = 0;
        const S = [[0.25, 0.25], [0.5, 0.25], [0.25, 0.5], [0.34, 0.34], [0.1, 0.8], [0.8, 0.1]];
        for (const [u, v] of S) {
          const x = A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * v;
          const y = A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * v;
          const s = averageRegion(src, x - 0.5, y - 0.5, x + 0.5, y + 0.5);
          r += s[0]; g += s[1]; b += s[2]; cnt++;
        }
        col = [r / cnt, g / cnt, b / cnt, 255];
      }
      const l = luma(col[0], col[1], col[2]);
      const shade = [
        clamp(l + (col[0] - l) * sat + p.lightness * 2.55, 0, 255),
        clamp(l + (col[1] - l) * sat + p.lightness * 2.55, 0, 255),
        clamp(l + (col[2] - l) * sat + p.lightness * 2.55, 0, 255),
      ];
      const shrink = p.gapScale;
      const pt = (P0) => [
        (P0[0] + (cx - P0[0]) * shrink) * kx,
        (P0[1] + (cy - P0[1]) * shrink) * ky,
      ];
      const [ax, ay] = pt(A), [bx, by] = pt(B), [cx2, cy2] = pt(C);
      parts.push(`<polygon points="${n(ax)},${n(ay)} ${n(bx)},${n(by)} ${n(cx2)},${n(cy2)}" fill="${rgbCss(shade)}"/>`);
    }

    const svg = svgDoc({
      width: ctx.srcWidth, height: ctx.srcHeight,
      bg: p.background ? p.bgColor : null,
      body: [group({
        'data-bix-layer': 'lowpoly',
        stroke: p.strokeWidth > 0 ? p.strokeColor : null,
        'stroke-width': p.strokeWidth > 0 ? p.strokeWidth : null,
        'stroke-linejoin': 'round',
      }, parts)],
      meta: { transform: 'Low Poly' },
    });
    return { type: 'svg', svg, stats: { triangles: tris.length, vertices: pts.length } };
  },
};
