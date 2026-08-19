/* The render pipeline: source → working size → adjustments → transform. */
import { applyAdjustments } from '../image/adjust.js';
import { fitToLongEdge } from '../transforms/_shared.js';
import { byId } from '../transforms/index.js';
import { raf } from './util.js';

/** Working resolution caps — preview stays interactive, full export goes big. */
export const WORKING = { preview: 1100, full: 2200 };

let generation = 0;

/**
 * Composite semi-transparent pixels toward paper white while keeping the alpha
 * channel intact. Without this, a transparent PNG traces its empty regions as
 * solid black (RGB 0,0,0); transforms that care about emptiness still read the
 * untouched alpha.
 */
function matteTransparent(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    const t = a / 255;
    d[i] = d[i] * t + 255 * (1 - t);
    d[i + 1] = d[i + 1] * t + 255 * (1 - t);
    d[i + 2] = d[i + 2] * t + 255 * (1 - t);
  }
}

/**
 * Run the full pipeline for the given state.
 * Stale runs are discarded via a generation token so rapid slider drags never
 * paint an out-of-date result.
 */
export async function render(state, { quality = 'preview' } = {}) {
  const token = ++generation;
  const src = state.source;
  if (!src) return null;

  await raf(); // let the UI paint its busy state first

  const t0 = performance.now();
  const maxEdge = WORKING[quality] || WORKING.preview;
  const { img: sized } = fitToLongEdge(src.imageData, maxEdge);
  matteTransparent(sized);
  if (token !== generation) return null;

  const adjusted = applyAdjustments(sized, state.adjust);
  if (token !== generation) return null;

  const tool = byId(state.toolId);
  const params = { ...state.params[state.toolId] };

  const ctx = {
    img: adjusted,
    width: adjusted.width,
    height: adjusted.height,
    srcWidth: src.width,
    srcHeight: src.height,
    params,
    quality,
  };

  const result = tool.run(ctx);
  if (token !== generation) return null;

  result.tool = tool.id;
  result.toolLabel = tool.label;
  result.ms = Math.round(performance.now() - t0);
  result.docWidth = src.width;
  result.docHeight = src.height;
  return result;
}

export function isStale(token) { return token !== generation; }
