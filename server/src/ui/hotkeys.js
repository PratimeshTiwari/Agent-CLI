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
import { splitTrailingEnter } from './enter-splitter.js';

/** Chord byte -> event name. */
export const HOTKEYS = {
  '\x05': 'expand',       // ctrl+e — expand/collapse the transcript
  '\x14': 'terminal',     // ctrl+t — retired for /shell; still taken so no stray "t"
  '\x16': 'paste-image',  // ctrl+v — attach an image from the clipboard
  '\x15': 'clear-input',  // ctrl+u — wipe the prompt, as readline has always done
  '\x17': 'delete-word',  // ctrl+w — delete the word behind the cursor
  '\x0e': 'newline',      // ctrl+n — a newline in every terminal (v7.9; ctrl+j still works)
  '\x19': 'copy-code',    // ctrl+y — retired for /copy code; still taken so no stray "y"
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
 * `parts` is the same chunk in the order it was typed — text and chords
 * interleaved — which is what cli-ui dispatches from. `text` and `hotkeys` are
 * the two halves on their own.
 *
 * @returns {{text: string, hotkeys: string[], parts: Array<{text: string} | {hotkey: string}>, state: {inPaste: boolean}}}
 */
export function extractHotkeys(text, state) {
  let inPaste = state?.inPaste ?? false;
  const found = [];
  const parts = [];
  let out = '';
  let run = '';
  let i = 0;

  while (i < text.length) {
    if (inPaste) {
      if (text.startsWith(PASTE_END, i)) {
        inPaste = false;
        out += PASTE_END;
        run += PASTE_END;
        i += PASTE_END.length;
        continue;
      }
    } else {
      if (text.startsWith(PASTE_START, i)) {
        inPaste = true;
        out += PASTE_START;
        run += PASTE_START;
        i += PASTE_START.length;
        continue;
      }
      const name = HOTKEYS[text[i]];
      if (name) {
        if (run) parts.push({ text: run });
        run = '';
        found.push(name);
        parts.push({ hotkey: name });
        i += 1;
        continue;
      }
    }
    out += text[i];
    run += text[i];
    i += 1;
  }
  if (run) parts.push({ text: run });

  return { text: out, hotkeys: found, parts, state: { inPaste } };
}

/**
 * Text and chords from one chunk, in the order they were typed.
 *
 * Chords used to fire first and the chunk's text after, which is fine until a
 * busy event loop delivers `ook at` and a ctrl+v in one read: the tag went in
 * after the `l` and the text after it. Measured under the pty, 2026-10-26. So
 * text is written to Ink and everything after it waits one turn — Ink reads on
 * `readable`, which fires before `setImmediate` — the same deferral the
 * trailing Enter has always used, for the same reason: Ink's read() drains
 * everything buffered at once, so two immediate writes would arrive as the
 * single chunk this is here to take apart.
 *
 * @param {Array<{text: string} | {hotkey: string}>} parts - `extractHotkeys().parts`
 * @param {{write: (text: string) => void, emit: (name: string) => void, defer?: (fn: () => void) => void}} io
 */
export function dispatchInOrder(parts, { write, emit, defer = setImmediate }) {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.hotkey) { emit(part.hotkey); continue; }
    const rest = parts.slice(i + 1);
    if (part.enter) write(part.enter);
    else {
      const [text, enter] = splitTrailingEnter(part.text);
      write(text);
      if (enter) rest.unshift({ enter });
    }
    if (rest.length) defer(() => dispatchInOrder(rest, { write, emit, defer }));
    return;
  }
}
