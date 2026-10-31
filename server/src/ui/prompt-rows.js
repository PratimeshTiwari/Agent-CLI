/**
 * The prompt's rows as they are drawn, not as they are typed (v7.9).
 *
 * Asked for: up and down move between the prompt's lines, and only at the top
 * or bottom row reach the previous or next prompt, as Claude Code does. A long
 * line that wraps is several rows on screen and one line in the text, so the
 * arrows went straight past it to input history, and the frame budget charged
 * it as one row while Ink drew three.
 *
 * Wrapped the way Ink wraps the field (`wrap-ansi`, `trim: false`): break after
 * the last space that fits, cut a word longer than the row. The caret cell is
 * drawn inline, so a mismatch costs a caret one row off, never a lost key.
 */

/**
 * @param {string} text
 * @param {number} width - columns the field has
 * @returns {Array<{start: number, end: number, wrapped: boolean}>} offsets into
 *   `text`, `end` exclusive; `wrapped` when the next row continues this line.
 */
export function visualRows(text, width) {
  const w = Math.max(1, Math.floor(width) || 1);
  const rows = [];
  let lineStart = 0;
  for (const line of String(text).split('\n')) {
    let start = 0;
    while (line.length - start > w) {
      const room = line.slice(start, start + w + 1);
      const space = room.lastIndexOf(' ');
      // Break after a space that fits; with none, cut the word at the edge.
      const cut = space > 0 ? start + space + 1 : start + w;
      rows.push({ start: lineStart + start, end: lineStart + cut, wrapped: true });
      start = cut;
    }
    rows.push({ start: lineStart + start, end: lineStart + line.length, wrapped: false });
    lineStart += line.length + 1;
  }
  return rows;
}

/** Which row the caret is on. At a wrap the caret belongs to the next row. */
export function rowOf(rows, offset) {
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (offset < r.end || (offset === r.end && !r.wrapped)) {
      if (offset >= r.start) return i;
    }
  }
  return rows.length - 1;
}

/**
 * The caret one row up (`-1`) or down (`1`), keeping its column, or null when
 * there is no row that way: the caller then takes the key for history.
 */
export function moveVertical(text, offset, delta, width) {
  const rows = visualRows(text, width);
  const here = rowOf(rows, offset);
  const target = here + delta;
  if (target < 0 || target >= rows.length) return null;
  const column = offset - rows[here].start;
  const row = rows[target];
  // A wrapped row's last offset is the next row's first, so stop one short.
  const last = row.wrapped ? row.end - 1 : row.end;
  return Math.min(row.start + column, Math.max(row.start, last));
}
