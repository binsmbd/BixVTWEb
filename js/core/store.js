/* Tiny observable store with undo/redo for the whole document state. */
import { TRANSFORMS, byId } from '../transforms/index.js';
import { withDefaults } from '../transforms/_shared.js';
import { ADJUST_DEFAULTS } from '../image/adjust.js';

const LS_KEY = 'bix-transform:v1';

function initialParams() {
  const out = {};
  for (const t of TRANSFORMS) out[t.id] = withDefaults(t, {});
  return out;
}

export const store = {
  state: {
    source: null,              // { imageData, width, height, name }
    toolId: TRANSFORMS[0].id,
    adjust: { ...ADJUST_DEFAULTS },
    params: initialParams(),
    view: {
      zoom: 1, panX: 0, panY: 0, fit: true,
      compare: 'result',       // result | source | split | side
      split: 0.5,
      checker: true,
    },
    quality: 'preview',        // preview | full
    result: null,
    processing: false,
    error: null,
    userPresets: {},
  },
  listeners: new Set(),
  history: [],
  future: [],

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  emit(reason = 'change') {
    for (const fn of this.listeners) fn(this.state, reason);
  },

  /** Snapshot of the parts that undo/redo cares about. */
  snapshot() {
    return JSON.stringify({
      toolId: this.state.toolId,
      adjust: this.state.adjust,
      params: this.state.params,
    });
  },

  pushHistory() {
    const snap = this.snapshot();
    if (this.history[this.history.length - 1] === snap) return;
    this.history.push(snap);
    if (this.history.length > 80) this.history.shift();
    this.future.length = 0;
  },

  undo() {
    if (this.history.length < 2) return false;
    this.future.push(this.history.pop());
    const snap = JSON.parse(this.history[this.history.length - 1]);
    Object.assign(this.state, snap);
    this.emit('history');
    return true;
  },

  redo() {
    if (!this.future.length) return false;
    const snap = this.future.pop();
    this.history.push(snap);
    Object.assign(this.state, JSON.parse(snap));
    this.emit('history');
    return true;
  },

  get tool() { return byId(this.state.toolId); },
  get params() { return this.state.params[this.state.toolId]; },

  setTool(id) {
    if (this.state.toolId === id) return;
    this.state.toolId = id;
    this.pushHistory();
    this.emit('tool');
  },

  setParam(key, value) {
    this.params[key] = value;
    this.emit('param');
  },

  setParams(values) {
    Object.assign(this.params, values);
    this.pushHistory();
    this.emit('param');
  },

  resetParams() {
    this.state.params[this.state.toolId] = withDefaults(this.tool, {});
    this.pushHistory();
    this.emit('param');
  },

  setAdjust(key, value) {
    this.state.adjust[key] = value;
    this.emit('adjust');
  },

  resetAdjust() {
    this.state.adjust = { ...ADJUST_DEFAULTS };
    this.pushHistory();
    this.emit('adjust');
  },

  setView(patch) {
    Object.assign(this.state.view, patch);
    this.emit('view');
  },

  setSource(source) {
    this.state.source = source;
    this.state.view.fit = true;
    this.emit('source');
  },

  /* --- user presets, persisted in localStorage ------------------------- */
  loadPersisted() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.userPresets) this.state.userPresets = saved.userPresets;
      if (saved.params) {
        for (const [id, vals] of Object.entries(saved.params)) {
          if (this.state.params[id]) Object.assign(this.state.params[id], vals);
        }
      }
      if (saved.toolId && this.state.params[saved.toolId]) this.state.toolId = saved.toolId;
      if (saved.adjust) Object.assign(this.state.adjust, saved.adjust);
    } catch { /* corrupt storage is not worth crashing over */ }
  },

  persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        userPresets: this.state.userPresets,
        params: this.state.params,
        toolId: this.state.toolId,
        adjust: this.state.adjust,
      }));
    } catch { /* quota — ignore */ }
  },

  saveUserPreset(name) {
    const list = this.state.userPresets[this.state.toolId] || [];
    const existing = list.findIndex((p) => p.name === name);
    const entry = { name, values: { ...this.params } };
    if (existing >= 0) list[existing] = entry; else list.push(entry);
    this.state.userPresets[this.state.toolId] = list;
    this.persist();
    this.emit('presets');
  },

  deleteUserPreset(name) {
    const list = this.state.userPresets[this.state.toolId] || [];
    this.state.userPresets[this.state.toolId] = list.filter((p) => p.name !== name);
    this.persist();
    this.emit('presets');
  },
};
