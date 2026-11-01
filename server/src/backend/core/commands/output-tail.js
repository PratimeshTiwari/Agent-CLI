/**
 * The last few lines of a running command, for the screen.
 *
 * `run_command` used to be silent until it exited: a two-minute test run was a
 * `◌ run_command` row and a spinner, and the only way to know whether it was
 * making progress or stuck on a prompt was to wait out the timeout. Claude
 * Code draws the tail of a running Bash call under its row; this is what feeds
 * that row here.
 *
 * Three things a raw chunk stream gets wrong on a screen, all handled here so
 * the renderer only ever sees finished, printable lines:
 *
 * - **Chunks are not lines.** A chunk can end mid-line, and that partial line
 *   is the one being written — it is shown, and replaced when it completes.
 * - **`\r` rewrites a line.** Progress bars (`npm install`, `curl`, test
 *   runners) redraw one line hundreds of times. Only the text after the last
 *   `\r` is what a terminal would be showing.
 * - **Escapes and control bytes are not text.** Colour codes that ignored
 *   `NO_COLOR` would be counted as width and drawn as garbage; a tab is an
 *   unknown width. Stripped and expanded before anything measures them.
 *
 * And it is **throttled**: a chatty command writes thousands of chunks a
 * second, and every emit is a React render of the live frame. Leading edge so
 * the first line appears at once, trailing edge so the last line is never
 * left unshown.
 *
 * What the model receives is untouched — this is a view, and `run-command.js`
 * still returns the whole captured output.
 */
import { stripAnsi } from '../../mcp/tools/run-command.js';

/** How many lines a running command shows, as Claude Code does. */
export const TAIL_LINES = 5;

/** Emit at most this often. Four frames a second reads as live and costs little. */
export const TAIL_EVERY_MS = 250;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** One line as a terminal would be showing it. */
export function cleanLine(raw) {
  // A trailing `\r` is a CRLF line end (or a bar about to redraw), not a
  // rewrite to nothing — dropping it first keeps Windows-style output visible.
  const afterCr = String(raw).replace(/\r+$/, '').split('\r').pop();
  return stripAnsi(afterCr).replace(/\t/g, '  ').replace(CONTROL, '').trimEnd();
}

/**
 * @param {object} opts
 * @param {(view: {lines: string[], total: number}) => void} opts.emit
 * @param {number} [opts.keep]
 * @param {number} [opts.everyMs]
 * @param {() => number} [opts.now] - test seam
 * @param {Function} [opts.setTimer] - test seam
 * @param {Function} [opts.clearTimer] - test seam
 */
export function createOutputTail({
  emit,
  keep = TAIL_LINES,
  everyMs = TAIL_EVERY_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let done = [];     // the last `keep` completed lines, cleaned
  let completed = 0; // every completed line, for "+N lines"
  let partial = '';  // the line still being written, raw
  let lastEmit = -Infinity;
  let timer = null;
  let stopped = false;

  const view = () => {
    const current = partial ? cleanLine(partial) : '';
    const lines = current ? [...done, current] : done.slice();
    return { lines: lines.slice(-keep), total: completed + (current ? 1 : 0) };
  };

  const fire = () => {
    timer = null;
    if (stopped) return;
    lastEmit = now();
    try { emit(view()); } catch { /* a view must never break the command */ }
  };

  return {
    push(chunk) {
      if (stopped || chunk == null) return;
      const parts = (partial + String(chunk)).split('\n');
      partial = parts.pop();
      for (const line of parts) {
        done.push(cleanLine(line));
        completed += 1;
      }
      if (done.length > keep) done = done.slice(-keep);

      if (timer) return;
      const wait = everyMs - (now() - lastEmit);
      if (wait <= 0) fire();
      else timer = setTimer(fire, wait);
    },
    /** No more output: cancel the pending emit. The result replaces the view. */
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
    /** For tests. */
    peek: view,
  };
}
