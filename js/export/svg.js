/* SVG document assembly. Every vector transform emits through these helpers so
   exported files stay consistent, tidy and editable in Illustrator / Figma. */
import { n } from '../core/util.js';

export function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

export function rgbCss(c) {
  return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
}

/**
 * @param {object} o
 * @param {number} o.width  document width in px
 * @param {number} o.height document height in px
 * @param {string|null} o.bg background colour (null = transparent)
 * @param {string[]} o.body raw SVG markup chunks
 */
export function svgDoc({ width, height, bg = null, body = [], defs = [], title = 'Bix Transform', meta = {} }) {
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
    + `width="${n(width, 1)}" height="${n(height, 1)}" viewBox="0 0 ${n(width, 1)} ${n(height, 1)}" `
    + `shape-rendering="geometricPrecision">`);
  parts.push(`<title>${escapeXml(title)}</title>`);
  parts.push(`<desc>${escapeXml(`Generated with Bix Transform — ${meta.transform || ''}`)}</desc>`);
  if (defs.length) parts.push(`<defs>${defs.join('')}</defs>`);
  if (bg) parts.push(`<rect width="100%" height="100%" fill="${bg}"/>`);
  parts.push(...body);
  parts.push('</svg>');
  return parts.join('\n');
}

export function group(attrs, children) {
  const a = Object.entries(attrs)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<g ${a}>${Array.isArray(children) ? children.join('') : children}</g>`;
}

export function pathEl(d, attrs = {}) {
  const a = Object.entries(attrs)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<path d="${d}" ${a}/>`;
}

export function circleEl(cx, cy, r, attrs = {}) {
  const a = Object.entries(attrs).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${a}/>`;
}

export function polygonEl(points, attrs = {}) {
  const pts = points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
  const a = Object.entries(attrs).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<polygon points="${pts}" ${a}/>`;
}

export function lineEl(x1, y1, x2, y2, attrs = {}) {
  const a = Object.entries(attrs).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${a}/>`;
}

export function rectEl(x, y, w, h, attrs = {}) {
  const a = Object.entries(attrs).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${a}/>`;
}

export function textEl(x, y, str, attrs = {}) {
  const a = Object.entries(attrs).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<text x="${n(x)}" y="${n(y)}" ${a}>${escapeXml(str)}</text>`;
}

/** Rough count of drawable nodes, shown in the status bar. */
export function countNodes(svg) {
  const m = svg.match(/<(path|circle|polygon|line|rect|text|polyline|ellipse)\b/g);
  return m ? m.length : 0;
}
