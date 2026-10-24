/**
 * Leaving the CLI: keep the session on screen and say how to come back.
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
import { leave } from '../core/restart.js';


let ink = null;

/** cli-ui hands over the Ink instance so the farewell can unmount it first. */
export function registerInk(instance) {
  ink = instance;
}

/**
 * What is left in the terminal.
 *
 * `--workspace` is added only when the workspace is not where you are
 * standing, because `agent` takes its workspace from the current directory
 * and a command that resumes nothing from here is the wrong offer.
 *
 * @param {string|null} id - the live conversation's id, null when there is none worth resuming
 */
export function farewellText(id, { workspace = null, cwd = process.cwd() } = {}) {
  // Nothing worth resuming: say nothing. The screen above already shows
  // that nothing happened, and a sentence about it is noise on every exit.
  if (!id) return '';
  const where = workspace && workspace !== cwd ? ` --workspace ${quoteIfNeeded(workspace)}` : '';
  return `\n  Resume this conversation with: agent --resume ${id}${where}\n\n`;
}

function quoteIfNeeded(p) {
  return /[\s'"$`\\]/.test(p) ? `'${String(p).replace(/'/g, `'\\''`)}'` : p;
}

/** The farewell for this loop's conversation. Allocates its live id if needed. */
export function farewellFor(agentLoop, cwd = process.cwd()) {
  const store = agentLoop?.sessionStore;
  let id = null;
  try {
    id = store?.hasUserTurn?.() ? store.liveId() : null;
  } catch {
    id = null; // a farewell must never stop the exit
  }
  return farewellText(id, { workspace: agentLoop?.workspace, cwd });
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
  try { ink?.clear?.(); } catch { /* going anyway */ }
  try { ink?.unmount(); } catch { /* going anyway */ }
  try { out.write(farewellFor(agentLoop)); } catch { /* going anyway */ }
  if (exit) return exit(code); // test seam: `leave` ends in process.exit
  await leave(code, { wsServer, agentLoop, delay: 0 });
}

/** Test seam. */
export function _resetFarewell() {
  leaving = false;
  ink = null;
}
