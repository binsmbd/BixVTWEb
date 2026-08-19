/* Canvas viewport: zoom, pan, checkerboard and before/after comparison. */
import { clamp } from '../core/util.js';
import { imageDataToCanvas } from '../core/imageio.js';
import { svgToCanvas } from '../export/raster.js';

export class Viewport {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.sourceCanvas = null;
    this.resultCanvas = null;
    this.dragging = false;
    this.last = [0, 0];
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const v = this.store.state.view;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const zoom = clamp(v.zoom * factor, 0.02, 40);
      // zoom about the pointer
      const k = zoom / v.zoom;
      this.store.setView({
        zoom,
        panX: mx - (mx - v.panX) * k,
        panY: my - (my - v.panY) * k,
        fit: false,
      });
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      if (this.store.state.view.compare === 'split' && e.shiftKey) return;
      this.dragging = true;
      this.last = [e.clientX, e.clientY];
      c.setPointerCapture(e.pointerId);
      c.classList.add('grabbing');
    });
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      if (this.store.state.view.compare === 'split' && (e.buttons & 1) && e.shiftKey) {
        this.store.setView({ split: clamp((e.clientX - rect.left) / rect.width, 0, 1) });
        return;
      }
      if (!this.dragging) return;
      const v = this.store.state.view;
      this.store.setView({
        panX: v.panX + (e.clientX - this.last[0]),
        panY: v.panY + (e.clientY - this.last[1]),
        fit: false,
      });
      this.last = [e.clientX, e.clientY];
    });
    const end = () => { this.dragging = false; c.classList.remove('grabbing'); };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', () => this.fit());

    new ResizeObserver(() => this.resize()).observe(c.parentElement);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth, h = parent.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    if (this.store.state.view.fit) this.fit(); else this.draw();
  }

  setSource(source) {
    this.sourceCanvas = source ? imageDataToCanvas(source.imageData) : null;
    this.fit();
  }

  async setResult(result) {
    if (!result) { this.resultCanvas = null; this.draw(); return; }
    const w = result.docWidth, h = result.docHeight;
    // Cap the display raster so huge documents stay responsive.
    const long = Math.max(w, h);
    const k = long > 2400 ? 2400 / long : 1;
    if (result.type === 'svg') {
      try {
        this.resultCanvas = await svgToCanvas(result.svg, w * k, h * k);
      } catch {
        this.resultCanvas = null;
      }
    } else {
      this.resultCanvas = imageDataToCanvas(result.imageData);
    }
    this.pixelated = !!result.pixelated;
    this.draw();
  }

  /** Document size in CSS pixels. */
  docSize() {
    const s = this.store.state.source;
    return s ? [s.width, s.height] : [1, 1];
  }

  fit() {
    const [dw, dh] = this.docSize();
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    const pad = 48;
    const zoom = Math.min((w - pad) / dw, (h - pad) / dh);
    this.store.setView({
      zoom: clamp(zoom, 0.02, 40),
      panX: (w - dw * zoom) / 2,
      panY: (h - dh * zoom) / 2,
      fit: true,
    });
  }

  zoomTo(zoom) {
    const [dw, dh] = this.docSize();
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    this.store.setView({
      zoom, panX: (w - dw * zoom) / 2, panY: (h - dh * zoom) / 2, fit: false,
    });
  }

  drawChecker(ctx, x, y, w, h) {
    const size = 12;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#1b1e26';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#22262f';
    for (let yy = Math.floor(y / size) * size; yy < y + h; yy += size) {
      for (let xx = Math.floor(x / size) * size; xx < x + w; xx += size) {
        if (((xx / size) + (yy / size)) % 2 === 0) ctx.fillRect(xx, yy, size, size);
      }
    }
    ctx.restore();
  }

  draw() {
    const ctx = this.ctx;
    const v = this.store.state.view;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.scale(this.dpr, this.dpr);
    const vw = W / this.dpr, vh = H / this.dpr;

    if (!this.sourceCanvas) return;
    const [dw, dh] = this.docSize();
    const x = v.panX, y = v.panY, w = dw * v.zoom, h = dh * v.zoom;

    if (v.checker) this.drawChecker(ctx, x, y, w, h);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.001)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    const mode = v.compare;
    ctx.imageSmoothingEnabled = !(this.pixelated && v.zoom > 1.2);
    ctx.imageSmoothingQuality = 'high';

    const drawSource = (cx, cy, cw, ch) => {
      ctx.save(); ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip();
      ctx.drawImage(this.sourceCanvas, x, y, w, h);
      ctx.restore();
    };
    const drawResult = (cx, cy, cw, ch) => {
      if (!this.resultCanvas) return;
      ctx.save(); ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip();
      ctx.drawImage(this.resultCanvas, x, y, w, h);
      ctx.restore();
    };

    if (mode === 'source' || !this.resultCanvas) {
      drawSource(x, y, w, h);
    } else if (mode === 'split') {
      const sx = x + w * v.split;
      drawSource(x, y, Math.max(0, sx - x), h);
      drawResult(sx, y, Math.max(0, x + w - sx), h);
      ctx.save();
      ctx.strokeStyle = '#ee6c4d';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, y + h); ctx.stroke();
      ctx.fillStyle = '#ee6c4d';
      ctx.beginPath(); ctx.arc(sx, y + h / 2, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0d0f14';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('↔', sx, y + h / 2 + 0.5);
      ctx.restore();
    } else if (mode === 'side') {
      const half = w / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, half, h); ctx.clip();
      ctx.drawImage(this.sourceCanvas, x, y, w, h);
      ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(x + half, y, half, h); ctx.clip();
      if (this.resultCanvas) ctx.drawImage(this.resultCanvas, x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = 'rgba(238,108,77,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x + half, y); ctx.lineTo(x + half, y + h); ctx.stroke();
    } else {
      drawResult(x, y, w, h);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}
