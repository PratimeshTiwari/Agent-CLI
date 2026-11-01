/**
 * How big a theme preview `/theme` can afford (`components/ThemePreview.jsx`).
 *
 * The box is what makes the sample read as a sample rather than more of the
 * list (owner, 2026-10-30). It is also three to five rows the live frame has to
 * pay for, so it is the first thing to shrink: the palettes are the choice and
 * are never given up for it. Pure, so the arithmetic is tested without Ink.
 */

/** Rows each size draws, borders included. */
export const PREVIEW_ROWS = { full: 7, boxed: 4, rows: 2 };

/**
 * The largest preview that leaves every palette visible.
 *
 * @param {(extra: number) => {room: number}} fit the menu's own `fit`, given the
 *   rows drawn besides the list
 * @param {number} choices how many palettes the list shows
 * @param {number} besides rows the menu draws besides the list and the preview
 * @returns {'full'|'boxed'|'rows'}
 */
export function previewSize(fit, choices, besides = 0) {
  for (const size of ['full', 'boxed']) {
    if (fit(besides + PREVIEW_ROWS[size]).room >= choices) return size;
  }
  return 'rows';
}
