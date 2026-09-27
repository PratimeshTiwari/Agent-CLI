/**
 * Only a background poll's missing tab is an expected state.
 *
 * `discover_models` declining because this extension owns no tab yet was **65
 * of 274 rows** in three days of `errors.jsonl` — the single largest entry in
 * it, and correct behaviour every time. A background poll runs at connect and
 * once a turn, and it must never make a window appear to answer a question
 * nobody asked. So it declines, reports, and that report was filed as a
 * failure on every session, forever.
 *
 * Demoting it is only safe because of what is *not* demoted, which is what this
 * file pins:
 *
 *   - `switch_model` always follows something someone did.
 *   - a `userInitiated` `discover_models` has already tried `ensureModelTab`
 *     and failed to open one, which is a real fault.
 *   - `focus_tab` is ctrl+b — someone pressed it and is waiting.
 *
 * Get that condition wrong in the permissive direction and the picker faults P2
 * exists to contain become invisible, which is strictly worse than the noise
 * this removes: the noise was legible once you knew to skip it.
 *
 * A source assertion, in the idiom `picker-opens-a-tab.test.js` already uses
 * for this arm: neither `handleServerMessage` nor `reportTabFailure` is
 * exported, and exporting a seam for one test is API surface with no other
 * reason to exist. Comments are stripped first, because the prose around this
 * code names all three ops while the code branches on one — a scrape that reads
 * prose can pass on code that only *talks* about the condition.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const socket = readFileSync(join(here, '../../src/background/socket.js'), 'utf8');

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const code = stripComments(socket);

/** `reportTabFailure`'s body, up to the next top-level declaration. */
const reporter = code.slice(
  code.indexOf('function reportTabFailure'),
  code.indexOf('async function handleServerMessage'),
);

/** The `discover_models` / `switch_model` arm of the worker's dispatch. */
const arm = code.slice(
  code.indexOf("case 'discover_models':"),
  code.indexOf("case 'heartbeat_ack':"),
);

test('the report still goes, whatever its level', () => {
  /*
   * Not negotiable, and the reason is a bug that has already happened twice.
   * The server's watchdog settles on this report; without it,
   * `model_options_unanswered` cannot tell "no tab to ask" from "asked and got
   * no answer" and waits out its whole budget instead. Silence is the failure
   * mode being escaped, so a demotion that reached silence would undo the fix
   * it is built on top of.
   */
  assert.match(reporter, /sendToServer\(/, 'the decline must still be reported');
  assert.match(reporter, /type:\s*'error'/);
});

test('an expected decline carries level: notice', () => {
  assert.match(reporter, /level:\s*'notice'/,
    'nothing marks the expected state, so it is still counted as a failure');
});

test('and an unexpected one carries no level at all', () => {
  /*
   * The field is conditional, not constant. An unconditional `level: 'notice'`
   * would read identically in a diff and silence every tab failure in the
   * product — which is the failure mode this whole level risks, so it is
   * asserted rather than assumed.
   */
  assert.match(reporter, /\.\.\.\(expected \? \{ level: 'notice' \} : \{\}\)/,
    'the level must be conditional on `expected`');
});

test('the message changes with the level, because the advice does', () => {
  /*
   * `lastTabFailure` ends in *"open one from the agent, or reload the extension
   * if you opened it yourself"* — advice for someone who asked for something
   * and did not get it. Handed to a background poll it tells the reader to fix
   * a thing that is not broken, which is how a log stops being read.
   */
  assert.match(reporter, /expected\s*\?/, 'the message is not chosen by level');
  assert.match(reporter, /nothing to do/);
});

test('only discover_models is ever expected', () => {
  assert.match(arm, /expected:\s*type === 'discover_models' && !payload\?\.userInitiated/,
    'the condition that keeps switch_model and a typed /effort loud');
});

test('switch_model cannot reach the expected path', () => {
  // The negative control. `switch_model` shares this arm, this reporter and
  // this failure message with `discover_models`; the only thing keeping it a
  // failure is that one `type ===` comparison.
  const conditions = [...arm.matchAll(/expected:\s*([^\n]+)/g)].map((m) => m[1]);
  assert.equal(conditions.length, 1, 'one place decides this');
  assert.ok(
    !/switch_model/.test(conditions[0]),
    'switch_model is being demoted, and every picker fault it reports goes quiet',
  );
});

test('focus_tab reports as a failure, with no level', () => {
  // ctrl+b. Someone pressed it and is watching for the tab; a tab that does not
  // appear was reported as nothing at all until 2026-09-25, which is the bug
  // `reportTabFailure` was added for. It must not be re-introduced as a notice.
  const focus = code.slice(code.indexOf("case 'focus_tab':"), code.indexOf("case 'discover_models':"));
  assert.match(focus, /reportTabFailure\('focus_tab'\)/);
  assert.ok(!/expected/.test(focus), 'ctrl+b failing is not an expected state');
});
