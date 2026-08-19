/* Schema-driven control panel builder. */
import { el, clamp } from '../core/util.js';
import { PALETTES, GRADIENTS } from '../image/color.js';

function swatchStrip(colors) {
  return el('span', { class: 'swatch-strip' },
    ...colors.slice(0, 10).map((c) => el('i', { style: `background:${c}` })));
}

function gradientCss(stops) {
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/**
 * Build one control row.
 * @param {object} def  parameter definition
 * @param {*} value     current value
 * @param {(v:*)=>void} onChange
 * @param {(v:*)=>void} onCommit  called when a drag ends (history checkpoint)
 */
export function buildControl(def, value, onChange, onCommit) {
  const id = `ctl-${def.k}`;
  const label = el('label', { class: 'ctl-label', for: id }, def.label);
  if (def.hint) {
    label.appendChild(el('span', { class: 'ctl-hint', title: def.hint, 'aria-label': def.hint }, '?'));
  }

  let input;
  const row = el('div', { class: `ctl ctl--${def.type}` });

  switch (def.type) {
    case 'range': {
      const num = el('input', {
        class: 'ctl-num', type: 'number', min: def.min, max: def.max, step: def.step, value,
      });
      input = el('input', {
        class: 'ctl-range', type: 'range', id, min: def.min, max: def.max, step: def.step, value,
      });
      const sync = (v, commit) => {
        const nv = clamp(Number(v), def.min, def.max);
        input.value = nv; num.value = nv;
        (commit ? onCommit : onChange)(nv);
      };
      input.addEventListener('input', () => sync(input.value, false));
      input.addEventListener('change', () => sync(input.value, true));
      num.addEventListener('change', () => sync(num.value, true));
      row.append(el('div', { class: 'ctl-head' }, label, el('div', { class: 'ctl-value' }, num,
        def.unit ? el('span', { class: 'ctl-unit' }, def.unit) : null)), input);
      break;
    }
    case 'select': {
      input = el('select', { class: 'ctl-select', id });
      for (const opt of def.options) {
        const o = el('option', { value: opt }, String(opt).replace(/-/g, ' '));
        if (opt === value) o.selected = true;
        input.appendChild(o);
      }
      input.addEventListener('change', () => onCommit(input.value));
      row.append(el('div', { class: 'ctl-head' }, label), input);
      break;
    }
    case 'toggle': {
      input = el('input', { type: 'checkbox', id, class: 'ctl-toggle' });
      input.checked = !!value;
      input.addEventListener('change', () => onCommit(input.checked));
      row.classList.add('is-inline');
      row.append(el('label', { class: 'switch', for: id }, input, el('span', { class: 'switch-track' })), label);
      break;
    }
    case 'color': {
      input = el('input', { type: 'color', id, class: 'ctl-color', value });
      const hex = el('input', { class: 'ctl-hex', type: 'text', value, spellcheck: 'false' });
      input.addEventListener('input', () => { hex.value = input.value; onChange(input.value); });
      input.addEventListener('change', () => onCommit(input.value));
      hex.addEventListener('change', () => {
        const v = hex.value.trim();
        if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) {
          const norm = v.startsWith('#') ? v : '#' + v;
          input.value = norm; onCommit(norm);
        } else { hex.value = input.value; }
      });
      row.append(el('div', { class: 'ctl-head' }, label), el('div', { class: 'ctl-colorwrap' }, input, hex));
      break;
    }
    case 'palette': {
      input = el('select', { class: 'ctl-select', id });
      for (const name of Object.keys(PALETTES)) {
        const o = el('option', { value: name }, name === 'auto' ? 'Auto (from image)' : name.replace(/-/g, ' '));
        if (name === value) o.selected = true;
        input.appendChild(o);
      }
      const preview = el('div', { class: 'palette-preview' });
      const paint = () => {
        preview.innerHTML = '';
        const list = PALETTES[input.value];
        preview.appendChild(list ? swatchStrip(list) : el('span', { class: 'muted' }, 'Colours extracted from your image'));
      };
      paint();
      input.addEventListener('change', () => { paint(); onCommit(input.value); });
      row.append(el('div', { class: 'ctl-head' }, label), input, preview);
      break;
    }
    case 'gradient': {
      input = el('select', { class: 'ctl-select', id });
      for (const name of Object.keys(GRADIENTS)) {
        const o = el('option', { value: name }, name.replace(/-/g, ' '));
        if (name === value) o.selected = true;
        input.appendChild(o);
      }
      const bar = el('div', { class: 'gradient-preview' });
      const paint = () => { bar.style.background = gradientCss(GRADIENTS[input.value] || ['#000', '#fff']); };
      paint();
      input.addEventListener('change', () => { paint(); onCommit(input.value); });
      row.append(el('div', { class: 'ctl-head' }, label), input, bar);
      break;
    }
    case 'seed': {
      input = el('input', { type: 'number', class: 'ctl-num wide', id, value, min: 0, step: 1 });
      const dice = el('button', { class: 'btn tiny', type: 'button', title: 'Randomise' }, '⟳');
      input.addEventListener('change', () => onCommit(Number(input.value)));
      dice.addEventListener('click', () => {
        input.value = Math.floor(Math.random() * 99999);
        onCommit(Number(input.value));
      });
      row.append(el('div', { class: 'ctl-head' }, label), el('div', { class: 'ctl-colorwrap' }, input, dice));
      break;
    }
    case 'text': {
      input = el('input', { type: 'text', class: 'ctl-text', id, value, spellcheck: 'false' });
      input.addEventListener('change', () => onCommit(input.value));
      row.append(el('div', { class: 'ctl-head' }, label), input);
      break;
    }
    default:
      return null;
  }
  return row;
}

/** Render an entire parameter schema into a container. */
export function renderParams(container, params, values, onChange, onCommit) {
  container.innerHTML = '';
  let section = null;
  for (const def of params) {
    if (def.type === 'group') {
      section = el('div', { class: 'ctl-group' }, el('h4', { class: 'ctl-group-title' }, def.label));
      container.appendChild(section);
      continue;
    }
    if (def.showIf && !def.showIf(values)) continue;
    const control = buildControl(def, values[def.k], (v) => onChange(def.k, v), (v) => onCommit(def.k, v));
    if (!control) continue;
    (section || container).appendChild(control);
  }
}
