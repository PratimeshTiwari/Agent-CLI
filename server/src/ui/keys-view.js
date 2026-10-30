/**
 * `?` on an empty prompt shows the keys (v6.18, plan Phase 9), the way Claude
 * Code does: typed as the whole input, it opens a short grid where the `/`
 * palette sits, and the next key typed closes it.
 *
 * The keys are already listed in full by `/help` (`KEY_ROWS`); this is the
 * glance, so each one gets two or three words. It is drawn in the palette's
 * place and charged the palette's rows, because a row drawn and not budgeted
 * is how the live frame outgrows the viewport.
 */

/** Short forms. Every key here is one `/help` lists (`keys-view.test.js` holds it to that). */
export const KEY_HINTS = [
  ['/', 'commands'],
  ['shift+tab', 'cycle mode'],
  ['esc', 'stop · close'],
  ['↑', 'history · take back'],
  ['ctrl+e', 'expand steps'],
  ['ctrl+o', 'task list'],
  ['ctrl+v', 'paste image'],
  ['ctrl+j', 'newline'],
  ['ctrl+u', 'clear input'],
  ['ctrl+b', 'Gemini tab'],
  ['ctrl+x ctrl+s', 'steer'],
  ['ctrl+c ×2', 'quit'],
];

const KEY_COL = 14;

/**
 * The grid for `rows` rows at `width` columns: as many columns as fit, filled
 * down then across, and when even that is too many a last cell pointing at
 * `/help`.
 *
 * @returns {Array<Array<{key: string, desc: string, width: number}>>}
 */
export function keysLayout(width, rows) {
  const avail = Math.max(1, rows);
  const cols = width >= 96 ? 3 : width >= 60 ? 2 : 1;
  const cellWidth = Math.floor(Math.max(10, width - 2) / cols);
  let items = KEY_HINTS;
  if (Math.ceil(items.length / cols) > avail) {
    items = [...KEY_HINTS.slice(0, avail * cols - 1), ['/help', 'all of them']];
  }
  const height = Math.ceil(items.length / cols);
  const grid = Array.from({ length: height }, () => []);
  items.forEach(([key, desc], i) => {
    grid[i % height].push({ key, desc, width: cellWidth });
  });
  return grid;
}

/** One cell as text: the key padded to its column, the words after. */
export function keyCell({ key, desc, width }) {
  const keyCol = Math.min(KEY_COL, Math.max(4, width - 6));
  const k = key.length >= keyCol ? `${key} ` : key.padEnd(keyCol);
  const room = Math.max(0, width - k.length - 1);
  const d = desc.length > room ? `${desc.slice(0, Math.max(0, room - 1))}…` : desc;
  return { key: k, desc: d.padEnd(room + 1) };
}
