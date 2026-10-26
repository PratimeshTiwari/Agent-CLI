/**
 * `/settings` as a list of switches (v5.27, Option C′ in
 * `.agent/artifacts/plans/2026-10-27-settings-redesign.md`, the owner's pick).
 *
 * What the page got wrong, from the owner's screenshot: the hint for the
 * selected row was drawn under the whole list, seven rows from the row it
 * described; four value colours on seven rows said nothing; and a setting with
 * two states took a page, a paragraph and a keypress to flip. So:
 *
 * - a **switch** shows both states (`● on  ○ off`), the current one in the
 *   accent and the other dim, and ←/→ choose between them where they stand;
 * - a **ladder** shows `◂ value ▸`, an arrow dim where the ladder ends;
 * - the **hint** sits on the selected row, to the right, and nowhere else;
 * - the **filter** stays the top item, underlined like the input box, and
 *   printable keys go to it while the arrows go to the list.
 *
 * Changing a value still runs the command that owns it (`row.restore`), so
 * there is one way to change anything and the summary on the way out still
 * sees every change.
 *
 * Pure and `.js`, so `node --test` can import it.
 */

/** Below this many columns the hint has no room beside the value. */
export const HINT_MIN_COLS = 70;

/** The filter's underline: at least this long, longer as you type. */
export const UNDERLINE_MIN = 25;

/**
 * Where ←/→ can go from a row's value.
 *
 * Spatial, never wrapping: ← moves toward the first option and → toward the
 * last, so on `● on  ○ off` ← means on and → means off, and pressing again at
 * an end does nothing rather than coming round the other side.
 *
 * @param {{value: string, control?: {kind: string, options: string[]}}} row
 * @param {-1|1} dir
 * @param {{skip?: string[]}} [opts] options that cannot be chosen here
 *        (Max on an account without Argon)
 * @returns {string|null} the value to set, or null when there is nowhere to go
 */
export function stepValue(row, dir, { skip = [] } = {}) {
  const options = (row?.control?.options || []).filter((o) => !skip.includes(o) || o === row.value);
  const at = options.indexOf(row?.value);
  if (at < 0) return options[0] ?? null;
  const next = at + (dir < 0 ? -1 : 1);
  if (next < 0 || next >= options.length) return null;
  return options[next];
}

/**
 * The value cell as segments: `{text, role}`, where role is `accent`, `dim`
 * or `plain`. The component maps roles to colours; this decides which is which.
 */
export function controlParts(row, { skip = [] } = {}) {
  const value = String(row?.value ?? '');
  const control = row?.control;
  if (control?.kind === 'switch') {
    const parts = [];
    control.options.forEach((option, i) => {
      if (i > 0) parts.push({ text: '  ', role: 'plain' });
      const on = option === value;
      parts.push({ text: `${on ? '●' : '○'} ${option}`, role: on ? 'accent' : 'dim' });
    });
    return parts;
  }
  if (control?.kind === 'ladder') {
    return [
      { text: '◂ ', role: stepValue(row, -1, { skip }) == null ? 'dim' : 'plain' },
      { text: value, role: 'plain' },
      { text: ' ▸', role: stepValue(row, 1, { skip }) == null ? 'dim' : 'plain' },
    ];
  }
  // Clamped as the old page clamped it (`VALUE_MAX` in core/settings.js).
  const text = value.replace(/\s+/g, ' ').trim();
  return [{ text: text.length > 30 ? `${text.slice(0, 29)}…` : text, role: 'plain' }];
}

/** How many columns the value cell takes. */
export function controlWidth(row, opts) {
  return controlParts(row, opts).reduce((n, p) => n + p.text.length, 0);
}

/**
 * The hint for the selected row, or '' when the line has no room for it.
 *
 * @param {object} row
 * @param {{width: number, used: number, note?: string}} at `used` is the
 *        columns the row has drawn before the hint
 */
export function rowHint(row, { width = 80, used = 0, note = '' } = {}) {
  if (width < HINT_MIN_COLS) return '';
  const text = note || row?.hint || '';
  const room = width - used - 3;
  if (!text || room < 8) return '';
  return text.length > room ? `${text.slice(0, room - 1)}…` : text;
}

/** The filter's underline: dim `─` while empty, accent `═` once there is text. */
export function filterUnderline(query = '') {
  const q = String(query);
  const length = Math.max(UNDERLINE_MIN, q.length + 4);
  return { text: (q ? '═' : '─').repeat(length), role: q ? 'accent' : 'dim' };
}

/** The keys line. Tabs are not on it while a filter searches every tab. */
export function settingsKeys({ query = '' } = {}) {
  return query
    ? '↑↓ move · ←/→ change · enter open · esc clear'
    : 'type to filter · ↑↓ move · ←/→ change · enter open · tab tabs · esc close';
}

/**
 * A key the filter takes: printable text, never a control byte. Arrows, tab,
 * enter and escape are the list's and the page's.
 */
export function isFilterText(input, key = {}) {
  if (!input || key.ctrl || key.meta || key.return || key.tab || key.escape) return false;
  return !/[\x00-\x1f\x7f]/.test(input);
}

/** How a role from `controlParts` or `filterUnderline` maps to a theme role. */
export const ROLE_COLOUR = { accent: 'accent', dim: 'muted', plain: null };
