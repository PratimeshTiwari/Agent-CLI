/**
 * A picker failure must not be able to reach a turn.
 *
 * Everything the picker had was a **veto** — don't open a menu over a live
 * composer, don't act on a half-read list. A veto works only while every path
 * that could leave a menu open is known, and there are eight selector ladders
 * against a page Google redesigns without telling anyone, so that assumption
 * expires without warning. CLAUDE.md states the rule and then records that this
 * one control never satisfied it: *"a structural fallback needs a veto and
 * containment… the mode picker's fallback still has only the veto."*
 *
 * An open menu puts an overlay across the composer. The send button is behind
 * it, `waitForSendButton` finds a control it cannot click and burns its whole
 * budget, and the turn is lost — two turns away from the picker operation that
 * caused it, which is what made this expensive to diagnose rather than merely
 * annoying.
 *
 * Two things are pinned here, both source assertions in the idiom this
 * directory already uses for the bridge (`picker-opens-a-tab.test.js`): the
 * content script is a 2,400-line IIFE that talks to a live DOM, and the
 * behaviour is verified against a real page under the harness, not here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '../..', p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const bridge = stripComments(read('content-scripts/gemini-bridge.js'));
const worker = stripComments(read('src/background/main.js'));

const fn = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `no ${name} in the source`);
  return src.slice(start, src.indexOf('\nfunction ', start + 1));
};

test('switch_model refuses to open a menu over a live composer', () => {
  /*
   * `discover_models` has had this guard since 1.30.0 and `switch_model` never
   * did — and it is the one that matters more: a discovery over a live composer
   * costs a read, a switch over one costs the turn.
   */
  const arm = bridge.slice(bridge.indexOf("case 'switch_model':"), bridge.indexOf("case 'get_page_status':"));
  assert.match(arm, /if \(isInjecting\)/, 'a switch can still open a menu mid-inject');
  assert.match(arm, /pendingSwitch = /, 'and it is dropped rather than deferred');
});

test('a deferred switch remembers the label, not a boolean', () => {
  // Unlike a discovery, a switch is not idempotent: deferring it has to
  // remember *what* was asked for or the switch is simply lost.
  const arm = bridge.slice(bridge.indexOf("case 'switch_model':"), bridge.indexOf("case 'get_page_status':"));
  assert.match(arm, /pendingSwitch = payload\?\.label/);
});

test('the drain runs the switch before the discovery', () => {
  /*
   * A switch changes the very thing a discovery reports, so reading first
   * publishes a list that is about to be wrong — and the server compares that
   * list against the rung to decide whether to warn about a mismatch.
   */
  // Inside `injectPrompt`, not from the first `isInjecting = false;` in the
  // file: that is the `let` declaration, whose neighbours are the two `let`s for
  // these same flags — in the opposite order. The first cut anchored there and
  // failed on correct code, which is a test measuring where things are declared.
  const inject = fn(bridge, 'injectPrompt');
  const drain = inject.slice(inject.lastIndexOf('isInjecting = false;'));
  const sw = drain.indexOf('if (pendingSwitch)');
  const disc = drain.indexOf('if (pendingDiscover)');
  assert.ok(sw > -1 && disc > -1, 'both deferrals must drain');
  assert.ok(sw < disc, 'the discovery runs first and reports a list the switch is about to invalidate');
});

test('every inject clears a stuck menu before typing', () => {
  const inject = fn(bridge, 'injectPrompt');
  assert.match(inject, /dismissStuckMenu\(\)/, 'the turn still trusts the picker to have cleaned up');
  assert.ok(
    inject.indexOf('dismissStuckMenu') < inject.indexOf('traceStart'),
    'a stuck menu is charged to find_input, which sends the next reader after the wrong thing',
  );
  // Presence first: `indexOf` is -1 when the flag is gone entirely, and -1 is
  // less than anything, so the ordering check alone passed on a deleted flag.
  const flag = inject.indexOf('isInjecting = true');
  assert.ok(flag > -1, 'injectPrompt no longer marks the composer busy');
  assert.ok(
    flag < inject.indexOf('dismissStuckMenu'),
    'dismissing before the flag lets an arriving picker op re-open the menu being closed',
  );
});

test('the dismissal is synchronous, unbudgeted and cannot throw', () => {
  /*
   * It is on the hot path of every turn, so the common case — no menu open —
   * must cost two DOM reads. `findModelTrigger` waits up to 8s for a picker to
   * *appear*, which is right for reading one and absurd before typing; and a
   * cleanup that can throw would make this a cause of the thing it prevents,
   * which CLAUDE.md records happening twice ("the repair caused the next bug").
   */
  const dismiss = fn(bridge, 'dismissStuckMenu');
  assert.ok(!/\bawait\b/.test(dismiss), 'an awaited cleanup puts a budget in front of every turn');
  assert.ok(!/waitForDom|findModelTrigger/.test(dismiss), 'no waiting for a picker that is not there');
  assert.match(dismiss, /try \{[\s\S]*\} catch/, 'it must not be able to fail the send behind it');
  assert.match(dismiss, /findElement\(SELECTORS\.modelTrigger\)/);
});

test('it tries Escape as well as the trigger, because they fail differently', () => {
  /*
   * The trigger click is what `closeModelMenu` uses and is known to work.
   * Escape goes through Angular Material's overlay keydown handler and needs no
   * selector, so it still closes a menu whose trigger selector is the thing
   * that changed — which is the failure this whole file is about.
   */
  const dismiss = fn(bridge, 'dismissStuckMenu');
  assert.match(dismiss, /KeyboardEvent\('keydown'/);
  assert.match(dismiss, /key: 'Escape'/);
  assert.match(dismiss, /trigger\?\.click\(\)|trigger\.click\(\)/);
  assert.ok(
    dismiss.indexOf('Escape') < dismiss.lastIndexOf('click()'),
    'the selector-dependent path should not be the only one tried first',
  );
});

test('a stuck menu is reported, not repaired in silence', () => {
  // The turn survives it now, which is exactly why it has to be recorded: a
  // silent repair is how the microphone click went unnoticed for a release.
  const dismiss = fn(bridge, 'dismissStuckMenu');
  assert.match(dismiss, /op: 'menu_left_open'/);
  assert.match(dismiss, /level: 'notice'/, 'nothing went wrong for the user; it is a notice');
});

test('the worker relays an error payload through unchanged', () => {
  /*
   * `dismissStuckMenu`'s `level` only means anything if the field survives the
   * hop, and CLAUDE.md claims content scripts "cannot set fields on that
   * payload" — which is not true of this relay and misled the first reading of
   * it. The worker forwards `{type, payload}` verbatim, which is also how `op`
   * has always arrived. Pinned because rebuilding the payload here is exactly
   * the drift `relay-drift.test.js` exists for, one field lower down.
   */
  const arm = worker.slice(worker.indexOf("case 'error':"), worker.indexOf("case 'get_status':"));
  assert.match(arm, /sendToServer\(\{ type, payload \}\)/,
    'the payload is rebuilt, so any field the page set is silently dropped');
});
