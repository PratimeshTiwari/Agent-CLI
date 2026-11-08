/**
 * The terminal's own background, for the one palette that needs it (v9.9.1).
 *
 * Reported with screenshots from Antigravity: `/theme amoled` changed every
 * ink and the page stayed the terminal's grey, because Ink paints text and
 * never the page. So a palette that names `paint` in `PALETTE_INFO` sets the
 * terminal's default background with OSC 11 (xterm.js, so VS Code, Cursor and
 * Antigravity; iTerm2, kitty, WezTerm, Ghostty), and OSC 111 hands it back:
 * on a switch to any other palette, on exit, and on a crash. A terminal that
 * does not know OSC 11 ignores it, which is the old behaviour.
 *
 * Only into a TTY: escape codes into a pipe are garbage.
 */
import { PALETTE_INFO, onThemeChange, themeName } from '../theme.js';

export const setBackground = (hex) => `\x1b]11;${hex}\x1b\\`;
export const RESET_BACKGROUND = '\x1b]111\x1b\\';

/**
 * What to write when the palette becomes `name`, given what is painted now.
 * Returns `{ write, painted }`; `write` is '' when nothing changes.
 */
export function backgroundStep(name, painted) {
  const want = PALETTE_INFO[name]?.paint || null;
  if (want === painted) return { write: '', painted };
  if (want) return { write: setBackground(want), painted: want };
  return { write: RESET_BACKGROUND, painted: null };
}

let out = null;
let painted = null;
let installed = false;

function apply(name) {
  const step = backgroundStep(name, painted);
  painted = step.painted;
  if (step.write) {
    try { out.write(step.write); } catch { /* a closed terminal has no background */ }
  }
}

/** Follow the live palette from now on, starting with the current one. */
export function installTerminalBackground(stream = process.stdout) {
  if (installed || !stream?.isTTY) return;
  installed = true;
  out = stream;
  onThemeChange(apply);
  apply(themeName());
  // A crash skips the farewell; the terminal must not stay black after it.
  process.on('exit', () => restoreTerminalBackground());
}

/** Give the terminal its own background back. What to write, so exit can put it before the footer. */
export function restoreTerminalBackground({ write = true } = {}) {
  if (!painted) return '';
  painted = null;
  if (write && out) {
    try { out.write(RESET_BACKGROUND); } catch { /* going anyway */ }
    return '';
  }
  return RESET_BACKGROUND;
}

/** Test seam. */
export function _resetTerminalBackground() {
  out = null; painted = null; installed = false;
}
