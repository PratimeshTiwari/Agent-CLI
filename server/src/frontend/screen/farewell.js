/**
 * Leaving the CLI: keep the session on screen and say how to come back.
 *
 * **It clears again (2026-10-25, later the same day):** *"it should show the
 * resume conversation line and clear the agent chat … exactly how claude code
 * closes the conversation and none if no convo"*. See `exitText`. The two
 * paragraphs below are the version that kept the transcript.
 *
 * **It no longer clears (2026-10-25).** It did, on request, and the request
 * changed on seeing it: *"our agent just clears the terminal … unlike Claude
 * where the work is visible"*. Claude Code erases only its own prompt box and
 * status row and leaves the transcript in the scrollback, then prints the
 * resume command under it. Ink's `clear()` erases exactly the live frame and
 * syncs its log so the final render on unmount writes nothing — the committed
 * `<Static>` rows above it are the terminal's and stay.
 *
 * What follows is the history of the clearing version.
 *
 * Asked for: "whenever we exit, just clear the agent cli like Claude Code
 * does and display the resume session id". What exit used to leave was the
 * last live frame — prompt box, status row, maybe a half-drawn spinner —
 * frozen in the terminal, and nothing about the conversation that had just
 * ended. Ctrl+C was worse: Ink's own handler unmounted the app and left the
 * process running behind a dead prompt, so it took a second Ctrl+C (a real
 * SIGINT by then) to print "🛑 Shutting down...". Measured under the pty.
 *
 * Every way out comes through here — the double Ctrl+C, `/exit`, SIGINT and
 * SIGTERM — so there is one farewell and one order: unmount Ink first (it
 * restores the terminal, and an unmount after the clear would repaint its
 * last frame over it), clear the screen and scrollback the way `clear` does,
 * print the command, then shut the bridge and go. (Now: erase the live frame,
 * unmount, print — see the top of this comment.)
 *
 * Pure parts are exported for tests; `.js` rather than `.jsx` so the repo's
 * plain `node --test` can import it.
 */
import { leave } from '../../backend/core/install/restart.js';
import { rewindSequence } from './screen-span.js';


let ink = null;
let outro = null;
let screen = null;

/** cli-ui hands over what it knows about the screen: the span and a way to ask the cursor row. */
export function registerScreen(s) {
  screen = s;
}

/** How long exit waits for the terminal to say where the cursor is. */
export const ASK_ROW_MS = 200;

/** Root hands over its goodbye: a function whose promise settles when it has played. */
export function registerOutro(fn) {
  outro = fn;
}

/** Longest exit will wait for the goodbye, whatever it says — leaving must not hang on a render. */
export const OUTRO_CAP_MS = 600;

/** cli-ui hands over the Ink instance so the farewell can unmount it first. */
export function registerInk(instance) {
  ink = instance;
}

/**
 * What is left in the terminal — Claude Code's footer, line for line:
 *
 *     (blank)
 *     Resume this session with:
 *     agent --resume <id>
 *
 * Dim, flush left, and the shell prompt directly under it. The command is on a
 * line of its own because that line is the one you select and copy; it used to
 * share a line with the label, indented and at full brightness, with a blank
 * line after — the footnote read as louder than the work above it.
 *
 * `--workspace` is added only when the workspace is not where you are
 * standing, because `agent` takes its workspace from the current directory
 * and a command that resumes nothing from here is the wrong offer.
 *
 * @param {string|null} id - the live conversation's id, null when there is none worth resuming
 * @param {object} [opts]
 * @param {boolean} [opts.dim] - wrap each line in SGR dim. Ink is unmounted by
 *   now, so this is a raw escape; the caller decides whether the stream wants it.
 */
export function farewellText(id, { workspace = null, cwd = process.cwd(), dim = false } = {}) {
  // Nothing worth resuming: say nothing. The screen above already shows
  // that nothing happened, and a sentence about it is noise on every exit.
  if (!id) return '';
  const where = workspace && workspace !== cwd ? ` --workspace ${quoteIfNeeded(workspace)}` : '';
  // Per line rather than around the block, so a terminal that resets SGR at a
  // newline (some do) still draws the second line dim.
  const paint = (line) => (dim ? `\x1b[2m${line}\x1b[22m` : line);
  return `\n${paint('Resume this session with:')}\n${paint(`agent --resume ${id}${where}`)}\n`;
}

