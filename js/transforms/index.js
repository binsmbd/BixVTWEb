/* Transform registry — the tool palette of Bix Transform. */
import vectorColor from './vector-color.js';
import vectorMono from './vector-mono.js';
import centerline from './centerline.js';
import pixelArt from './pixel-art.js';
import halftone from './halftone.js';
import ascii from './ascii.js';
import lowpoly from './lowpoly.js';
import mosaic from './mosaic.js';
import stipple from './stipple.js';
import flowlines from './flowlines.js';
import crosshatch from './crosshatch.js';
import contour from './contour.js';
import poster from './poster.js';
import paint from './paint.js';
import edges from './edges.js';
import glitch from './glitch.js';

export const TRANSFORMS = [
  vectorColor, vectorMono, centerline,
  pixelArt, halftone, ascii,
  lowpoly, mosaic, stipple,
  flowlines, crosshatch, contour,
  poster, paint, edges, glitch,
];

export const GROUPS = ['Vector', 'Pixel', 'Print', 'Geometric', 'Line', 'Tone', 'Artistic'];

export const byId = (id) => TRANSFORMS.find((t) => t.id === id) || TRANSFORMS[0];

export function grouped() {
  const map = new Map();
  for (const g of GROUPS) map.set(g, []);
  for (const t of TRANSFORMS) {
    if (!map.has(t.group)) map.set(t.group, []);
    map.get(t.group).push(t);
  }
  return [...map.entries()].filter(([, list]) => list.length);
}
