/* Rasterisation + file encoding for every export path. */
import { imageDataToCanvas } from '../core/imageio.js';

/** Render an SVG string into a canvas at an arbitrary pixel size. */
export function svgToCanvas(svg, width, height) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(width));
      cv.height = Math.max(1, Math.round(height));
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG could not be rasterised')); };
    img.src = url;
  });
}

/** Turn a pipeline result into a canvas at the requested scale. */
export async function resultToCanvas(result, { scale = 1, background = null } = {}) {
  const w = Math.max(1, Math.round(result.docWidth * scale));
  const h = Math.max(1, Math.round(result.docHeight * scale));
  let canvas;
  if (result.type === 'svg') {
    canvas = await svgToCanvas(result.svg, w, h);
  } else {
    const srcCanvas = imageDataToCanvas(result.imageData);
    canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = !result.pixelated;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, 0, 0, w, h);
  }
  if (background) {
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0);
    return out;
  }
  return canvas;
}

export function canvasToBlob(canvas, mime = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), mime, quality);
  });
}

/** Palette export in GIMP .gpl format — handy for pixel-art workflows. */
export function paletteToGpl(palette, name = 'Bix palette') {
  const lines = ['GIMP Palette', `Name: ${name}`, 'Columns: 8', '#'];
  for (const c of palette) {
    const r = Math.round(c[0]), g = Math.round(c[1]), b = Math.round(c[2]);
    lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  }
  return lines.join('\n');
}

export function paletteToJson(palette) {
  return JSON.stringify({
    generator: 'Bix Transform',
    colors: palette.map((c) => ({
      rgb: c.map((v) => Math.round(v)),
      hex: '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''),
    })),
  }, null, 2);
}
