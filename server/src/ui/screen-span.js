/**
 * Where on the screen the agent started, so exit can give the rows back.
 *
 * Asked for on 2026-10-25 with a screenshot of Claude Code's exit: the shell
 * line that launched it, a blank row, `Resume this session with:` and the
 * command, then the shell prompt — everything the session drew gone, and
 * everything above it untouched. Clearing the whole screen and scrollback
 * (what exit did for an hour before that) took the shell's history with it.
 *
 * Without an alternate screen the only way to erase exactly our rows is to
 * know where they start. The terminal says where the cursor is when asked
 * (`ESC[6n`, answered `ESC[<row>;<col>R`); this follows every byte written
 * after that and keeps the row the session began on, moving it up whenever
 * the terminal scrolls. Exit asks the terminal again and rewinds only when
 * the answer matches what was followed — anything that went unseen (a line
 * the terminal wrapped, a reflow on resize) makes the two disagree, and then
 * exit clears instead of erasing someone's shell output by mistake.
 *
 * It gives up for good when the session's first row scrolls off the top, or
 * the app clears the screen itself (ctrl+e, a theme change): the shell line
 * is gone by then and there is nothing left to rewind to.
 *
 * Pure: nothing here touches a stream.
 */

/** A cursor-position report, as the terminal sends it back on stdin. */
export const CURSOR_REPORT = /\x1b\[(\d+);(\d+)R/;
export const ASK_CURSOR = '\x1b[6n';

const SEQUENCE = /\x1b\[([?>=]?)([\d;]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[\]]|\n|\r/g;

/**
 * @param {object} opts
 * @param {number} opts.rows - the terminal's height
 */
export function createScreenSpan({ rows }) {
  let height = Math.max(1, rows || 24);
  let row = null; // where the cursor is now, 1-based; null until the terminal answers
  let top = null; // the first row this session wrote on
  let lost = false;
  const pending = [];

  const feedOne = (text) => {
    SEQUENCE.lastIndex = 0;
    let m;
    while ((m = SEQUENCE.exec(text))) {
      const [all, private_, params, final] = m;
      if (all === '\n') {
        if (row >= height) top -= 1; // the terminal scrolled
        else row += 1;
      } else if (all === '\r' || final === undefined || private_) {
        // column moves, OSC, two-byte escapes, private modes: no row change
      } else {
        const n = Number(params.split(';')[0]) || 1;
        if (final === 'A' || final === 'F') row = Math.max(1, row - n);
        else if (final === 'B' || final === 'E') row = Math.min(height, row + n);
        else if (final === 'H' || final === 'f') row = Math.min(height, Number(params.split(';')[0]) || 1);
        else if (final === 'S') top -= n;
        else if (final === 'J' && (params === '2' || params === '3')) lost = true;
      }
      if (top < 1) lost = true;
    }
  };

  return {
    /** Everything written to the terminal, in order. Buffered until `start`. */
    feed(chunk) {
      if (lost) return;
      const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';
      if (!text) return;
      if (row === null) pending.push(text);
      else feedOne(text);
    },
    /** The terminal's answer to the first question: where the session begins. */
    start(reportedRow) {
      if (row !== null || !(reportedRow >= 1)) return;
      row = reportedRow;
      top = reportedRow;
      for (const text of pending.splice(0)) feedOne(text);
    },
    resize(newRows) {
      // A terminal that reflows on resize moves rows this cannot see; the
      // check at exit catches that. Height still matters for scrolling.
      height = Math.max(1, newRows || height);
    },
    /**
     * The row to rewind to, or null to clear instead.
     * @param {number|null} reportedRow - the terminal's answer at exit
     */
    rewindTo(reportedRow) {
      if (lost || row === null || top === null || top < 1) return null;
      if (reportedRow !== row) return null;
      return top;
    },
    peek: () => ({ row, top, lost, height }),
  };
}

/** Move to the first row the session drew on and erase from there down. */
export function rewindSequence(top) {
  return `\x1b[${top};1H\x1b[J`;
}

/**
 * How the screen is cleared on the way in.
 *
 * A newline per row scrolls whatever is visible into the scrollback, so the
 * last session's footer and the shell line are one scroll away rather than
 * gone (v5.24). VS Code's terminal is the exception: its sticky scroll pins
 * the command line of the running command over the top row as soon as that
 * line leaves the screen — so scrolling `% agent` away put it on top of the
 * header's first row, cut in half (reported 2026-10-26 with a screenshot).
 * There the visible screen is erased in place instead: the row VS Code marked
 * as the command's start stays on screen (it now holds the header), so nothing
 * is pinned until the transcript itself scrolls, which is what sticky scroll is
 * for. The cost is that what was on screen is erased rather than kept; what was
 * already in the scrollback stays.
 */
export function enterSequence({ rows = 24, env = process.env } = {}) {
  if (env.TERM_PROGRAM === 'vscode') return '\x1b[H\x1b[J';
  return '\n'.repeat(Math.max(1, rows)) + '\x1b[H';
}
