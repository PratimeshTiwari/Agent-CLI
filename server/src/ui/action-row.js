/**
 * One step of a turn, drawn the way Claude Code draws it (v6.5, the owner's
 * pick, with a screenshot of Claude Code's expanded Bash row):
 *
 *     ● Run(npm test) · exit 0 · 3.2s                      collapsed
 *
 *     ● Run(npm test)                                      expanded (ctrl+e)
 *       ⎿  # pass 45
 *          # fail 0
 *       ⎿  exit 0 · 3.2s
 *
 * A verb rather than the tool's name — `run_command` is the model's word, not
 * the reader's — from the catalog's `verb`, which the side panel is sent too.
 * One `●` whose colour is the state, so a failed step reads as failed where it
 * happened without a second glyph to learn.
 *
 * Pure, so the shapes are tested without Ink; `TranscriptTurn.jsx` draws them.
 */

import { toolVerb } from '../core/tool-catalog.js';
import { subjectOf, summarizeResult, clampForDisplay, oneLine } from './format.js';

/** `Run` for `run_command`; a tool the catalog does not know keeps its name. */
export const actionVerb = toolVerb;

/** The theme role each state's `●` is drawn in. */
export const STATE_TONE = {
  running: 'accent',
  done: 'success',
  failed: 'danger',
  rejected: 'muted',
};

const isShellResult = (r) => r && typeof r === 'object' && typeof r.exitCode === 'number';

/**
 * running · done · failed · rejected.
 *
 * Rejected is its own state, not a failure: the person pressed reject and
 * knows it, so it is drawn quiet rather than red. A non-zero exit is a
 * failure even when the call "succeeded" — the tool ran, the command did not.
 */
export function actionState(act) {
  const r = act?.result;
  if ((r === null || r === undefined) && (act?.success === null || act?.success === undefined)) return 'running';
  if (typeof r === 'string' && (/REJECTED/.test(r) || /^User rejected/i.test(r))) return 'rejected';
  if (act.success === false) return 'failed';
  if (isShellResult(r) && (r.exitCode !== 0 || r.timedOut)) return 'failed';
  return 'done';
}

/** `Run(npm test)`, or the bare verb when there is nothing to name. */
export function actionHead(toolName, args, max = 60) {
  const subject = subjectOf(toolName, args, Math.max(8, max));
  return subject ? `${actionVerb(toolName)}(${subject})` : actionVerb(toolName);
}

/**
 * `3.2s`, `48s`, `2m 05s`; '' for nothing measured, and for under a tenth of a
 * second — `exit 1 · 0.0s` reads as a clock that did not run.
 */
export function durationLabel(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 100) return '';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * What came of the step, in one line: `exit 0 · 3.2s` for a command, the
 * result's shape (`+2 −72`, `1,240 lines`) for anything else.
 *
 * @param {object} act - `{toolName, result, success, resultMsg}`
 */
export function actionOutcome(act) {
  const state = actionState(act);
  if (state === 'running') return '';
  const r = act.result;
  if (state === 'rejected') {
    return /^(edit_file|create_file)$/.test(act.toolName) ? 'rejected — nothing written' : 'rejected';
  }
  if (isShellResult(r)) {
    const took = durationLabel(act.resultMsg?.ms);
    const how = r.timedOut ? 'timed out' : `exit ${r.exitCode}`;
    return took ? `${how} · ${took}` : how;
  }
  return summarizeResult(act.toolName, r);
}

/**
 * The lines an expanded command shows under its head: what it printed, capped
 * with Claude Code's `… +N lines`. Empty for anything that is not a shell
 * result, so the caller falls back to its other shapes.
 *
 * @returns {string[]}
 */
export function commandOutputLines(result, { lines = 20, chars = 4000, hint = '' } = {}) {
  if (!isShellResult(result)) return [];
  const body = [result.stdout, result.stderr].filter((p) => p && String(p).trim()).join('\n').trimEnd();
  if (!body) return result.timedOut ? [] : ['(no output)'];
  return clampForDisplay(body, lines, chars, { hint }).split('\n');
}

/**
 * The collapsed row's text after the head, `· exit 0 · 3.2s`, kept to one line.
 */
export function collapsedTail(act) {
  const outcome = actionOutcome(act);
  return outcome ? oneLine(outcome) : '';
}
