/* Application shell: wires the store, pipeline, viewport and every panel. */
import { $, $$, el, debounce, download, formatBytes, clamp } from '../core/util.js';
import { store } from '../core/store.js';
import { render as runPipeline } from '../core/pipeline.js';
import { TRANSFORMS, grouped } from '../transforms/index.js';
import { withDefaults } from '../transforms/_shared.js';
import { renderParams } from './controls.js';
import { Viewport } from './viewport.js';
import { loadImageFile, loadSample, SAMPLE_NAMES } from '../core/imageio.js';
import { resultToCanvas, canvasToBlob, paletteToGpl, paletteToJson } from '../export/raster.js';
import { countNodes } from '../export/svg.js';

/* Adjustment panel schema — applied before every transform. */
const ADJUST_PARAMS = [
  { type: 'group', label: 'Tone' },
  { k: 'exposure', label: 'Exposure', type: 'range', min: -100, max: 100, step: 1, def: 0 },
  { k: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100, step: 1, def: 0 },
  { k: 'gamma', label: 'Gamma', type: 'range', min: 0.2, max: 3, step: 0.02, def: 1 },
  { k: 'blackPoint', label: 'Black point', type: 'range', min: 0, max: 90, step: 1, def: 0 },
  { k: 'whitePoint', label: 'White point', type: 'range', min: 10, max: 100, step: 1, def: 100 },
  { type: 'group', label: 'Colour' },
  { k: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, step: 1, def: 0 },
  { k: 'vibrance', label: 'Vibrance', type: 'range', min: -100, max: 100, step: 1, def: 0 },
  { k: 'hue', label: 'Hue shift', type: 'range', min: -180, max: 180, step: 1, def: 0, unit: '°' },
  { k: 'temperature', label: 'Temperature', type: 'range', min: -100, max: 100, step: 1, def: 0 },
  { k: 'grayscale', label: 'Grayscale', type: 'toggle', def: false },
  { k: 'invert', label: 'Invert', type: 'toggle', def: false },
  { type: 'group', label: 'Detail' },
  { k: 'denoise', label: 'Denoise (edge aware)', type: 'range', min: 0, max: 6, step: 1, def: 0 },
  { k: 'blur', label: 'Blur', type: 'range', min: 0, max: 12, step: 0.5, def: 0 },
  { k: 'sharpen', label: 'Sharpen', type: 'range', min: 0, max: 100, step: 1, def: 0 },
];

export class App {
  constructor() {
    this.viewport = new Viewport($('#view'), store);
    this.live = true;
    this.scheduleRender = debounce(() => this.render(), 180);
    this.build();
    this.bind();
    store.loadPersisted();
    store.pushHistory();
    this.syncAll();
    this.loadSampleImage(SAMPLE_NAMES[0]);
  }

  /* ------------------------------------------------------------ building */

  build() {
    // tool rail
    const rail = $('#tool-rail');
    rail.innerHTML = '';
    for (const [group, tools] of grouped()) {
      rail.appendChild(el('div', { class: 'rail-group-title' }, group));
      for (const t of tools) {
        const btn = el('button', {
          class: 'tool-btn', dataset: { tool: t.id }, title: `${t.label} — ${t.blurb}`,
        },
          el('span', {
            html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${t.icon}"/></svg>`,
          }),
          el('span', {}, t.label));
        btn.addEventListener('click', () => {
          store.setTool(t.id);
          if (window.innerWidth <= 900) $('#inspector').classList.add('is-open');
        });
        rail.appendChild(btn);
      }
    }

    // samples
    const sampleSel = $('#sample-select');
    for (const name of SAMPLE_NAMES) sampleSel.appendChild(el('option', { value: name }, name));

    // export formats are filled per result in openExport()
  }

