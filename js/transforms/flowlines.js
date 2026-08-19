/*
 * Creative line engine — the "lyrical line" tool.
 * Six line systems (flow field, waves, spiral, concentric, radial, weave) whose
 * geometry, width and colour are all driven by the image.
 */
import { P, darknessMap, fitToLongEdge } from './_shared.js';
import { sobel, lumaMap, boxBlurPlane, blurImage, averageRegion } from '../image/filters.js';
import { svgDoc, group, rgbCss, polygonEl } from '../export/svg.js';
import { clamp, mulberry32, TAU, deg } from '../core/util.js';
import { simplify, ribbon } from '../geom/poly.js';

const MODES = ['flow', 'waves', 'spiral', 'concentric', 'radial', 'weave'];

export default {
  id: 'flowlines',
  label: 'Flow & Line Art',
  group: 'Line',
  icon: 'M3 17 C7 6 11 20 15 9 C17 4 19 12 21 8',
  blurb: 'Flow fields, sine weaves and spiral portraits — expressive line systems, all vector.',
  output: 'svg',
  params: [
    P.group('System'),
    P.select('mode', 'Line system', MODES, 'flow'),
    P.range('density', 'Line density', 10, 1200, 5, 260, { hint: 'Number of lines / seeds across the canvas.' }),
    P.range('stepLength', 'Step length', 0.5, 12, 0.1, 2.2, { unit: 'px', showIf: (v) => v.mode === 'flow' }),
    P.range('maxSteps', 'Line length', 10, 800, 5, 160, { showIf: (v) => v.mode === 'flow' }),
    P.range('curl', 'Curl', -1.5, 1.5, 0.02, 0, { showIf: (v) => v.mode === 'flow' }),
    P.range('align', 'Follow image', 0, 1, 0.02, 0.9, { showIf: (v) => v.mode === 'flow', hint: '0 = straight lines, 1 = fully guided by image contours.' }),
    P.range('smoothField', 'Field smoothing', 1, 40, 1, 9, { showIf: (v) => v.mode === 'flow', hint: 'Larger values give long, calm strokes; small values follow fine detail.' }),
    P.range('amplitude', 'Wave amplitude', 0, 40, 0.5, 9, { unit: 'px', showIf: (v) => v.mode !== 'flow' }),
    P.range('frequency', 'Wave frequency', 0.2, 12, 0.1, 3, { showIf: (v) => v.mode !== 'flow' }),
    P.range('angle', 'Direction', 0, 180, 1, 0, { unit: '°', showIf: (v) => v.mode === 'waves' || v.mode === 'weave' || v.mode === 'flow' }),
    P.range('turns', 'Spiral turns', 5, 220, 1, 60, { showIf: (v) => v.mode === 'spiral' }),
    P.seed('seed', 'Seed', 9),
    P.group('Weight'),
    P.range('minWidth', 'Min width', 0.05, 6, 0.05, 0.25, { unit: 'px' }),
    P.range('maxWidth', 'Max width', 0.2, 24, 0.1, 3.2, { unit: 'px' }),
    P.range('gamma', 'Tone curve', 0.3, 3, 0.05, 1.1),
    P.toggle('invert', 'Invert tone', false),
    P.toggle('skipLight', 'Drop empty areas', true),
    P.range('preBlur', 'Smooth input', 0, 12, 0.5, 1.5),
    P.group('Colour'),
    P.select('colorMode', 'Colour', ['ink', 'image'], 'ink'),
    P.color('inkColor', 'Ink', '#101319', { showIf: (v) => v.colorMode === 'ink' }),
    P.range('opacity', 'Opacity', 0.05, 1, 0.02, 1),
    P.toggle('background', 'Fill background', true),
    P.color('bgColor', 'Paper', '#f7f4ec'),
  ],
  presets: [
    { name: 'Flow field portrait', values: { mode: 'flow', density: 420, maxSteps: 240, align: 1, smoothField: 12, maxWidth: 2.2, stepLength: 1.8 } },
    { name: 'Wind sketch', values: { mode: 'flow', density: 700, maxSteps: 90, align: 0.75, smoothField: 22, maxWidth: 1.4, minWidth: 0.1 } },
    { name: 'Sine weave', values: { mode: 'waves', density: 110, amplitude: 7, frequency: 4, maxWidth: 3 } },
    { name: 'Spiral portrait', values: { mode: 'spiral', turns: 90, maxWidth: 5.5, minWidth: 0.1, amplitude: 0 } },
    { name: 'Topographic rings', values: { mode: 'concentric', density: 80, amplitude: 12, frequency: 2 } },
    { name: 'Sunburst', values: { mode: 'radial', density: 220, amplitude: 10, frequency: 5 } },
    { name: 'Woven grid', values: { mode: 'weave', density: 70, amplitude: 5, frequency: 3, colorMode: 'image' } },
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
      const xi = clamp(Math.round(x), 0, w - 1), yi = clamp(Math.round(y), 0, h - 1);
      return dark[yi * w + xi];
    };
    const widthAt = (x, y) => {
      const t = clamp(toneAt(x, y), 0, 1);
      return (p.minWidth + (p.maxWidth - p.minWidth) * t) * k;
    };
    const colorAt = (x, y) => (p.colorMode === 'image'
      ? rgbCss(averageRegion(src, x - 1, y - 1, x + 1, y + 1))
      : p.inkColor);

    const parts = [];
    let lineCount = 0, pointCount = 0;

    /** Emit a polyline as a tapered ribbon, splitting where tone drops to nothing. */
    const emit = (pts) => {
      if (pts.length < 2) return;
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          const simple = simplify(run, 0.35);
          const widths = simple.map(([x, y]) => widthAt(x, y));
          const poly = ribbon(simple.map(([x, y]) => [x * kx, y * ky]), widths);
          if (poly.length >= 4) {
            const mid = simple[Math.floor(simple.length / 2)];
            parts.push(polygonEl(poly, { fill: colorAt(mid[0], mid[1]) }));
            lineCount++;
            pointCount += simple.length;
          }
        }
        run = [];
      };
      for (const pt of pts) {
        const inside = pt[0] >= 0 && pt[1] >= 0 && pt[0] < w && pt[1] < h;
        const t = inside ? toneAt(pt[0], pt[1]) : 0;
        if (!inside || (p.skipLight && t < 0.035)) flush();
        else run.push(pt);
      }
      flush();
    };

    if (p.mode === 'flow') {
      // Structure-tensor orientation field: smoothing the gradient as a
      // double-angle vector avoids the 0/180° wrap, so the field stays
      // coherent across flat areas instead of collapsing to horizontal.
      const lum = boxBlurPlane(lumaMap(src), w, h, 2, 2);
      const { dir, mag } = sobel(lum, w, h);
      const cx2 = new Float32Array(w * h);
      const sy2 = new Float32Array(w * h);
      for (let i = 0; i < mag.length; i++) {
        const m = mag[i];
        cx2[i] = Math.cos(2 * dir[i]) * m;
        sy2[i] = Math.sin(2 * dir[i]) * m;
      }
      const cxs = boxBlurPlane(cx2, w, h, Math.max(2, p.smoothField), 2);
      const sys = boxBlurPlane(sy2, w, h, Math.max(2, p.smoothField), 2);
      const field = new Float32Array(w * h);
      for (let i = 0; i < field.length; i++) {
        field[i] = 0.5 * Math.atan2(sys[i], cxs[i]) + Math.PI / 2 + p.curl;
      }
      const baseAngle = deg(p.angle || 0);
      const angleAt = (x, y) => {
        const xi = clamp(Math.round(x), 0, w - 1), yi = clamp(Math.round(y), 0, h - 1);
        const a = field[yi * w + xi];
        if (p.align >= 1) return a;
        // Blend two directions through their unit vectors so the mix is smooth.
        const dx = Math.cos(baseAngle) * (1 - p.align) + Math.cos(a) * p.align;
        const dy = Math.sin(baseAngle) * (1 - p.align) + Math.sin(a) * p.align;
        return Math.atan2(dy, dx);
      };

      const seeds = Math.round(p.density);
      const cols = Math.max(1, Math.round(Math.sqrt(seeds * (w / h))));
      const rows = Math.max(1, Math.ceil(seeds / cols));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const sxp = ((c + 0.5 + (rnd() - 0.5) * 0.8) / cols) * w;
          const syp = ((r + 0.5 + (rnd() - 0.5) * 0.8) / rows) * h;
          const back = [];
          let x = sxp, y = syp;
          for (let s = 0; s < p.maxSteps / 2; s++) {
            const a = angleAt(x, y);
            x -= Math.cos(a) * p.stepLength;
            y -= Math.sin(a) * p.stepLength;
            if (x < -2 || y < -2 || x > w + 2 || y > h + 2) break;
            back.push([x, y]);
          }
          back.reverse();
          const fwd = [];
          x = sxp; y = syp;
          for (let s = 0; s < p.maxSteps / 2; s++) {
            const a = angleAt(x, y);
            x += Math.cos(a) * p.stepLength;
            y += Math.sin(a) * p.stepLength;
            if (x < -2 || y < -2 || x > w + 2 || y > h + 2) break;
            fwd.push([x, y]);
          }
          emit([...back, [sxp, syp], ...fwd]);
        }
      }
    } else if (p.mode === 'waves' || p.mode === 'weave') {
      const a = deg(p.angle);
      const ca = Math.cos(a), sa = Math.sin(a);
      const diag = Math.hypot(w, h);
      const lines = Math.round(p.density);
      const spacing = diag / lines;
      const step = Math.max(0.8, spacing / 6);
      const passes = p.mode === 'weave' ? [0, 90] : [0];
      for (const extra of passes) {
        const aa = a + deg(extra);
        const cA = Math.cos(aa), sA = Math.sin(aa);
        for (let i = -lines; i <= lines; i++) {
          const off = i * spacing;
          const pts = [];
          for (let t = -diag / 2; t <= diag / 2; t += step) {
            let x = w / 2 + t * cA - off * sA;
            let y = h / 2 + t * sA + off * cA;
            const tone = (x >= 0 && y >= 0 && x < w && y < h) ? toneAt(x, y) : 0;
            const disp = Math.sin((t / spacing) * p.frequency) * p.amplitude * tone;
            x += -sA * disp;
            y += cA * disp;
            pts.push([x, y]);
          }
          emit(pts);
        }
      }
    } else if (p.mode === 'spiral') {
      const cx = w / 2, cy = h / 2;
      const maxR = Math.hypot(w, h) / 2;
      const turns = p.turns;
      const totalAngle = turns * TAU;
      const step = Math.max(0.004, 1 / (maxR * 0.6));
      const pts = [];
      for (let a = 0; a < totalAngle; a += step) {
        const r = (a / totalAngle) * maxR;
        const x0 = cx + Math.cos(a) * r;
        const y0 = cy + Math.sin(a) * r;
        const tone = (x0 >= 0 && y0 >= 0 && x0 < w && y0 < h) ? toneAt(x0, y0) : 0;
        const disp = Math.sin(a * p.frequency * 4) * p.amplitude * tone;
        pts.push([x0 + Math.cos(a) * disp, y0 + Math.sin(a) * disp]);
      }
      emit(pts);
    } else if (p.mode === 'concentric') {
      const cx = w / 2, cy = h / 2;
      const maxR = Math.hypot(w, h) / 2;
      const rings = Math.round(p.density);
      for (let i = 1; i <= rings; i++) {
        const R = (i / rings) * maxR;
        const step = Math.max(0.01, 1.6 / R);
        const pts = [];
        for (let a = 0; a <= TAU + step; a += step) {
          const x0 = cx + Math.cos(a) * R, y0 = cy + Math.sin(a) * R;
          const tone = (x0 >= 0 && y0 >= 0 && x0 < w && y0 < h) ? toneAt(x0, y0) : 0;
          const disp = Math.sin(a * p.frequency * 6) * p.amplitude * tone;
          pts.push([cx + Math.cos(a) * (R + disp), cy + Math.sin(a) * (R + disp)]);
        }
        emit(pts);
      }
    } else if (p.mode === 'radial') {
      const cx = w / 2, cy = h / 2;
      const maxR = Math.hypot(w, h) / 2;
      const rays = Math.round(p.density);
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU;
        const pts = [];
        for (let r = 2; r < maxR; r += 1.4) {
          const x0 = cx + Math.cos(a) * r, y0 = cy + Math.sin(a) * r;
          const tone = (x0 >= 0 && y0 >= 0 && x0 < w && y0 < h) ? toneAt(x0, y0) : 0;
          const disp = Math.sin(r / maxR * p.frequency * TAU) * p.amplitude * tone;
          pts.push([x0 - Math.sin(a) * disp, y0 + Math.cos(a) * disp]);
        }
        emit(pts);
      }
    }

    const svg = svgDoc({
      width: ctx.srcWidth, height: ctx.srcHeight,
      bg: p.background ? p.bgColor : null,
      body: [group({ 'data-bix-layer': 'lines', opacity: p.opacity < 1 ? p.opacity : null }, parts)],
      meta: { transform: 'Flow & Line Art' },
    });
    return { type: 'svg', svg, stats: { strokes: lineCount, points: pointCount } };
  },
};
