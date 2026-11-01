/**
 * Text measured and fitted to the terminal: visible width, ANSI-aware wrapping, columns, one-line
 * summaries and shortened paths. Everything else that draws text builds on this.
 *
 * Split out of `format.js` (v8.4) along the groups it already had.
 */


// Colour, and OSC 8 links (v7.9): marked-terminal wraps a URL in one, and its
// bytes were counted as columns, so a link wrapped mid-URL with room to spare.
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ESCAPE_AT = /^(?:\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\))/;
export const visibleWidth = (s) => String(s).replace(ANSI, '').length;

/**
 * Wrap to `width` columns without cutting an escape sequence in half.
 *
 * Walks the string rather than wrapping the stripped copy, because a cell can
 * contain an inline code span and re-emitting it uncoloured to make the
 * arithmetic easy would lose the one thing that marks it as code. Escapes
 * cost zero columns and travel with the text.
 *
 * Breaks at the last space that fits; a token longer than the column is cut,
 * because the alternative is a row wider than the table claims to be.
 */
export function wrapAnsi(text, width) {
  const w = Math.max(1, width);
  const out = [];
  let line = '';
  let col = 0;
  let lastSpace = -1;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\x1b') {
      const m = ESCAPE_AT.exec(text.slice(i));
      if (m) { line += m[0]; i += m[0].length - 1; continue; }
    }
    const ch = text[i];
    if (ch === '\n') { out.push(line); line = ''; col = 0; lastSpace = -1; continue; }
    // A break can land just before a space — the hard-cut path especially —
    // and a continuation line that opens with one is off by a column against
    // every other row in the cell.
    if (ch === ' ' && col === 0) continue;
    // Broken when a character would *overflow* the row, not when the row is
    // full (v7.10): `3.1 Flash-Lite` in a 14-column cell wrapped to two lines
    // although it fits exactly, in every table, a column short every time.
    if (col >= w) {
      if (ch === ' ') { out.push(line); line = ''; col = 0; lastSpace = -1; continue; }
      // Break at the last space if there was one, so words stay whole.
      if (lastSpace > 0) {
        out.push(line.slice(0, lastSpace));
        line = line.slice(lastSpace + 1);
        col = visibleWidth(line);
      } else {
        out.push(line);
        line = '';
        col = 0;
      }
      lastSpace = -1;
    }
    if (ch === ' ') lastSpace = line.length;
    line += ch;
    col += 1;
  }
  if (line.length > 0 || out.length === 0) out.push(line);
  return out;
}

/**
 * Fit column widths into the terminal, taking from the widest first.
 *
 * Proportional shrinking is the obvious approach and is wrong here: it takes
 * as much from a 6-column `Status` as from a 70-column `Verdict`, and the
 * narrow columns are the ones that cannot afford it. Taking from the widest
 * each round converges on "every column as wide as it needs, and the prose
 * column absorbs the shortfall", which is what a person does by hand.
 */
export function fitColumns(natural, budget, min = 6) {
  const cols = [...natural];
  // Two border columns per cell (`│ ` and ` `), plus the closing `│`.
  const chrome = cols.length * 3 + 1;
  let total = cols.reduce((a, b) => a + b, 0) + chrome;
  // A guard, not a loop bound: every round removes a column from the widest,
  // so it terminates — but a bug here would hang the renderer, and this is on
  // the path that draws every reply.
  for (let guard = 0; total > budget && guard < 10000; guard += 1) {
    const widest = cols.indexOf(Math.max(...cols));
    if (cols[widest] <= min) break;
    cols[widest] -= 1;
    total -= 1;
  }
  return cols;
}