  bind() {
    store.subscribe((state, reason) => {
      if (reason === 'view') { this.viewport.draw(); this.syncZoom(); return; }
      if (reason === 'source') {
        this.viewport.setSource(state.source);
        $('#dropzone').hidden = !!state.source;
        this.syncStatus();
      }
      if (reason === 'tool' || reason === 'history') this.syncTool();
      if (reason === 'presets') this.syncPresets();
      if (['tool', 'param', 'adjust', 'history', 'source'].includes(reason)) {
        if (reason !== 'param') this.syncPanels();
        store.persist();
        if (this.live) this.scheduleRender();
      }
    });

    // file open
    const fileInput = $('#file-input');
    $('#btn-open').addEventListener('click', () => fileInput.click());
    $('#btn-open-2').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      if (fileInput.files?.[0]) await this.openFile(fileInput.files[0]);
      fileInput.value = '';
    });
    $('#sample-select').addEventListener('change', (e) => {
      if (e.target.value) this.loadSampleImage(e.target.value);
      e.target.value = '';
    });

    // drag & drop
    const dz = $('#canvas-wrap');
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault();
      $('#dropzone').hidden = false;
      $('#dropzone').classList.add('is-drag');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault();
      $('#dropzone').classList.remove('is-drag');
      if (ev === 'dragleave' && store.state.source) $('#dropzone').hidden = true;
    }));
    dz.addEventListener('drop', async (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) await this.openFile(file);
      else if (store.state.source) $('#dropzone').hidden = true;
    });
    window.addEventListener('paste', async (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) await this.openFile(item.getAsFile());
    });

    // history
    $('#btn-undo').addEventListener('click', () => store.undo());
    $('#btn-redo').addEventListener('click', () => store.redo());
    $('#btn-random').addEventListener('click', () => this.surpriseMe());

    // compare modes
    $$('#compare-modes button').forEach((b) => b.addEventListener('click', () => {
      store.setView({ compare: b.dataset.mode });
      this.syncCompare();
    }));

    // stage bar
    $('#btn-fit').addEventListener('click', () => this.viewport.fit());
    $('#btn-zoom-in').addEventListener('click', () => this.viewport.zoomTo(clamp(store.state.view.zoom * 1.25, 0.02, 40)));
    $('#btn-zoom-out').addEventListener('click', () => this.viewport.zoomTo(clamp(store.state.view.zoom / 1.25, 0.02, 40)));
    $('#btn-zoom-level').addEventListener('click', () => this.viewport.zoomTo(1));
    $('#chk-checker').addEventListener('change', (e) => store.setView({ checker: e.target.checked }));
    $('#chk-live').addEventListener('change', (e) => {
      this.live = e.target.checked;
      if (this.live) this.scheduleRender();
    });
    $('#btn-render').addEventListener('click', () => this.render());

    // tabs
    $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.tab-panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === tab.dataset.tab));
    }));

    // presets
    $('#preset-select').addEventListener('change', (e) => this.applyPreset(e.target.value));
    $('#btn-save-preset').addEventListener('click', () => {
      const name = prompt('Preset name', 'My preset');
      if (name) store.saveUserPreset(name.trim());
    });
    $('#btn-delete-preset').addEventListener('click', () => {
      const val = $('#preset-select').value;
      if (val.startsWith('user:')) store.deleteUserPreset(val.slice(5));
    });
    $('#btn-reset').addEventListener('click', () => store.resetParams());

    $('#btn-panel').addEventListener('click', () => $('#inspector').classList.toggle('is-open'));

    // export modal
    $('#btn-export').addEventListener('click', () => this.openExport());
    $('#btn-close-export').addEventListener('click', () => { $('#export-modal').hidden = true; });
    $('#export-modal').addEventListener('click', (e) => {
      if (e.target === $('#export-modal')) $('#export-modal').hidden = true;
    });
    $('#exp-format').addEventListener('change', () => this.syncExportFields());
    $('#exp-scale').addEventListener('change', () => this.syncExportFields());
    $('#exp-quality').addEventListener('input', (e) => { $('#exp-quality-val').textContent = e.target.value; });
    $('#btn-download').addEventListener('click', () => this.doExport('download'));
    $('#btn-copy').addEventListener('click', () => this.doExport('copy'));

    // keyboard
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === 'b' || e.key === 'B') {
        if (this._peeking) {
          store.setView({ compare: this._peeking });
          this._peeking = null;
          this.syncCompare();
        }
      }
    });
  }

  onKey(e) {
    const typing = /input|textarea|select/i.test(e.target.tagName);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); this.openExport(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#file-input').click(); return; }
    if (typing) return;
    switch (e.key) {
      case 'f': case 'F': this.viewport.fit(); break;
      case '0': this.viewport.zoomTo(1); break;
      case '+': case '=': this.viewport.zoomTo(clamp(store.state.view.zoom * 1.25, 0.02, 40)); break;
      case '-': this.viewport.zoomTo(clamp(store.state.view.zoom / 1.25, 0.02, 40)); break;
      case 'r': case 'R': store.setView({ compare: 'result' }); this.syncCompare(); break;
      case 's': case 'S': store.setView({ compare: 'split' }); this.syncCompare(); break;
      case 'b': case 'B':
        if (!this._peeking) {
          this._peeking = store.state.view.compare;
          store.setView({ compare: 'source' });
          this.syncCompare();
        }
        break;
      case 'Escape': $('#export-modal').hidden = true; break;
      case 'Enter': if (!this.live) this.render(); break;
      default:
        if (/^[1-9]$/.test(e.key)) {
          const t = TRANSFORMS[Number(e.key) - 1];
          if (t) store.setTool(t.id);
        }
    }
  }

  /* ------------------------------------------------------------- sources */

  async openFile(file) {
    if (!file) return;
    this.setStatus(`Loading ${file.name}…`);
    try {
      const src = await loadImageFile(file);
      store.setSource(src);
      $('#exp-name').value = `${src.name}-bix`;
      this.setStatus(`Loaded ${src.width}×${src.height}`);
      this.render();
    } catch (err) {
      this.setStatus(`Could not read that file: ${err.message}`);
    }
  }

  loadSampleImage(name) {
    const src = loadSample(name);
    store.setSource(src);
    $('#exp-name').value = `${src.name}-bix`;
    this.render();
  }

  surpriseMe() {
    const tool = TRANSFORMS[Math.floor(Math.random() * TRANSFORMS.length)];
    store.setTool(tool.id);
    const presets = tool.presets || [];
    if (presets.length) {
      const preset = presets[Math.floor(Math.random() * presets.length)];
      store.setParams({ ...withDefaults(tool, {}), ...preset.values });
      this.setStatus(`${tool.label} · ${preset.name}`);
    }
    this.syncPanels();
  }

  /* -------------------------------------------------------------- render */

  async render(quality = 'preview') {
    if (!store.state.source) return null;
    $('#busy').hidden = false;
    try {
      const result = await runPipeline(store.state, { quality });
      if (!result) return null;
      store.state.result = result;
      await this.viewport.setResult(result);
      this.syncStatus();
      return result;
    } catch (err) {
      console.error(err);
      this.setStatus(`Render failed: ${err.message}`);
      return null;
    } finally {
      $('#busy').hidden = true;
    }
  }

  /* ---------------------------------------------------------------- sync */

  syncAll() {
    this.syncTool();
    this.syncPanels();
    this.syncCompare();
    this.syncZoom();
  }

  syncTool() {
    const tool = store.tool;
    $('#tool-title').textContent = tool.label;
    $('#tool-blurb').textContent = tool.blurb;
    $$('.tool-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === tool.id));
    this.syncPresets();
  }

  syncPanels() {
    const tool = store.tool;
    renderParams($('#params'), tool.params, store.params,
      (k, v) => { store.setParam(k, v); if (this.live) this.scheduleRender(); },
      (k, v) => {
        const needsRebuild = tool.params.some((p) => p.showIf);
        store.setParam(k, v);
        store.pushHistory();
        if (needsRebuild) this.syncPanels();
        if (this.live) this.scheduleRender();
      });

    renderParams($('#adjust'), ADJUST_PARAMS, store.state.adjust,
      (k, v) => { store.setAdjust(k, v); if (this.live) this.scheduleRender(); },
      (k, v) => { store.setAdjust(k, v); store.pushHistory(); if (this.live) this.scheduleRender(); });

    if (!$('#adjust .reset-adjust')) {
      const btn = el('button', { class: 'btn tiny reset-adjust' }, 'Reset image adjustments');
      btn.addEventListener('click', () => { store.resetAdjust(); this.syncPanels(); });
      $('#adjust').appendChild(el('div', { class: 'ctl' }, btn));
    }
    this.syncQuickExport();
  }

  syncPresets() {
    const sel = $('#preset-select');
    const tool = store.tool;
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '' }, 'Presets…'));
    const built = el('optgroup', { label: 'Built in' });
    for (const p of tool.presets || []) built.appendChild(el('option', { value: `built:${p.name}` }, p.name));
    if (built.children.length) sel.appendChild(built);
    const mine = store.state.userPresets[tool.id] || [];
    if (mine.length) {
      const grp = el('optgroup', { label: 'Yours' });
      for (const p of mine) grp.appendChild(el('option', { value: `user:${p.name}` }, p.name));
      sel.appendChild(grp);
    }
  }

  applyPreset(value) {
    if (!value) return;
    const tool = store.tool;
    const [kind, ...rest] = value.split(':');
    const name = rest.join(':');
    const list = kind === 'user' ? (store.state.userPresets[tool.id] || []) : (tool.presets || []);
    const preset = list.find((p) => p.name === name);
    if (!preset) return;
    const base = kind === 'user' ? {} : withDefaults(tool, {});
    store.setParams({ ...base, ...preset.values });
    this.syncPanels();
    this.setStatus(`Preset “${name}” applied`);
  }

  syncCompare() {
    const mode = store.state.view.compare;
    $$('#compare-modes button').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
    this.viewport.draw();
  }

  syncZoom() {
    $('#btn-zoom-level').textContent = `${Math.round(store.state.view.zoom * 100)}%`;
  }

  syncStatus() {
    const s = store.state.source;
    const r = store.state.result;
    $('#doc-size').textContent = s ? `${s.width}×${s.height}` : '—';
    $('#render-time').textContent = r ? `${r.ms} ms` : '—';
    $('#status-tool').textContent = r ? r.toolLabel : store.tool.label;
    $('#status-stats').textContent = r?.stats
      ? Object.entries(r.stats).map(([k, v]) => `${k}: ${v}`).join('  ·  ')
      : '';
    $('#out-source').textContent = s ? `${s.width}×${s.height}` : '—';
    $('#out-doc').textContent = r ? `${r.docWidth}×${r.docHeight}` : '—';
    $('#out-kind').textContent = r ? (r.type === 'svg' ? 'Vector (SVG)' : r.svg ? 'Raster + SVG' : 'Raster') : '—';
    $('#out-stats').textContent = r?.svg ? `${countNodes(r.svg)} nodes` : (r ? 'pixels' : '—');
    this.syncZoom();
  }

  syncQuickExport() {
    const wrap = $('#quick-export');
    wrap.innerHTML = '';
    const quick = [
      ['SVG', () => this.quickExport('svg')],
      ['PNG 1×', () => this.quickExport('png', 1)],
      ['PNG 2×', () => this.quickExport('png', 2)],
      ['JPEG', () => this.quickExport('jpeg', 1)],
    ];
    for (const [label, fn] of quick) {
      const b = el('button', { class: 'btn tiny' }, label);
      b.addEventListener('click', fn);
      wrap.appendChild(b);
    }
  }

  setStatus(msg) {
    $('#status-msg').textContent = msg;
    clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => { $('#status-msg').textContent = ''; }, 4200);
  }

  /* -------------------------------------------------------------- export */

  formatsFor(result) {
    const out = [];
    if (result?.svg) out.push(['svg', 'SVG — editable vector']);
    out.push(['png', 'PNG — transparent raster']);
    out.push(['jpeg', 'JPEG — small photo file']);
    out.push(['webp', 'WebP — modern raster']);
    if (result?.text) out.push(['txt', 'TXT — plain text art']);
    if (result?.palette) {
      out.push(['gpl', 'GPL — GIMP/Aseprite palette']);
      out.push(['json', 'JSON — palette data']);
    }
    return out;
  }

  openExport() {
    const result = store.state.result;
    if (!result) { this.setStatus('Render something first'); return; }
    const sel = $('#exp-format');
    const prev = sel.value;
    sel.innerHTML = '';
    for (const [v, label] of this.formatsFor(result)) sel.appendChild(el('option', { value: v }, label));
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    $('#export-modal').hidden = false;
    this.syncExportFields();
  }

  syncExportFields() {
    const fmt = $('#exp-format').value;
    const result = store.state.result;
    const scale = Number($('#exp-scale').value);
    $('#field-quality').hidden = !(fmt === 'jpeg' || fmt === 'webp');
    const raster = ['png', 'jpeg', 'webp'].includes(fmt);
    $('#exp-scale').disabled = !raster;
    const w = Math.round((result?.docWidth || 0) * scale);
    const h = Math.round((result?.docHeight || 0) * scale);
    const lines = [];
    if (fmt === 'svg') {
      lines.push(`Vector document · ${result.docWidth}×${result.docHeight} units`);
      lines.push(`${countNodes(result.svg)} shapes · ${formatBytes(new Blob([result.svg]).size)}`);
      lines.push('Scales to any size without loss.');
    } else if (raster) {
      lines.push(`${w}×${h} px  (${scale}×)`);
      lines.push(`${(w * h / 1e6).toFixed(1)} megapixels`);
    } else if (fmt === 'txt') {
      lines.push(`${(result.text || '').split('\n').length} lines of text art`);
    } else {
      lines.push(`${result.palette?.length || 0} colours`);
    }
    $('#exp-info').innerHTML = lines.join('<br>');
  }

  async prepareResult() {
    if ($('#exp-full').checked) {
      const full = await this.render('full');
      return full || store.state.result;
    }
    return store.state.result;
  }

  async quickExport(fmt, scale = 1) {
    const result = store.state.result;
    if (!result) return;
    $('#exp-format').value = fmt === 'png' || fmt === 'jpeg' ? fmt : fmt;
    await this.exportAs(result, fmt, { scale, action: 'download' });
  }

  async doExport(action) {
    const result = await this.prepareResult();
    if (!result) return;
    await this.exportAs(result, $('#exp-format').value, {
      scale: Number($('#exp-scale').value),
      quality: Number($('#exp-quality').value) / 100,
      background: $('#exp-bg').value,
      action,
    });
  }

  async exportAs(result, fmt, { scale = 1, quality = 0.92, background = 'keep', action = 'download' } = {}) {
    const name = ($('#exp-name').value || 'bix-transform').replace(/[^\w.-]+/g, '-');
    try {
      if (fmt === 'svg') {
        if (!result.svg) throw new Error('This transform has no vector output');
        if (action === 'copy') {
          await navigator.clipboard.writeText(result.svg);
          this.setStatus('SVG markup copied to the clipboard');
        } else {
          download(result.svg, `${name}.svg`, 'image/svg+xml');
          this.setStatus(`Exported ${name}.svg`);
        }
        return;
      }
      if (fmt === 'txt') {
        if (action === 'copy') {
          await navigator.clipboard.writeText(result.text || '');
          this.setStatus('Text art copied');
        } else {
          download(result.text || '', `${name}.txt`, 'text/plain');
          this.setStatus(`Exported ${name}.txt`);
        }
        return;
      }
      if (fmt === 'gpl' || fmt === 'json') {
        const data = fmt === 'gpl' ? paletteToGpl(result.palette, name) : paletteToJson(result.palette);
        if (action === 'copy') {
          await navigator.clipboard.writeText(data);
          this.setStatus('Palette copied');
        } else {
          download(data, `${name}.${fmt}`, 'text/plain');
          this.setStatus(`Exported ${name}.${fmt}`);
        }
        return;
      }

      const bg = background === 'white' ? '#ffffff'
        : background === 'black' ? '#000000'
        : background === 'transparent' ? null
        : (fmt === 'jpeg' ? '#ffffff' : null);
      const canvas = await resultToCanvas(result, { scale, background: bg });
      const mime = fmt === 'png' ? 'image/png' : fmt === 'jpeg' ? 'image/jpeg' : 'image/webp';
      const blob = await canvasToBlob(canvas, mime, quality);
      if (action === 'copy') {
        if (!navigator.clipboard?.write) throw new Error('Clipboard images are not supported in this browser');
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        this.setStatus('Image copied to the clipboard');
      } else {
        const ext = fmt === 'jpeg' ? 'jpg' : fmt;
        download(blob, `${name}.${ext}`, mime);
        this.setStatus(`Exported ${name}.${ext} · ${formatBytes(blob.size)}`);
      }
    } catch (err) {
      console.error(err);
      this.setStatus(`Export failed: ${err.message}`);
    }
  }
}
