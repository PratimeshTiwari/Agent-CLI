/**
 * Fitting the live frame to the screen: the reply being written, running commands and the
 * approval box, each charged to the rows it is given.
 *
 * Split out of `format.js` (v8.4) along the groups it already had.
 */


/**
 * The agent's reply, bounded while the turn is still in the live frame.
 *
 * **This row was unbounded, and it is the one rule this directory has.** A
 * live turn lives in Ink's repainted frame, and a frame taller than the
 * viewport makes Ink write `ESC[2J ESC[3J` and repaint on *every* render —
 * which destroys the terminal's scrollback. `shown` in `TranscriptTurn`
 * carefully caps the action rows at `liveBudget`; the reply underneath then
 * rendered in full regardless.
 *
 * Reported as "it gave me much more output but I received only a portion of
 * it". The text was never lost — `history.jsonl` held all of it and
 * `renderMarkdown` returns all of it, both checked — it was never drawn.
 *
 * **The first version of this counted `\n`, and that was the same bug again.**
 * A 1,450-character reply is 18 source lines and **26 rendered rows at 100
 * columns**, so an 18-line clamp against a 14-row budget passed untouched
 * while the frame still overflowed by twelve rows. This file's own rule says
 * it: a row that wraps is two. So the budget is spent in *wrapped* rows, at
 * the width the terminal actually is.
 *
 * Clamped only while live. The committed copy goes to `<Static>`, is written
 * once and never repainted, and is the one the user reads — so it stays
 * whole, and the rest of the reply appears there a moment later.
 */
export function liveMessageText(text, budget, width = 80) {
  const maxRows = Math.max(3, (Number(budget) || 12) - 2);
  const cols = Math.max(20, Number(width) || 80);
  const source = String(text ?? '');
  const lines = source.split('\n');

  // How many rows each source line will actually occupy once wrapped.
  const rowsFor = (line) => Math.max(1, Math.ceil(line.length / cols));

  let used = 0;
  let kept = 0;
  for (const line of lines) {
    const next = used + rowsFor(line);
    // The marker costs a row of its own, so stop while there is room for it.
    if (kept > 0 && next > maxRows - 1) break;
    used = next;
    kept += 1;
  }
  if (kept >= lines.length) return source;

  return `${lines.slice(0, kept).join('\n')}\n… +${lines.length - kept} more lines`;
}

/** How many output lines a running command shows under its row. */
export const RUNNING_OUTPUT_LINES = 5;

/**
 * The block of calls still running, and what it costs the live frame.
 *
 * The calls share the turn's rows: the turn keeps two (its newest step and the
 * `so far` tally) and this block is the first thing to shrink. A running
 * `run_command` also shows the last lines of its output under its row, as
 * Claude Code's Bash rows do — and those lines come out of the same budget,
 * after the call rows, so a short terminal drops the output before it drops a
 * call and never draws a row it has not paid for. An unbounded live row is the
 * flicker bug (CLAUDE.md, "The live frame must never outgrow the viewport").
 *
 * @param {object[]} calls - running calls, oldest first; `output` is the tail
 * @param {number} liveBudget - rows the live frame may use for the turn and this
 * @returns {{calls: object[], outputFor: (number|null), output: string[], rows: number}}
 */
export function runningLayout(calls = [], liveBudget = 0, { compact = false, maxOutput = RUNNING_OUTPUT_LINES } = {}) {
  const margin = compact ? 0 : 1;
  const fits = Math.min(calls.length, Math.floor(liveBudget / 2), liveBudget - 2 - margin);
  const shown = fits > 0 ? calls.slice(-fits) : [];
  // The newest call with output: commands run one at a time, but a subagent
  // started beside one must not take its lines.
  const watched = [...shown].reverse().find((c) => Array.isArray(c.output) && c.output.length);
  const spare = liveBudget - 2 - margin - shown.length;
  const output = watched && spare > 0 ? watched.output.slice(-Math.min(maxOutput, spare)) : [];
  const rows = shown.length === 0 ? 0 : shown.length + output.length + margin;
  return { calls: shown, outputFor: output.length ? watched.id : null, output, rows };
}

/**
 * The command approval box, laid out to the rows it may have.
 *
 * It is drawn where the input box was, and was charged as the input's three
 * rows — while it drew borders, a padded title, a command that wraps, the
 * directory and the reason, which wrap too, and four options. With a long
 * command that was fifteen rows or more against three, and the in-flight turn
 * above it kept its whole budget, so the frame outgrew a 16-row terminal and
 * cleared on every render while the box was up. Measured under the pty,
 * 2026-10-26: 15 `ESC[2J` at 16 rows, all with the box on screen.
 *
 * So every row is decided here, pre-wrapped at the panel's width and drawn
 * truncated, and App charges `rows` against the live turn. What gives way
 * first is the gap above the choices, then the reason, then the directory,
 * then the rule — **never the command**, which is the thing being approved. When even the
 * command does not fit, the title says how much of it is not shown rather
 * than hiding it (on the title row, because a row of its own is the row there
 * is no room for).
 *
 * Since 2026-10-26 it is drawn like every other menu (`frontend/menus/panel.js`): a rule
 * in the risk colour and no border, which is two rows and four columns back.
 *
 * @param {{command?: string, cwd?: string, riskReason?: string}} payload
 * @param {{width?: number, maxRows?: number}} [room]
 * @returns {{command: string[], hidden: number, ruled: boolean, cwd: boolean, reason: boolean, padded: boolean, rows: number}}
 */
export function approvalLayout(payload = {}, { width = 80, maxRows = Infinity } = {}) {
  const RULE = 1;
  const TITLE = 1;
  // An external write (v8.1) offers Send and Don't send: no "always" either way.
  const external = payload.kind === 'external';
  const OPTIONS = external ? 2 : 4;
  const inner = Math.max(10, width - 2);                       // the panel's one-column indent
  const all = [];
  const source = external ? (payload.lines || String(payload.command ?? '').split('\n')) : String(payload.command ?? '').split('\n');
  source.forEach((line, i) => {
    let rest = (external ? '' : i === 0 ? 'Command: ' : '  ') + line;
    while (rest.length > inner) { all.push(rest.slice(0, inner)); rest = `  ${rest.slice(inner)}`; }
    all.push(rest);
  });
  let room = maxRows - TITLE - OPTIONS;
  const shown = Math.max(1, Math.min(all.length, room));
  room -= shown;
  // The rule is the last thing to go before the command: at the smallest
  // heights it is the row the old borderless fallback did not spend.
  const ruled = room >= RULE;
  room -= ruled ? RULE : 0;
  // An external write names its site on the title row, not on a row of its own.
  const cwd = !external && room >= 1 && Boolean(payload.cwd);
  room -= cwd ? 1 : 0;
  const reason = room >= 1 && Boolean(payload.riskReason);
  room -= reason ? 1 : 0;
  const padded = room >= 1;
  const rows = (ruled ? RULE : 0) + TITLE + shown + (cwd ? 1 : 0) + (reason ? 1 : 0) + (padded ? 1 : 0) + OPTIONS;
  return { command: all.slice(0, shown), hidden: all.length - shown, ruled, cwd, reason, padded, rows };
}
