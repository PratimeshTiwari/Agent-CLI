/**
 * Application chords, taken off the wire before Ink sees them.
 *
 * `ink-text-input` types *any* key it does not recognise into the field — its
 * handler special-cases exactly one chord, ctrl+c — so ctrl+e, ctrl+o, ctrl+t
 * and ctrl+v each fired their binding *and* left a stray "e", "o", "t" or "v"
 * in the prompt. There is no way to stop a `useInput` handler from running:
 * Ink calls every listener, and the text field's is registered first because
 * child effects run before the parent's.
 *
 * So these bytes never reach Ink's input channel at all. `cli-ui.jsx` pulls
 * them out of the stdin chunk and emits them here; `use-hotkeys.js` subscribes.
 * That is what keeps typed characters — and only typed characters — in the
 * writing area.
 *
 * ctrl+c is `interrupt` since v5.4, and Ink no longer owns it (`exitOnCtrlC:
 * false`). Ink's handler unmounted the app and left the process running behind
 * a dead prompt, so leaving took two presses with a frozen screen between them.
 * Exiting must keep working even if the UI has a bug, so the *decision* to exit
 * is not made in React at all: cli-ui counts the presses on the raw stream and
 * exits on the second within `EXIT_WINDOW_MS`. React only draws the first.
 */

import { EventEmitter } from 'node:events';

/** Chord byte -> event name. */
export const HOTKEYS = {
  '\x05': 'expand',       // ctrl+e — expand/collapse the transcript
  '\x14': 'terminal',     // ctrl+t — the scratch shell
  '\x16': 'paste-image',  // ctrl+v — attach an image from the clipboard
  '\x15': 'clear-input',  // ctrl+u — wipe the prompt, as readline has always done
  '\x17': 'delete-word',  // ctrl+w — delete the word behind the cursor
  '\x19': 'copy-code',    // ctrl+y — the last code block in the transcript
  // ctrl+o — the task list. Was ctrl+g, which Chrome takes system-wide on macOS
  // for its own Gemini panel: pressing it in the terminal opened Chrome instead.
  '\x0f': 'artifacts',
  '\x02': 'focus-browser', // ctrl+b — bring the Gemini tab to the front
  // ctrl+x then ctrl+s — steer the last queued prompt into the running turn
  // (2026-10-25). Raw mode clears IXON, so ctrl+s arrives as a byte instead of
  // freezing the terminal. Both are pulled here or ink-text-input would type
  // their letters into the prompt.
  '\x18': 'steer-arm',
  '\x13': 'steer',
  '\x03': 'interrupt',    // ctrl+c — clear the prompt; twice to exit (cli-ui decides)
};

/** Two ctrl+c presses inside this window exit, as in Claude Code. */
export const EXIT_WINDOW_MS = 2000;

/**
 * The double-press rule, as a function cli-ui can call and a test can drive.
 *
 * @returns {(now?: number) => 'first' | 'exit'}
 */
export function interruptGate(windowMs = EXIT_WINDOW_MS) {
  let last = -Infinity;
  return (now = Date.now()) => {
    if (now - last < windowMs) return 'exit';
    last = now;
    return 'first';
  };
}

/** ctrl+s counts as the second half of the chord only this soon after ctrl+x. */
export const STEER_WINDOW_MS = 1500;

/**
 * The two-key chord, as a function App can call and a test can drive. `arm` on
 * ctrl+x; `fire` on ctrl+s answers whether the chord completed, and disarms
 * either way, so a stray ctrl+s later does nothing.
 */
export function chordGate(windowMs = STEER_WINDOW_MS) {
  let armedAt = -Infinity;
  return {
    arm(now = Date.now()) { armedAt = now; },
    fire(now = Date.now()) {
      const ok = now - armedAt <= windowMs;
      armedAt = -Infinity;
      return ok;
    },
  };
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/** The one emitter cli-ui writes to and the UI listens on. */
export const hotkeys = new EventEmitter();

/**
 * Pull chord bytes out of one stdin chunk.
 *
 * Bracketed paste is passed through untouched, markers and all: a pasted file
 * can legitimately contain a 0x05, and stripping it would corrupt the paste.
 * The paste state is returned rather than held here because a paste can span
 * several chunks.
 *
 * @param {string} text - one raw stdin chunk
 * @param {{inPaste: boolean}} [state] - carried between chunks
 * @returns {{text: string, hotkeys: string[], state: {inPaste: boolean}}}
 */
export function extractHotkeys(text, state) {
  let inPaste = state?.inPaste ?? false;
  const found = [];
  let out = '';
  let i = 0;

  while (i < text.length) {
    if (inPaste) {
      if (text.startsWith(PASTE_END, i)) {
        inPaste = false;
        out += PASTE_END;
        i += PASTE_END.length;
        continue;
      }
    } else {
      if (text.startsWith(PASTE_START, i)) {
        inPaste = true;
        out += PASTE_START;
        i += PASTE_START.length;
        continue;
      }
      const name = HOTKEYS[text[i]];
      if (name) {
        found.push(name);
        i += 1;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }

  return { text: out, hotkeys: found, state: { inPaste } };
}
