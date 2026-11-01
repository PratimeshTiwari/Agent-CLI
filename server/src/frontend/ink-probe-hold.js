/**
 * Keys typed in the first moment after Ink starts are held, then delivered
 * once (v5.30).
 *
 * Found 2026-10-27 under the pty, chasing `No such command: //help`: with a
 * warm start, `/` typed as the prompt appeared arrived in the field twice.
 * One `/` reached Ink's stdin and its input handler ran twice, 166 ms apart.
 *
 * The cause is Ink 7.1.1's kitty-keyboard auto mode (`confirmKittySupport`).
 * For 200 ms after `render()` it listens to stdin with a `data` listener of
 * its own, *beside* the reader that already handles keys, and when the window
 * closes it `unshift`s every byte that was not the terminal's answer back into
 * the stream — so a key typed in that window is handled once on arrival and
 * again when it is pushed back. A warm start puts a usable prompt on screen
 * inside the window, which is how "/doctor, almost at the same time" met it.
 *
 * We own the pipe into Ink, so the fix is here rather than a patch to Ink:
 * until the window has closed, anything that is not the terminal's reply to
 * the probe (`ESC [ ? <flags> u`) is held, and handed on in order after it.
 * The reply itself goes straight through, or the protocol is never turned on.
 */

/** The terminal's answer to Ink's `CSI ? u` probe. */
export const KITTY_REPLY = /\x1b\[\?\d*u/g;

/** Ink's window is 200 ms; a margin for a busy event loop at start-up. */
export const PROBE_WINDOW_MS = 300;

/**
 * @param {{deliver: (chunk: string) => void, now?: () => number,
 *   later?: (fn: () => void, ms: number) => unknown, windowMs?: number}} opts
 * @returns {{start: () => void, accept: (chunk: string) => void}}
 */
export function createProbeHold({ deliver, now = Date.now, later = setTimeout, windowMs = PROBE_WINDOW_MS }) {
  let until = 0;
  let held = [];
  let timer = null;

  const flush = () => {
    timer = null;
    const out = held;
    held = [];
    for (const chunk of out) deliver(chunk);
  };

  return {
    /** Call just before `render()`: the window opens with Ink's probe. */
    start() {
      until = now() + windowMs;
    },
    accept(chunk) {
      const text = String(chunk);
      if (now() >= until && held.length === 0) { deliver(text); return; }
      const replies = text.match(KITTY_REPLY) || [];
      for (const reply of replies) deliver(reply);
      const rest = text.replace(KITTY_REPLY, '');
      if (rest) held.push(rest);
      if (held.length && !timer) {
        const t = later(flush, Math.max(0, until - now()));
        timer = t;
        t?.unref?.();
      }
    },
  };
}
