/**
 * The status bar under the input, laid out to width (v6.13, Option A of
 * `.agent/artifacts/plans/2026-10-30-status-bar.md`).
 *
 * Reported with a screenshot: *"the bottom bar needs some redesign, it could
 * look cluttered"*. It had four colours on one row with the loudest on the
 * normal state, three grammars (`plan mode on`, `effort: medium`, `prompt
 * v2`), a 21-column hint on every frame, `▱▱▱▱▱ 0% of 48k` before anything was
 * sent, and five-column separators. At 90 columns the right half reached the
 * edge; at 60 the left half was truncated, so the mode was what went.
 *
 * Now: quiet by default, colour for departures, bare values, absent at
 * default, and a fixed order of what gives way. The layout is decided here and
 * `App.jsx` only colours it, so the width order is testable without a pty.
 *
 * Segments carry a `role` rather than a colour: `mode` (the glyph, coloured by
 * mode), `dim`, `attention`, `danger`. Every glyph used here is one column in
 * `string-width`, which is what Ink measures with, so length is code points.
 */
import { MODE_GLYPHS } from './format.js';

export const SEP = ' · ';
/** Between the halves; the right half never touches the left. */
const GAP = 2;

const cols = (s) => [...s].length;
const widthOf = (segs) => segs.reduce((n, s) => n + cols(s.text), 0);

const MODE_NAMES = { plan: 'plan', auto: 'auto', strict: 'strict' };

/** `3.5 Flash-Lite` → `Flash-Lite`; a label with no version number is kept. */
export function shortModel(label) {
  const short = String(label).replace(/^\d+(?:\.\d+)?\s+/, '');
  return short || String(label);
}

/**
 * The context field: hidden until something has been sent, then the percent,
 * and how far to compaction once that is within twenty points. The limit
 * (`of 48k`) was the same on every frame of a session and is in `/context`.
 */
export function contextText(pct, compactAtPct) {
  const toGo = compactAtPct - pct;
  if (toGo <= 20) return `${Math.max(0, toGo)}% to compact`;
  return `${pct}%`;
}

function contextRole(pct) {
  if (pct > 80) return 'danger';
  if (pct > 50) return 'attention';
  return 'dim';
}

/**
 * @param {object} o
 * @param {number} o.width          terminal columns
 * @param {string} o.mode           plan | auto | strict
 * @param {boolean} [o.hint]        show `shift+tab to cycle` (start of a chat, idle)
 * @param {string} [o.notice]       replaces the hint: the exit prompt or a flash
 * @param {string} [o.scope]        monorepo scope leaf
 * @param {number} [o.pastes]
 * @param {number} [o.running]      background tasks
 * @param {{done:number,total:number}} [o.tasks]  only during a turn
 * @param {string} [o.version]      prompt version, only when not the default
 * @param {string} [o.model]        the browser's selected model
 * @param {'↓'|'⚠'} [o.modelMark]   stepped down, or not what the effort wants
 * @param {string} [o.effort]       shown when the model is unread
 * @param {number|null} [o.pct]     context used; null hides the field
 * @param {string} [o.meter]        the meter's cells for `pct`
 * @param {number} [o.compactAtPct]
 * @returns {{left: Array<{text:string, role:string}>, right: Array<{text:string, role:string}>}}
 */
export function statusBarLayout(o) {
  const width = Math.max(1, o.width || 80);
  const compactAt = o.compactAtPct ?? 80;
  // Each step gives one thing up, in the order the plan fixed; `build` reads them.
  const shed = { hint: false, pastes: false, modeWord: false, scope: false, meter: false,
    version: false, modelNumber: false, tasks: false, context: false };

  const build = () => {
    const left = [];
    const glyph = MODE_GLYPHS[o.mode] || MODE_GLYPHS.plan;
    const name = MODE_NAMES[o.mode] || MODE_NAMES.plan;
    left.push({ text: glyph, role: 'mode' });
    left.push({ text: ` ${name}${shed.modeWord ? '' : o.mode === 'strict' ? ' plan mode' : ' mode'}`, role: 'dim' });
    if (o.notice) left.push({ text: `${SEP}${o.notice}`, role: 'attention' });
    else if (o.hint && !shed.hint) left.push({ text: `${SEP}shift+tab to cycle`, role: 'dim' });
    if (o.scope && !shed.scope) left.push({ text: `${SEP}${o.scope}`, role: 'dim' });

    const fields = [];
    if (o.pastes > 0 && !shed.pastes) fields.push([{ text: `${o.pastes} paste${o.pastes === 1 ? '' : 's'}`, role: 'dim' }]);
    if (o.running > 0) fields.push([{ text: `${o.running} running`, role: 'attention' }]);
    if (o.tasks && !shed.tasks) fields.push([{ text: `tasks ${o.tasks.done}/${o.tasks.total}`, role: 'dim' }]);
    if (o.version && !shed.version) fields.push([{ text: o.version, role: 'dim' }]);
    if (o.model) {
      const label = shed.modelNumber ? shortModel(o.model) : o.model;
      fields.push([{ text: o.modelMark ? `${o.modelMark} ${label}` : label, role: o.modelMark ? 'attention' : 'dim' }]);
    } else if (o.effort) {
      fields.push([{ text: o.effort, role: 'dim' }]);
    }
    if (o.pct != null && o.pct > 0 && !(shed.context && o.pct <= 80)) {
      const role = contextRole(o.pct);
      const field = [];
      if (!shed.meter && o.meter) field.push({ text: `${o.meter} `, role });
      field.push({ text: contextText(o.pct, compactAt), role: role === 'danger' ? 'danger' : 'dim' });
      fields.push(field);
    }
    const right = [];
    fields.forEach((field, i) => {
      if (i > 0) right.push({ text: SEP, role: 'dim' });
      right.push(...field);
    });
    return { left, right };
  };

  const fits = ({ left, right }) => widthOf(left) + (right.length ? GAP + widthOf(right) : 0) <= width;

  let layout = build();
  for (const step of Object.keys(shed)) {
    if (fits(layout)) break;
    shed[step] = true;
    layout = build();
  }
  // What is left never goes: the mode, a marked model, background work, a
  // nearly full context. The left half is truncated by Ink (`wrap="truncate"`)
  // if even that is too wide, which keeps it at one row.
  return layout;
}
