/**
 * Whether a tool call may run, must be asked about, or is refused outright.
 *
 * Lifted out of `_executeToolCalls`, which was 487 lines and decided this
 * inline, in the middle of dispatch. That is how `run_background` came to skip
 * every gate: the plan-mode branch named three tools literally, and a fourth
 * that spawns a shell process outliving the turn was not among them, so
 * `needsApproval` kept its initial `false` and the mode whose status bar reads
 * "plan — every edit needs approval" ran it silently. Auto mode asked, through
 * the risk classifier's "Unknown tool" default. The careful mode was the
 * permissive one.
 *
 * Policy buried inside dispatch is policy nobody can read or test. Here it is
 * two pure functions over the catalog's own `mutates` and `shell` flags, so a
 * tool that writes says so once beside its description and the gates follow.
 */
import { MUTATING_TOOLS, SHELL_TOOLS, DETACHED_TOOLS, EXTERNAL_TOOLS } from './tool-catalog.js';
import { isJiraWrite } from '../mcp/tools/jira-issue.js';
import { isAgentArtifact } from './artifact-guard.js';
import { asksForEdits, isProjectMarkdown } from './modes.js';

/**
 * Refused without asking, because asking would be the wrong question.
 *
 * Only a shell command the classifier calls `critical` — which now means a
 * mutation resolved to somewhere outside the workspace, where the diff engine's
 * backups and `/undo` do not reach.
 *
 * @param {{name: string}} call
 * @param {{level: string}} risk
 */
export function isBlockedOutright(call, risk) {
  return SHELL_TOOLS.has(call?.name) && risk?.level === 'critical';
}

/**
 * Must the user be asked before this runs?
 *
 * @param {{name: string, args?: object}} call
 * @param {{mode: string, risk: {level: string}, workspace: string}} ctx
 */
export function requiresApproval(call, { mode, risk, workspace } = {}) {
  const name = call?.name;

  /*
   * First, before the mode, the risk or any exemption (v8.1). A write to Jira
   * is seen by other people at once and `/undo` cannot take it back, so it asks
   * in every mode, auto included. Owner, 2026-10-31: "make sure all write/modify
   * changes ask for my permission as a mandatory step". A source assertion in
   * external-approval.test.js keeps this the first check: moving it below the
   * mode branch reads as tidying and would let auto mode post unasked.
   */
  if (EXTERNAL_TOOLS.has(name)) return isExternalWrite(call);

  if (!asksForEdits(mode)) {
    // Auto mode asks only about what the classifier is unsure of. `safe` runs
    // unattended — which is the whole of what auto mode buys — and `critical`
    // never reaches an approval prompt because `isBlockedOutright` has it.
    return risk?.level === 'risky';
  }

  if (!MUTATING_TOOLS.has(name)) return false;

  /**
   * The agent's own artifacts are exempt. Nothing else is.
   *
   * This read `path.endsWith('.md')`, and the comment beside it said
   * "Creating/Editing Markdown files (like plans) is harmless". The intent was
   * `task.md` and `plan.md` — the files the system prompt *tells* the model to
   * keep up to date, which it cannot do if every tick needs a keystroke. But
   * the test was the extension, not the location, so in plan mode the agent
   * could silently write **any** markdown anywhere: `README.md`, `CLAUDE.md`,
   * and `AGENT.md` — the one file this project promises "can always be trusted
   * to say what the human wrote" — plus anything outside the workspace via an
   * absolute path.
   *
   * Reported from use: `create_file test-agent-cli.md` in plan mode came back
   * `"status":"applied"`, with the status bar reading "plan — every edit needs
   * approval" at the time. A mode that claims every edit needs approval and
   * quietly exempts a file type is worse than one that never claimed it.
   */
  if (name === 'create_file' || name === 'edit_file') {
    if (isAgentArtifact(workspace, call?.args?.path)) return false;
    /*
     * And in `plan` (not `strict`), the repo's own Markdown — asked for on
     * 2026-10-24, because a document built section by section asked for every
     * section. Unlike the exemption described above, this one is decided by
     * location (inside the workspace) and never covers the instruction files
     * (AGENT.md, CLAUDE.md, GEMINI.md). See core/modes.js.
     */
    if (mode === 'plan' && isProjectMarkdown(workspace, call?.args?.path)) return false;
  }

  /*
   * A read-only command is not a change, whatever mode it is. Blocking `ls`
   * behind a keystroke is how an approval prompt becomes something people
   * dismiss without reading.
   *
   * `DETACHED_TOOLS` is the exception to the exception, and the first thing
   * this extraction found. The rule read "any shell tool the classifier calls
   * safe", and `run_background` is a shell tool — so `run_background npm run
   * dev` was exempt on the strength of a verdict about the *command text*,
   * while the process it spawns is still running after the turn ends. The
   * classifier cannot see that; the catalog says it.
   */
  if (SHELL_TOOLS.has(name) && !DETACHED_TOOLS.has(name) && risk?.level === 'safe') return false;

  return true;
}

/** A call to an external tool that writes. An unknown action counts as a write: fail closed. */
export function isExternalWrite(call) {
  if (!EXTERNAL_TOOLS.has(call?.name)) return false;
  if (call.name === 'jira_issue') return isJiraWrite(call.args?.action);
  return true;
}
