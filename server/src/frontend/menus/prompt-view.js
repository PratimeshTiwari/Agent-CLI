/**
 * `/prompt` as a comparison, not just a list (v6.11).
 *
 * Owner, 2026-10-30, with a screenshot of the v6.10 menu: "this looks a bit
 * dull". The menu is there to choose between versions, and v2's whole claim is
 * *fewer round trips*, so the panel shows that number next to the choice: a bar
 * per version, median filled and p90 traced, scaled to the largest p90. Under
 * it, what the highlighted version changes from v1, one line per switch.
 *
 * Pure and `.js`, so `node --test` can import it. Both blocks are optional and
 * given up in that order from the bottom: the list never is.
 */

/**
 * The cells of one bar: `fill` for the median, `tail` from there to the p90.
 *
 * @returns {{fill: number, tail: number}} cell counts, fill + tail <= width
 */
export function roundsBar({ median, p90, max, width }) {
  if (median == null || !max || width < 1) return { fill: 0, tail: 0 };
  const cells = (n) => Math.max(0, Math.min(width, Math.round((n / max) * width)));
  const fill = Math.max(1, cells(median));
  const tail = Math.max(0, cells(Math.max(median, p90 ?? median)) - fill);
  return { fill, tail };
}

/**
 * Which extra blocks fit in `room` rows (what is left after the list).
 *
 * Stats: a gap, a heading and one row per version. Changes: a gap, a heading
 * and at least one line; a list cut short ends with `… +N more`.
 *
 * @returns {{stats: boolean, changes: string[]}}
 */
export function promptPanelPlan({ room, versions, changes }) {
  let left = Math.max(0, room);
  const statsRows = 2 + versions;
  const stats = left >= statsRows;
  if (stats) left -= statsRows;
  let shown = [];
  const n = left - 2;
  // A cut list needs two rows, or all it says is "… +N more".
  if (changes.length && n >= 1 && (changes.length <= n || n >= 2)) {
    shown = changes.length <= n ? changes : [...changes.slice(0, n - 1), `… +${changes.length - (n - 1)} more`];
  }
  return { stats, changes: shown };
}

/**
 * The page → opens: everything one version changes from v1, scrolled by ↑↓
 * in what `rows` leaves (v8.1: at 24 rows it still ended "… +6 more").
 * A row is given to each marker only when there is something past it.
 *
 * @returns {{lines: string[], offset: number, max: number}} `offset` clamped to `max`
 */
export function changesPage({ changes, rows, offset = 0 }) {
  const n = Math.max(1, rows);
  if (changes.length <= n) return { lines: changes, offset: 0, max: 0 };
  // Past the top marker and before the bottom one; the last page needs no
  // bottom marker, so it holds one more.
  const lastStart = changes.length - (n - 1);
  const at = Math.max(0, Math.min(offset, lastStart));
  const head = at > 0 ? [`… ${at} above`] : [];
  const room = n - head.length;
  const end = at + room >= changes.length ? changes.length : at + room - 1;
  const tail = end < changes.length ? [`… +${changes.length - end} more`] : [];
  return { lines: [...head, ...changes.slice(at, end), ...tail], offset: at, max: lastStart };
}

/** The usage line beside a bar. */
export function roundsLabel(row) {
  if (!row.turns) return 'not used yet';
  const turns = `${row.turns} turn${row.turns === 1 ? '' : 's'}`;
  return row.median == null ? turns : `median ${row.median} · p90 ${row.p90} · ${turns}`;
}
