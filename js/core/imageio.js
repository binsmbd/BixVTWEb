/* Image loading, working-size preparation and built-in procedural samples. */
import { clamp, mulberry32, TAU } from './util.js';

export const MAX_SOURCE_EDGE = 3000;

function toImageData(source, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

async function bitmapFromBlob(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}

export async function loadImageFile(file) {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    return loadSvgFile(file);
  }
  const bmp = await bitmapFromBlob(file);
  let w = bmp.width, h = bmp.height;
  const long = Math.max(w, h);
  if (long > MAX_SOURCE_EDGE) {
    const k = MAX_SOURCE_EDGE / long;
    w = Math.round(w * k); h = Math.round(h * k);
  }
  return {
    imageData: toImageData(bmp, w, h),
    width: w, height: h,
    name: file.name.replace(/\.[^.]+$/, '') || 'image',
  };
}

/** SVG input is rasterised at a generous size so it can be re-vectorised cleanly. */
async function loadSvgFile(file) {
  const text = await file.text();
  const blob = new Blob([text], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const long = Math.max(img.width || 1024, img.height || 1024);
  const k = Math.min(2000 / long, 4);
  const w = Math.max(1, Math.round((img.width || 1024) * k));
  const h = Math.max(1, Math.round((img.height || 1024) * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  return { imageData: ctx.getImageData(0, 0, w, h), width: w, height: h, name: file.name.replace(/\.[^.]+$/, '') };
}

export async function loadImageUrl(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
  const blob = await res.blob();
  const name = (url.split('/').pop() || 'image').split('?')[0].replace(/\.[^.]+$/, '');
  return loadImageFile(new File([blob], name + '.png', { type: blob.type || 'image/png' }));
}

export function imageDataToCanvas(imageData) {
  const cv = document.createElement('canvas');
  cv.width = imageData.width; cv.height = imageData.height;
  cv.getContext('2d').putImageData(imageData, 0, 0);
  return cv;
}

/* ------------------------------------------------------------------ *
 * Built-in sample images — drawn procedurally so the app is fully
 * self-contained and works with no network and no user file.
 * ------------------------------------------------------------------ */

function canvasOf(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d', { willReadFrequently: true })];
}

function grain(ctx, w, h, amount, seed = 5) {
  const rnd = mulberry32(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (rnd() - 0.5) * amount;
    d[i] = clamp(d[i] + g, 0, 255);
    d[i + 1] = clamp(d[i + 1] + g, 0, 255);
    d[i + 2] = clamp(d[i + 2] + g, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

const SAMPLE_BUILDERS = {
  'Studio portrait': () => {
    const w = 900, h = 1200;
    const [cv, ctx] = canvasOf(w, h);
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#2b3a55'); bg.addColorStop(0.55, '#4a5d7e'); bg.addColorStop(1, '#111722');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    // rim light
    const rim = ctx.createRadialGradient(w * 0.72, h * 0.28, 20, w * 0.72, h * 0.28, w * 0.9);
    rim.addColorStop(0, 'rgba(255,214,170,0.85)'); rim.addColorStop(1, 'rgba(255,214,170,0)');
    ctx.fillStyle = rim; ctx.fillRect(0, 0, w, h);

    // shoulders
    ctx.fillStyle = '#1b2233';
    ctx.beginPath();
    ctx.moveTo(w * 0.08, h);
    ctx.bezierCurveTo(w * 0.16, h * 0.72, w * 0.84, h * 0.72, w * 0.94, h);
    ctx.closePath(); ctx.fill();

    // neck + head
    ctx.fillStyle = '#d9a882';
    ctx.fillRect(w * 0.41, h * 0.52, w * 0.18, h * 0.16);
    const face = ctx.createLinearGradient(w * 0.3, h * 0.15, w * 0.7, h * 0.62);
    face.addColorStop(0, '#f0c6a0'); face.addColorStop(0.6, '#dda57e'); face.addColorStop(1, '#a86f4e');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.36, w * 0.17, h * 0.19, 0, 0, TAU);
    ctx.fill();

    // hair
    ctx.fillStyle = '#221a20';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.28, w * 0.2, h * 0.15, 0, Math.PI, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.33, w * 0.195, h * 0.175, 0, Math.PI * 1.05, TAU * 0.98);
    ctx.fill();

    // eyes
    for (const sx of [-1, 1]) {
      ctx.fillStyle = '#fdfbf7';
      ctx.beginPath();
      ctx.ellipse(w * (0.5 + sx * 0.068), h * 0.355, w * 0.035, h * 0.016, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2c1d17';
      ctx.beginPath();
      ctx.arc(w * (0.5 + sx * 0.068), h * 0.356, w * 0.016, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#241a18'; ctx.lineWidth = w * 0.008;
      ctx.beginPath();
      ctx.arc(w * (0.5 + sx * 0.068), h * 0.335, w * 0.05, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
    // nose + mouth
    ctx.strokeStyle = 'rgba(120,72,48,0.55)'; ctx.lineWidth = w * 0.007; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.365); ctx.quadraticCurveTo(w * 0.515, h * 0.41, w * 0.492, h * 0.418);
    ctx.stroke();
    ctx.fillStyle = '#b4544f';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.452, w * 0.045, h * 0.014, 0, 0, TAU);
    ctx.fill();
    grain(ctx, w, h, 10, 3);
    return cv;
  },

  'Mountain light': () => {
    const w = 1400, h = 900;
    const [cv, ctx] = canvasOf(w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, '#0b1d3a'); sky.addColorStop(0.45, '#4b5f92');
    sky.addColorStop(0.75, '#e98a5b'); sky.addColorStop(1, '#ffd9a0');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#fff3d6';
    ctx.beginPath(); ctx.arc(w * 0.68, h * 0.52, w * 0.055, 0, TAU); ctx.fill();
    const glow = ctx.createRadialGradient(w * 0.68, h * 0.52, 10, w * 0.68, h * 0.52, w * 0.3);
    glow.addColorStop(0, 'rgba(255,220,160,0.6)'); glow.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);

    const ranges = [
      { y: 0.62, color: '#5d6b8c', amp: 0.10, seed: 1 },
      { y: 0.72, color: '#3c4763', amp: 0.13, seed: 2 },
      { y: 0.83, color: '#232c40', amp: 0.09, seed: 3 },
    ];
    for (const r of ranges) {
      const rnd = mulberry32(r.seed * 99);
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      let y = h * r.y;
      ctx.lineTo(0, y);
      for (let x = 0; x <= w; x += w / 14) {
        y = h * r.y - Math.abs(Math.sin(x / w * 6 + r.seed)) * h * r.amp * (0.6 + rnd() * 0.8);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    }
    // lake reflection
    const lake = ctx.createLinearGradient(0, h * 0.83, 0, h);
    lake.addColorStop(0, '#1b2436'); lake.addColorStop(1, '#0c1119');
    ctx.fillStyle = lake; ctx.fillRect(0, h * 0.83, w, h * 0.17);
    ctx.strokeStyle = 'rgba(255,210,160,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const yy = h * 0.84 + i * (h * 0.16 / 26);
      ctx.beginPath();
      ctx.moveTo(w * 0.6 - i * 3, yy); ctx.lineTo(w * 0.76 + i * 3, yy); ctx.stroke();
    }
    grain(ctx, w, h, 8, 9);
    return cv;
  },

  'Bix mark': () => {
    const w = 1000, h = 1000;
    const [cv, ctx] = canvasOf(w, h);
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0d0f14'); bg.addColorStop(1, '#1b2430');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const ring = ctx.createLinearGradient(0, h, w, 0);
    ring.addColorStop(0, '#ee6c4d'); ring.addColorStop(0.5, '#f4a261'); ring.addColorStop(1, '#98c1d9');
    ctx.strokeStyle = ring; ctx.lineWidth = 26;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.34, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#e0fbfc';
    ctx.font = `700 ${w * 0.3}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Bix', w / 2, h / 2 + w * 0.01);
    ctx.strokeStyle = 'rgba(224,251,252,0.25)'; ctx.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * (0.36 + i * 0.018), 0.2 + i * 0.3, 1.1 + i * 0.3);
      ctx.stroke();
    }
    return cv;
  },

  'Colour swatch': () => {
    const w = 1200, h = 800;
    const [cv, ctx] = canvasOf(w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    ['#ff006e', '#fb5607', '#ffbe0b', '#8ac926', '#3a86ff', '#8338ec'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'overlay';
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.arc((i / 8) * w, h * (0.3 + 0.4 * Math.sin(i)), w * 0.12, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(10,10,14,0.85)';
    ctx.font = `800 ${w * 0.09}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('TRANSFORM', w / 2, h * 0.58);
    return cv;
  },
};

export const SAMPLE_NAMES = Object.keys(SAMPLE_BUILDERS);

export function loadSample(name) {
  const build = SAMPLE_BUILDERS[name] || SAMPLE_BUILDERS[SAMPLE_NAMES[0]];
  const cv = build();
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  return {
    imageData: ctx.getImageData(0, 0, cv.width, cv.height),
    width: cv.width, height: cv.height,
    name: name.toLowerCase().replace(/\s+/g, '-'),
  };
}
