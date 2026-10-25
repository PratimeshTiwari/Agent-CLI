/**
 * The one look every menu shares, in numbers.
 *
 * Owner, 2026-10-26, with screenshots of `/settings`, `/effort` and the
 * allowlist: "all these boxes are sort of unorganized, and do not follow a
 * common design theme … revamp all these boxes to something minimal and
 * modern". Each menu had grown its own box — bordered, padded, an emoji in the
 * title, a paragraph that wrapped to however many rows it liked — and `/help`
 * had just been rebuilt without one and was the screen they liked.
 *
 * So every menu is now `/help`'s shape: a rule, a title, at most two dim lines
 * saying what it is for, the choices, one line of keys. No border, no padding.
 * These functions decide how many rows each part gets, because a menu is drawn
 * where the input box was and every row it takes must be one it was given
 * (`CLAUDE.md`: a row that wraps is a row nobody paid for).
 *
 * Pure and `.js`, so `node --test` can import it.
 */

/** Words onto at most `max` lines of `width`; the last one says it was cut. */
export function wrapLines(text, width, max = Infinity) {
  const w = Math.max(4, width);
  const out = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= w) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  const cut = (s) => (s.length > w ? `${s.slice(0, w - 1)}…` : s);
  if (out.length <= max) return out.map(cut);
  const kept = out.slice(0, Math.max(0, max));
  if (kept.length) kept[kept.length - 1] = `${kept[kept.length - 1].slice(0, w - 1)}…`;
  return kept.map(cut);
}

/**
 * What a panel can afford at this height.
 *
 * Short terminals lose the spacing first, then the description — never a
 * choice. `extra` is the rows the caller draws besides the list (a filter
 * field, a hint, a preview).
 *
 * @returns {{sub: string[], tight: boolean, room: number}} `room` is the rows
 *          left for the list itself
 */
export function panelRoom({ rows = 20, width = 80, subtitle = '', extra = 0 } = {}) {
  const tight = rows < 12;
  const maxSub = rows >= 16 ? 2 : rows >= 12 ? 1 : 0;
  const sub = subtitle ? wrapLines(subtitle, Math.max(10, width - 2), maxSub) : [];
  // rule + title (+ blank) … (+ blank) + keys
  const furniture = 2 + (tight ? 0 : 2) + sub.length + 1 + extra;
  return { sub, tight, room: Math.max(1, rows - furniture) };
}

/**
 * Which slice of a list to draw in `room` rows with the cursor in view, and
 * whether a `↑ N more` / `↓ N more` row goes above or below it. The marker
 * rows come out of `room`, so the list is never taller than it was given.
 *
 * @returns {{start: number, end: number, above: number, below: number}}
 *          `above`/`below` are how many items are hidden on each side
 */
export function listWindow({ count, cursor = 0, room }) {
  const r = Math.max(1, room);
  if (count <= r) return { start: 0, end: count, above: 0, below: 0 };
  const at = Math.max(0, Math.min(cursor, count - 1));
  if (r < 3) {
    const start = Math.max(0, Math.min(at, count - r));
    return { start, end: start + r, above: start, below: count - start - r };
  }
  // Items shown when the window starts at `s`, after its markers.
  const shown = (s) => {
    let n = r - (s > 0 ? 1 : 0);
    if (s + n < count) n -= 1;
    return n;
  };
  let start = Math.max(0, at - Math.floor((r - 2) / 2));
  start = Math.min(start, count - (r - 1));
  if (at >= start + shown(start)) start = at - shown(start) + 1;
  if (at < start) start = at;
  const end = start + shown(start);
  return { start, end, above: start, below: count - end };
}

/** A path cut from the left, so the end — the part that names it — stays. */
export function cutStart(text, width) {
  const s = String(text ?? '');
  const w = Math.max(2, width);
  return s.length > w ? `…${s.slice(s.length - (w - 1))}` : s;
}
