/**
 * `/effort` as a slider, moved with ←/→.
 *
 * Owner, 2026-10-26, with a screenshot of Claude Code's effort control:
 * "maybe add a horizontal slider that we can move through arrow keys … simple
 * and eye pleasing". One axis, Faster on the left and Smarter on the right, a
 * marker on the bar, the levels named under it. The list it replaces answered
 * the same question in three rows that read like three unrelated things.
 *
 * Pure and `.js`, so `node --test` can import it: every row is laid out here
 * at an exact width, and the menu only colours it.
 */
import {
  pickModelFor, browserModelPin, lockedReason, selectedModel,
} from '../../backend/core/models/model-match.js';
import { wantedThinking } from '../../backend/core/models/thinking.js';

/**
 * The model a stop would put the tab on, on this account (C2).
 *
 * The line under the bar used to print the rung's `browser` text — `Gemini
 * Pro`, `Gemini Argon` — which names a family, not the picker entry, and says
 * nothing about whether this account has it. Max is the case where that
 * matters: on most accounts there is no Argon, and the stop should say so
 * before it is chosen rather than after.
 *
 * Before the picker has reported, the rung's own text is all there is, and it
 * is shown as before.
 *
 * @returns {{text: string, available: boolean}}
 */
export function stopModel(rung, models = [], modelConfig = {}) {
  const options = (models || []).filter((m) => m && m.label);
  if (options.length === 0) return { text: rung.browser, available: true };
  const pin = browserModelPin(modelConfig, rung.id);
  const pick = pickModelFor(rung.id, options, pin);
  if (pick) return { text: pick.model.label, available: true };
  const locked = lockedReason(rung.id, options, pin);
  return {
    text: locked ? locked.replace(' on this account', '')
      : rung.id === 'max' ? 'not available on this account' : 'nothing on this account suits it',
    available: false,
  };
}

/**
 * One model to choose from, and why (v9.9.1). Owner, with a screenshot of an
 * Auto account where every stop read "Auto": "just show the slider, say auto
 * mode is available, with others locked". The slider stays, because effort still
 * picks the prompt; the line under it says the model cannot follow.
 *
 * @returns {{label: string, locked: string[]} | null} null when the picker is
 *          unread or there is a real choice
 */
export function onlyModel(models = []) {
  const options = (models || []).filter((m) => m && m.label && !m.isMode);
  const open = options.filter((m) => !m.locked);
  if (open.length !== 1 || options.length < 2) return null;
  return { label: open[0].label, locked: options.filter((m) => m.locked).map((m) => m.label) };
}

/** The line under the bar on such an account. */
export function onlyModelLine(only) {
  const locked = only.locked.length ? ` · ${only.locked.join(', ')} locked` : '';
  return `${only.label} is the only model here${locked}`;
}

/**
 * The tab's model when it is not the one this stop maps to, else null (v7.9).
 *
 * The slider said `3.1 Pro ✔ current` while the tab ran 3.8 Flash, which reads
 * as "all is well". Unread picker, a mode selected, or an unavailable stop: null.
 */
export function tabDiffers(stop, models = []) {
  if (!stop?.available) return null;
  const tab = selectedModel(models)?.label;
  if (!tab) return null;
  return tab.trim().toLowerCase() === String(stop.text).trim().toLowerCase() ? null : tab;
}

/**
 * @param {{levels: Array<{id: string, name: string}>, at: number, width: number}} view
 *        `width` is the terminal's; the slider takes at most 56 columns of it
 * @returns {{indent: number, span: number, ends: string, bar: {before: string, marker: string, after: string},
 *            labels: Array<{text: string, col: number}>}}
 *          `labels[i].col` is where that level's name starts, relative to `indent`
 */
export function sliderLayout({ levels, at = 0, width = 80 }) {
  const n = levels.length;
  const names = levels.map((l) => l.name.toLowerCase());
  // Wide enough for every name with room between them, never wider than 56.
  const need = names.reduce((sum, s) => sum + s.length, 0) + (n - 1) * 4;
  const span = Math.max(need, Math.min(56, width - 8));
  const indent = Math.max(1, Math.floor((width - span) / 2));
  const stops = levels.map((_, i) => (n === 1 ? Math.floor(span / 2) : Math.round((i * (span - 1)) / (n - 1))));
  const i = Math.max(0, Math.min(at, n - 1));
  const marker = stops[i];
  const bar = { before: '─'.repeat(marker), marker: '▲', after: '─'.repeat(Math.max(0, span - marker - 1)) };

  // Each name centred on its stop, then pushed inside the span and clear of
  // the one before it.
  const labels = [];
  let free = 0;
  names.forEach((text, k) => {
    let col = Math.round(stops[k] - text.length / 2);
    col = Math.max(free, Math.min(col, span - text.length));
    labels.push({ text, col });
    free = col + text.length + 1;
  });

  const left = 'Faster';
  const right = 'Smarter';
  const ends = left + ' '.repeat(Math.max(1, span - left.length - right.length)) + right;
  return { indent, span, ends, bar, labels };
}

/**
 * The next Thinking stop from `at`, one step left or right, past locked levels;
 * it stops at the ends (v9.9.3).
 */
export function stepThinking(stops, at, dir) {
  let i = Math.max(0, stops.findIndex((s) => s.id === at));
  for (let j = i + dir; j >= 0 && j < stops.length; j += dir) {
    if (!stops[j].locked) return stops[j].id;
  }
  return stops[i]?.id ?? at;
}

/**
 * The Thinking row under the slider: its name, the stop between ◂ ▸, then the
 * level it means for the marked rung and any locked levels (owner: "show is
 * locked or something").
 *
 * @returns {{name: string, value: string, detail: string}}
 */
export function thinkingLine({ stops, at, rung, options }) {
  const stop = stops.find((s) => s.id === at) || stops[0];
  const means = stop.id === 'same'
    ? wantedThinking({ rung, setting: 'same', options }).level
    : null;
  const locked = stops.filter((s) => s.locked).map((s) => s.label);
  return {
    name: 'Thinking  ',
    value: `◂ ${stop.label} ▸`,
    detail: (means ? `  ${means}` : '') + (locked.length ? `  · ${locked.join(', ')} locked` : ''),
  };
}