/** Collapse any value to a single line of at most `max` characters. */
export function oneLine(value, max = 60) {
  const text = String(typeof value === 'string' ? value : JSON.stringify(value ?? {}))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * `app/models/billing/invoice.rb` in `max` characters as `app/…/invoice.rb`.
 *
 * It was the last `max - 1` characters with `…` in front, which in a monorepo
 * is `…ling/invoices/line_item.rb` — the first directory, which says *which*
 * part of the repo, was always the part removed. Keeps the first segment and
 * the most trailing segments that fit; falls back to the tail when even the
 * file name does not fit.
 */
export function shortenPath(p, max) {
  if (p.length <= max) return p;
  const parts = p.split('/');
  if (parts.length < 3) return `…${p.slice(-(max - 1))}`;
  // '' for an absolute path, so it comes out `/…/tail` — `'/'` here gave `//…/`.
  const head = parts[0];
  let tail = parts[parts.length - 1];
  for (let i = parts.length - 2; i > 0; i--) {
    const next = `${parts[i]}/${tail}`;
    if (`${head}/…/${next}`.length > max) break;
    tail = next;
  }
  const out = `${head}/…/${tail}`;
  return out.length <= max ? out : `…${p.slice(-(max - 1))}`;
}


/** The raw index just past `cols` visible columns of `s`, escapes included. */
function indexAtColumn(s, cols) {
  let col = 0;
  let i = 0;
  while (i < s.length && col < cols) {
    if (s[i] === '\x1b') {
      const m = ESCAPE_AT.exec(s.slice(i));
      if (m) { i += m[0].length; continue; }
    }
    i += 1;
    col += 1;
  }
  // Take any escapes that sit on the boundary, so a colour opened right after
  // a bullet stays with the text it colours.
  while (s[i] === '\x1b') {
    const m = ESCAPE_AT.exec(s.slice(i));
    if (!m) break;
    i += m[0].length;
  }
  return i;
}

/**
 * Every rendered line fitted to `width`, continuation rows under the text
 * (v6.12).
 *
 * Ink used to do this wrapping, and got two things wrong in a way that showed
 * on every long reply. It keeps the space it broke at, so each continuation
 * row opened one column right of the text; and it knows nothing about lists,
 * so a wrapped bullet ran back under its own `◦` (reported with a
 * screenshot). Wrapped here, a bullet's rows hang at the text column and every
 * row is exactly as wide as it claims, which is what lets the frame budget
 * count it.
 *
 * The hang is the line's indent plus its marker (`◦ `, `12. `, `[ ] `), read
 * from the visible text. Fenced code is still a sentinel when this runs, so it
 * is never re-wrapped, and tables are already fitted to `width`.
 */
export function fitLines(text, width) {
  const w = Math.max(10, Number(width) || 80);
  return String(text).split('\n').map((line) => {
    if (visibleWidth(line) <= w) return line;
    const plain = line.replace(ANSI, '');
    const m = /^( *)(?:(?:◦|•|\*|-|\d+\.) )?(?:\[[ xX]\] )?/.exec(plain);
    let hang = m ? m[0].length : 0;
    // A marker on a line too narrow for its own text is not worth a hang.
    if (hang > w / 2) hang = 0;
    const cut = indexAtColumn(line, hang);
    const rows = wrapAnsi(line.slice(cut), w - hang);
    return rows.map((row, i) => (i === 0 ? line.slice(0, cut) : ' '.repeat(hang)) + row).join('\n');
  }).join('\n');
}

/**
 * Lay text out as a full-width block, for the user's own message.
 *
 * Ink's `backgroundColor` paints the *characters*, not the line, so a
 * background applied to ordinary text stops where the words stop — a ragged
 * highlight rather than the bar Claude Code draws. Getting a bar means wrapping
 * and padding here rather than letting Ink wrap, because only the side doing
 * the wrapping can pad each resulting line.
 *
 * Padded to `width - 1`, not `width`. Filling the final column leaves the
 * cursor in a deferred-wrap state that some terminals resolve by moving to the
 * next line — which would insert a blank row per line of the block, and rows
 * that appear without being budgeted are how the live frame outgrows the
 * viewport.
 *
 * Long words are broken rather than allowed to overhang: a path or a URL wider
 * than the terminal would otherwise push past the padding and break the bar on
 * exactly the messages most likely to contain one.
 *
 * @param {string} text
 * @param {number} width - the terminal's column count
 * @param {number} [indent] - columns the caller draws before the text
 * @returns {string[]} one padded line per rendered row
 */
export function blockLines(text, width, indent = 0) {
  const inner = Math.max(8, (Number(width) || 80) - 1 - indent);
  const out = [];

  for (const paragraph of String(text ?? '').split('\n')) {
    if (paragraph === '') { out.push(''.padEnd(inner)); continue; }
    let line = '';
    for (const word of paragraph.split(' ')) {
      let w = word;
      // A single word longer than the line gets broken, not overhung.
      while (w.length > inner) {
        if (line) { out.push(line.padEnd(inner)); line = ''; }
        out.push(w.slice(0, inner));
        w = w.slice(inner);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= inner) line += ` ${w}`;
      else { out.push(line.padEnd(inner)); line = w; }
    }
    out.push(line.padEnd(inner));
  }
  return out;
}
