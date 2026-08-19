/* ASCII / text-mosaic renderer — exports as SVG text, raster, or plain .txt. */
import { P } from './_shared.js';
import { svgDoc, group, escapeXml, rgbCss } from '../export/svg.js';
import { clamp, n } from '../core/util.js';
import { luma } from '../image/color.js';
import { averageRegion } from '../image/filters.js';

const RAMPS = {
  'classic': '@%#*+=-:. ',
  'detailed': "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
  'blocks': '█▓▒░ ',
  'minimal': '#+-. ',
  'binary': '10 ',
  'dots': '⣿⣷⣯⣟⡿⢿⣻⣽⣾⠿⠛⠉ ',
  'shades': '██▓▓▒▒░░  ',
  'stars': '★✦✧✩·  ',
  'code': '{}[]()<>/\\|!;:. ',
  'bix': 'BIXbix/\\|-. ',
};

export default {
  id: 'ascii',
  label: 'ASCII Mosaic',
  group: 'Print',
  icon: 'M4 7h4M4 12h9M4 17h6M15 7h5M16 12h4M13 17h7',
  blurb: 'Character-grid rendering with real text output you can paste anywhere.',
  output: 'svg',
  params: [
    P.group('Grid'),
    P.range('columns', 'Columns', 20, 400, 1, 110),
    P.range('aspect', 'Cell aspect', 1, 3, 0.05, 2, { hint: 'Character height ÷ width — 2 suits most monospace fonts.' }),
    P.select('ramp', 'Character ramp', Object.keys(RAMPS).concat('custom'), 'classic'),
    P.text('customRamp', 'Custom ramp', '@#S%?*+;:,.', { showIf: (v) => v.ramp === 'custom' }),
    P.toggle('invert', 'Invert tone', false),
    P.range('contrast', 'Contrast', -100, 100, 1, 15),
    P.group('Type'),
    P.select('colorMode', 'Colour', ['ink', 'image', 'gradient-tone'], 'ink'),
    P.color('inkColor', 'Ink', '#e7f0ff', { showIf: (v) => v.colorMode === 'ink' }),
    P.range('fontScale', 'Glyph size', 0.5, 1.6, 0.02, 1.02),
    P.range('weight', 'Font weight', 200, 900, 100, 500),
    P.text('fontFamily', 'Font stack', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'),
    P.toggle('background', 'Fill background', true),
    P.color('bgColor', 'Background', '#0b0d12'),
  ],
  presets: [
    { name: 'Terminal', values: { ramp: 'classic', colorMode: 'ink', inkColor: '#8bffb0', bgColor: '#05070a', columns: 120 } },
    { name: 'Newspaper', values: { ramp: 'detailed', colorMode: 'ink', inkColor: '#14161c', bgColor: '#f6f2e9', columns: 160 } },
    { name: 'Block mosaic', values: { ramp: 'blocks', colorMode: 'image', columns: 90, bgColor: '#0b0d12' } },
    { name: 'Matrix', values: { ramp: 'binary', colorMode: 'ink', inkColor: '#31ff7a', bgColor: '#000000', columns: 150 } },
    { name: 'Colour type', values: { ramp: 'shades', colorMode: 'image', columns: 130 } },
  ],

  run(ctx) {
    const p = ctx.params;
    const img = ctx.img;
    const ramp = (p.ramp === 'custom' ? (p.customRamp || '@#. ') : RAMPS[p.ramp]) || RAMPS.classic;
    const chars = [...ramp];
    const cols = Math.max(4, Math.round(p.columns));
    const cellW = img.width / cols;
    const cellH = cellW * p.aspect;
    const rows = Math.max(1, Math.floor(img.height / cellH));

    const W = ctx.srcWidth, H = ctx.srcHeight;
    const outCellW = W / cols;
    const outCellH = H / rows;
    const fontSize = outCellH * p.fontScale;

    const k = 1 + p.contrast / 100 * 1.6;
    const lines = [];
    const spans = [];

    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let c = 0; c < cols; c++) {
        const col = averageRegion(img, c * cellW, r * cellH, (c + 1) * cellW, (r + 1) * cellH);
        let t = luma(col[0], col[1], col[2]) / 255;
        t = clamp((t - 0.5) * k + 0.5, 0, 1);
        const alpha = col[3] / 255;
        t = t * alpha + (1 - alpha);           // transparent = paper
        const idx = clamp(Math.round((p.invert ? t : 1 - t) * (chars.length - 1)), 0, chars.length - 1);
        const ch = chars[chars.length - 1 - idx];
        line += ch;
        if (ch.trim() === '') continue;
        let fill = p.inkColor;
        if (p.colorMode === 'image') fill = rgbCss(col);
        else if (p.colorMode === 'gradient-tone') {
          const v = 255 * (1 - t);
          fill = rgbCss([v, v * 0.85 + 30, 255 - v * 0.4]);
        }
        spans.push({ x: (c + 0.5) * outCellW, y: (r + 0.86) * outCellH, ch, fill });
      }
      lines.push(line);
    }

    // Group runs of identical colour into single <text> nodes to keep SVG light.
    const byFill = new Map();
    for (const s of spans) {
      if (!byFill.has(s.fill)) byFill.set(s.fill, []);
      byFill.get(s.fill).push(s);
    }
    const body = [];
    for (const [fill, items] of byFill) {
      const glyphs = items.map((s) => `<tspan x="${n(s.x)}" y="${n(s.y)}">${escapeXml(s.ch)}</tspan>`).join('');
      body.push(`<text fill="${fill}" font-family="${escapeXml(p.fontFamily)}" font-size="${n(fontSize)}" `
        + `font-weight="${p.weight}" text-anchor="middle" xml:space="preserve">${glyphs}</text>`);
    }

    const svg = svgDoc({
      width: W, height: H,
      bg: p.background ? p.bgColor : null,
      body: [group({ 'data-bix-layer': 'ascii' }, body)],
      meta: { transform: 'ASCII Mosaic' },
    });

    return {
      type: 'svg',
      svg,
      text: lines.join('\n'),
      stats: { grid: `${cols}×${rows}`, glyphs: spans.length },
    };
  },
};
