/**
 * Leaving the CLI: clear the screen and say how to come back.
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
 * print the command, then shut the bridge and go.
 *
 * Pure parts are exported for tests; `.js` rather than `.jsx` so the repo's
 * plain `node --test` can import it.
 */
import { leave } from '../core/restart.js';

/** `clear`: screen, scrollback, cursor home. */
export const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';

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
  if (!id) return '\n  Nothing to resume: no conversation in this session.\n\n';
  const where = workspace && workspace !== cwd ? ` --workspace ${quoteIfNeeded(workspace)}` : '';
  return [
    '',
    '  Resume this conversation with:',
    '',
    `    agent --resume ${id}${where}`,
    '',
    `  or  agent --continue${where}   (the most recent one)`,
    '',
    '',
  ].join('\n');
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
  try { ink?.unmount(); } catch { /* going anyway */ }
  try { out.write(CLEAR_SCREEN + farewellFor(agentLoop)); } catch { /* going anyway */ }
  if (exit) return exit(code); // test seam: `leave` ends in process.exit
  await leave(code, { wsServer, agentLoop, delay: 0 });
}

/** Test seam. */
export function _resetFarewell() {
  leaving = false;
  ink = null;
}
