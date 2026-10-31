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
import { pickModelFor, browserModelPin } from '../core/model-match.js';

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
  const pick = pickModelFor(rung.id, options, browserModelPin(modelConfig, rung.id));
  if (pick) return { text: pick.model.label, available: true };
  return {
    text: rung.id === 'max' ? 'not available on this account' : 'nothing on this account suits it',
    available: false,
  };
}

/**
 * The tab's model when it is not the one this stop maps to, else null (v7.9).
 *
 * The slider said `3.1 Pro ✔ current` while the tab ran 3.8 Flash, which reads
 * as "all is well". Unread picker, a mode selected, or an unavailable stop: null.
 */
export function tabDiffers(stop, models = []) {
  if (!stop?.available) return null;
  const tab = (models || []).find((m) => m && m.selected && !m.isMode)?.label;
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