/**
 * Dim only into a terminal, never into a pipe or a file. Not gated on
 * `NO_COLOR`: dim is an attribute rather than a colour, and the `mono` palette
 * that `NO_COLOR` selects keeps bold and dim for the same reason.
 */
export function wantsDim(out = process.stdout) {
  return Boolean(out?.isTTY);
}

function quoteIfNeeded(p) {
  return /[\s'"$`\\]/.test(p) ? `'${String(p).replace(/'/g, `'\\''`)}'` : p;
}

/** The farewell for this loop's conversation. Allocates its live id if needed. */
export function farewellFor(agentLoop, { cwd = process.cwd(), dim = false } = {}) {
  const store = agentLoop?.sessionStore;
  let id = null;
  try {
    id = store?.hasUserTurn?.() ? store.liveId() : null;
  } catch {
    id = null; // a farewell must never stop the exit
  }
  return farewellText(id, { workspace: agentLoop?.workspace, cwd, dim });
}

/** `clear`: screen, scrollback, cursor home. */
export const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';

/**
 * What exit writes (2026-10-25, the owner's third and fourth calls on this):
 * the session's rows go and the shell's stay — the line that launched the
 * agent, a blank row, the resume command — the way Claude Code closes; nothing
 * at all when there was no conversation. That needs the row the session began
 * on (`screen-span.js`); when it is unknown or has scrolled away, the screen
 * and scrollback are cleared and the footer goes at the top.
 * Cleared only into a terminal; a pipe or a file gets the footer alone, since
 * escape codes there are garbage and there is no screen to give back.
 */
export function exitText(agentLoop, out = process.stdout, { rewindTo = null } = {}) {
  const tty = Boolean(out?.isTTY);
  const footer = farewellFor(agentLoop, { dim: wantsDim(out) });
  if (!tty) return footer;
  // Claude Code's exit: erase back to the shell line that launched us, then
  // a blank row, the label and the command. Nothing at all with no
  // conversation — the shell prompt comes back right under that line.
  if (rewindTo) return rewindSequence(rewindTo) + footer;
  // Where we started is unknown or gone (scrolled off, the app cleared the
  // screen, the terminal never answered): clear, and the footer goes at the
  // top — its leading blank row separates it from nothing there.
  return CLEAR_SCREEN + footer.replace(/^\n/, '');
}

let leaving = false;

/**
 * Unmount, clear, print, go. Safe to call twice — a second Ctrl+C arriving
 * while the bridge shuts down must not print the farewell again.
 */
export async function exitWithFarewell({ agentLoop, wsServer, code = 0, out = process.stdout, exit } = {}) {
  if (leaving) return;
  leaving = true;
  // Erase the live frame (prompt box, status row) and nothing else, then
  // unmount — whose final render then has nothing left to write.
  if (outro && out?.isTTY) {
    try {
      await Promise.race([outro(), new Promise((r) => setTimeout(r, OUTRO_CAP_MS))]);
    } catch { /* going anyway */ }
  }
  try { ink?.clear?.(); } catch { /* going anyway */ }
  // Asked while Ink still holds raw mode, so the answer is not echoed.
  let rewindTo = null;
  if (screen && out?.isTTY) {
    try { rewindTo = screen.span.rewindTo(await screen.askRow(ASK_ROW_MS)); } catch { rewindTo = null; }
  }
  try { ink?.unmount(); } catch { /* going anyway */ }
  try { out.write(exitText(agentLoop, out, { rewindTo })); } catch { /* going anyway */ }
  if (exit) return exit(code); // test seam: `leave` ends in process.exit
  await leave(code, { wsServer, agentLoop, delay: 0 });
}

/** Test seam. */
export function _resetFarewell() {
  leaving = false;
  ink = null;
  outro = null;
  screen = null;
}
