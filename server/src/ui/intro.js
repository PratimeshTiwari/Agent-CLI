/**
 * The header drawing itself in on every start, and a short goodbye on exit.
 *
 * Asked for on 2026-10-25: setup's splash animated and an ordinary start did
 * not, so the first impression was the only lively one. The header normally
 * goes straight into `<Static>`, which Ink writes once and can never repaint —
 * so while the intro plays it is held back and drawn in the live frame
 * instead, then committed whole. Ink erases the live copy and writes the
 * static one at the same position, so the hand-over has no visible seam.
 *
 * Pure and `.js`, so the repo's plain `node --test` can import it.
 */

export const INTRO_TICK_MS = 40;
export const OUTRO_TICK_MS = 40;
export const GOODBYE = 'Goodbye.';

// `MARK[0].length` in Banner.jsx — not imported, because a .js test cannot load .jsx.
export const MARK_WIDTH = 7;
const TEXT_LINES = 3; // byline, where, /help

/**
 * Where the intro is at a given tick: the mark sweeps in two columns a tick,
 * the name types itself out three characters a tick once the sweep is half
 * done, then the three dim lines arrive one a tick. A few ticks of hold, so
 * the last line is seen before the frame hands over.
 */
export function introFrame(tick, name = '') {
  const t = Math.max(0, tick);
  const reveal = Math.min(MARK_WIDTH, t * 2);
  const nameStart = 2;
  const nameChars = Math.min(name.length, Math.max(0, t - nameStart) * 3);
  const nameDone = nameStart + Math.ceil(name.length / 3);
  const lines = Math.min(TEXT_LINES, Math.max(0, t - nameDone));
  const done = t >= nameDone + TEXT_LINES + 3;
  return { reveal, nameChars, lines, done };
}

/** Ticks until `introFrame` says done — for tests and the hard stop. */
export function introLength(name = '') {
  let t = 0;
  while (!introFrame(t, name).done) t += 1;
  return t;
}

/**
 * Animate only where it can be seen and cannot cost anything: a terminal,
 * tall enough that the header plus the ordinary live frame stays well inside
 * the viewport (a frame as tall as the viewport makes Ink clear on every
 * render), and not when someone has asked for no motion.
 */
export function animationAllowed({ isTTY = false, rows = 0, env = process.env } = {}) {
  if (!isTTY) return false;
  if (env.AGENT_CLI_NO_ANIMATION || env.CI) return false;
  return rows >= 16;
}

/** The goodbye: the word types out, then dims. */
export function outroFrame(tick) {
  const t = Math.max(0, tick);
  const chars = Math.min(GOODBYE.length, t * 2);
  return { text: GOODBYE.slice(0, chars), dim: t > Math.ceil(GOODBYE.length / 2) + 2 };
}

/** How long exit waits for the goodbye to play. */
export const OUTRO_MS = (Math.ceil(GOODBYE.length / 2) + 6) * OUTRO_TICK_MS;
