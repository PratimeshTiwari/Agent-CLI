/**
 * An inject waits for a model switch that is still running.
 *
 * Reported with a screenshot: a subagent running on **Pro** when its role asked
 * for a lighter model, and the `menu_left_open` notice that gave it away. The
 * worker gives a subagent's switch 5 seconds and then sends the prompt; in a
 * freshly opened tab the switch's own waits add up to about 14. The inject
 * arrived mid-switch, 1.41.0's cleanup took the switch's open menu for an
 * abandoned one and closed it, and the switch failed.
 *
 * The page knows when a switch has finished and the worker only guesses, so
 * operations register themselves and the inject waits on them.
 *
 * `trackPicker`, the wrapping and `waitForPickerIdle` share two module-level
 * variables, so they are lifted **as one block** into one closure. Lifting them
 * one at a time would give each its own copy of the counter, and the test would
 * pass while measuring nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../content-scripts/gemini-bridge.js'), 'utf8');

const start = src.indexOf('let pickerInFlight = 0;');
const fnStart = src.indexOf('async function waitForPickerIdle(', start);
let depth = 0;
let end = -1;
for (let i = src.indexOf('{', fnStart); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
}
const block = src.slice(start, end);

/** A fresh copy of the block, with the three picker operations stubbed. */
function load(ops, budgets = { ready: 8000, open: 3000, close: 3000 }) {
  return new Function(
    'ops', 'PICKER_READY_BUDGET_MS', 'MENU_OPEN_BUDGET_MS', 'MENU_CLOSE_BUDGET_MS',
    'performance', 'setTimeout',
    `let readModelOptions = ops.read;
     let selectModelByLabel = ops.select;
     let closeModelMenu = ops.close;
     ${block}
     return {
       waitForPickerIdle,
       inFlight: () => pickerInFlight,
       select: (...a) => selectModelByLabel(...a),
       close: (...a) => closeModelMenu(...a),
       budget: PICKER_YIELD_BUDGET_MS,
     };`,
  )(ops, budgets.ready, budgets.open, budgets.close, performance, setTimeout);
}

/** A promise the test resolves by hand: an operation still in flight. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('with nothing running it does not wait, and says so', async () => {
  const p = load({ read: async () => [], select: async () => [], close: async () => {} });
  assert.equal(await p.waitForPickerIdle(), false);
});

test('it waits for a switch that is still running', async () => {
  const sw = deferred();
  const p = load({ read: async () => [], select: () => sw.promise, close: async () => {} });

  p.select('3.8 Flash');
  assert.equal(p.inFlight(), 1, 'the switch did not register');

  let idle = false;
  const waiting = p.waitForPickerIdle().then((v) => { idle = true; return v; });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(idle, false, 'the inject went ahead mid-switch — the subagent-on-Pro bug');

  sw.resolve(['3.8 Flash']);
  assert.equal(await waiting, true, 'and it reports that it waited, for the trace');
  assert.equal(p.inFlight(), 0);
});

test('including the close a switch leaves running after it returns', async () => {
  /*
   * `closeModelMenu` is fire-and-forget: the switch returns its list before the
   * close has finished. Were the close not counted, the inject would proceed on
   * a count of zero while the close was about to click the trigger — a toggle,
   * which would re-open the menu the cleanup had just closed.
   */
  const closing = deferred();
  const sw = deferred();
  let p;
  const ops = {
    read: async () => [],
    close: () => closing.promise,
    select: async () => {
      await sw.promise;
      p.close(); // started, never awaited — as selectModelByLabel does
      return ['3.8 Flash'];
    },
  };
  p = load(ops);

  p.select('3.8 Flash');
  let idle = false;
  const waiting = p.waitForPickerIdle().then(() => { idle = true; });

  sw.resolve();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(idle, false, 'it stopped waiting while the close was still pending');

  closing.resolve();
  await waiting;
  assert.equal(p.inFlight(), 0);
});

test('a switch that throws still counts as finished', async () => {
  // A failing switch is the ordinary case this was written for; a count that
  // leaked on rejection would make every later inject wait out the full budget.
  const p = load({ read: async () => [], select: async () => { throw new Error('no option'); }, close: async () => {} });
  await p.select('x').catch(() => {});
  assert.equal(p.inFlight(), 0);
  assert.equal(await p.waitForPickerIdle(), false);
});

test('a switch that never finishes cannot hold the inject forever', async () => {
  const p = load({ read: async () => [], select: () => new Promise(() => {}), close: async () => {} });
  p.select('x');
  const t0 = Date.now();
  assert.equal(await p.waitForPickerIdle(50), true);
  assert.ok(Date.now() - t0 < 1000, 'the budget did not bound it');
});

test('the budget is derived from the work it waits on', () => {
  /*
   * "Every timeout must outlast the work it waits on" — the worker's 5s did not,
   * which is how the inject came to arrive mid-switch. Derived, so changing one
   * of the picker's own budgets cannot quietly leave this one short.
   */
  const p = load({ read: async () => [], select: async () => [], close: async () => {} },
    { ready: 1000, open: 200, close: 50 });
  assert.equal(p.budget, 1000 + 2 * 200 + 50);
});

test('the inject waits before it cleans up, and the trace says how long', () => {
  const inject = src.slice(src.indexOf('async function injectPrompt('));
  const body = inject.slice(0, inject.indexOf('\n}\n'));
  const wait = body.indexOf('await waitForPickerIdle()');
  const dismiss = body.indexOf('dismissStuckMenu();');
  assert.ok(wait > -1, 'the inject no longer waits for a running switch');
  assert.ok(wait < dismiss, 'cleaning up first closes the menu a switch is still using');
  assert.ok(body.indexOf('isInjecting = true') < wait,
    'waiting before the flag lets a new picker operation start during the wait');
  assert.match(body, /turnTrace\.stages\.picker_wait = pickerWaitMs/);
});
