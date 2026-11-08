/**
 * Moving the turn's clock out of the tab.
 *
 * Completion was detected by a 2s `setInterval` in the content script, and
 * Chrome throttles page timers in a hidden tab. Measured on example.com in a
 * genuinely hidden tab (Chrome 152): that timer delivered **0.98/s** at 30s
 * hidden and **0.03/s** by 90s — roughly one tick per half-minute. Over the
 * same window a `MutationObserver` held **9.97/s** and `getBoundingClientRect`
 * returned a real box **296 times out of 296**.
 *
 * So the scrape was never the problem. The clock was, and it is the entire
 * reason the bridge activates the model tab and holds your focus for the
 * length of a turn. A service worker is not a tab and is not throttled, and
 * `chrome.tabs.sendMessage` is an event rather than a timer, so it is
 * delivered at full rate into a hidden page.
 */
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

function stubChrome(reply = () => ({ watching: true })) {
  const ticks = [];
  globalThis.chrome = {
    tabs: {
      sendMessage: async (tabId, msg) => {
        ticks.push({ tabId, type: msg.type });
        const r = reply(ticks.length, msg);
        if (r instanceof Error) throw r;
        return r;
      },
      query: async () => [],
      get: async (id) => ({ id, discarded: false, autoDiscardable: false }),
      update: async () => {},
      reload: async () => {},
    },
    storage: { session: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({}) } },
    runtime: { id: 'test', getPlatformInfo: async () => ({}) },
    alarms: { get: async () => undefined, create() {}, clear: async () => {}, onAlarm: { addListener() {} } },
    scripting: { executeScript: async () => {} },
  };
  return ticks;
}

/**
 * A fake clock (v9.8), at production's cadence.
 *
 * This file ran on real 40 ms timers with margins, then on `until()` polling,
 * and still failed on CI on 2026-11-06: any wall-clock assertion measures the
 * runner's load as well as the code. `mock.timers` moves only when told, so a
 * count is exact and the windows below are production's own 2 s and 250 ms.
 * `setImmediate` is left real: it is how each step lets the awaited
 * `sendMessage` answers land before the clock moves on.
 */
const TICK = 2000;
const flush = () => new Promise((r) => setImmediate(r));
async function advance(ms, step = 50) {
  for (let t = 0; t < ms; t += step) {
    mock.timers.tick(Math.min(step, ms - t));
    await flush();
    await flush();
  }
}

let mod;
beforeEach(async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  stubChrome();
  mod = await import('../../src/background/content.js');
});
afterEach(() => {
  mod.stopCompletionTicks(7);
  mock.timers.reset();
});

test('ticks the tab on the service worker\'s own clock', async () => {
  const ticks = stubChrome();
  mod.startCompletionTicks(7, TICK);
  await advance(TICK * 2);
  assert.equal(ticks.filter((t) => t.tabId === 7 && t.type === 'tick_completion').length, 2);
});

test('stops as soon as the tab says the turn is over', async () => {
  // Watching for the first tick, finished after it. Five intervals: a ticker
  // that ignored the answer would be at five.
  const ticks = stubChrome((n) => ({ watching: n < 2 }));
  mod.startCompletionTicks(7, TICK);
  await advance(TICK * 5);
  assert.equal(ticks.length, 2, `should stop on the first "not watching", got ${ticks.length}`);
});

test('stops when the tab stops answering at all', async () => {
  const ticks = stubChrome(() => new Error('Receiving end does not exist'));
  mod.startCompletionTicks(7, TICK);
  await advance(TICK * 5);
  assert.equal(ticks.length, 1, 'a dead tab is not worth ticking');
});

test('keeps ticking an older content script that answers undefined', async () => {
  // A tab still running a pre-tick_completion script. Falling back to the
  // throttled path there is exactly the wrong response.
  const ticks = stubChrome(() => undefined);
  mod.startCompletionTicks(7, TICK);
  await advance(TICK * 3);
  assert.equal(ticks.length, 3);
});

test('starting twice does not double the cadence', async () => {
  const ticks = stubChrome();
  mod.startCompletionTicks(7, TICK);
  mod.startCompletionTicks(7, TICK);
  await advance(TICK * 3);
  assert.equal(ticks.length, 3, `one ticker per tab, got ${ticks.length}`);
});

test('stopCompletionTicks is safe for a tab that was never started', () => {
  assert.doesNotThrow(() => mod.stopCompletionTicks(999));
});

test('confirms fast when the tab says it is one observation from done', async () => {
  // The latency this exists to remove. Measured over 74 real turns, every
  // `complete` landed on a ~2000ms boundary because a finished reply was only
  // noticed on the next slow tick. One slow tick at 2 s, then a look every
  // 250 ms until the next slow tick: 2,250 · 2,500 · 2,750 · 3,000.
  const ticks = stubChrome(() => ({ watching: true, confirmSoon: true }));
  mod.startCompletionTicks(7, TICK);
  await advance(TICK * 1.5);
  assert.equal(ticks.length, 5, `expected one slow tick and four fast looks, got ${ticks.length}`);
});

test('a slow tick during a confirm chain does not start a second chain', async () => {
  // The interval fires while a confirm is pending: one chain, not two. Two
  // seconds of chain is 8 looks plus the slow ticks that land between them.
  const ticks = stubChrome(() => ({ watching: true, confirmSoon: true }));
  mod.startCompletionTicks(7, TICK);
  await advance(TICK);
  const atFirst = ticks.length;
  await advance(TICK * 2);
  const perSecond = (ticks.length - atFirst) / 4;
  assert.ok(perSecond <= 4.5, `one look per 250 ms, got ${perSecond * 4} looks in 4 s`);
});

test('does not poll fast while the model is still writing', async () => {
  // Slow is correct during generation: a fast poll there buys nothing and
  // just burns messages into the tab.
  const ticks = stubChrome(() => ({ watching: true, confirmSoon: false }));
  mod.startCompletionTicks(7, TICK);
  await advance(TICK * 2.5);
  assert.equal(ticks.length, 2, `expected the slow cadence, got ${ticks.length}`);
});

/**
 * Stopping a turn has to stop the confirming look too.
 *
 * The confirm was a bare `setTimeout` nobody held, and `stopCompletionTicks`
 * cleared only the interval — so a turn stopped from outside (the tab closed,
 * the session ended, the next turn starting) left a scheduled tick to fire into
 * a tab whose turn was over. The costly half is the next turn: an orphaned
 * confirm finds `completionTickers.has(tabId)` true again and schedules
 * another, a second fast chain at the previous turn's cadence with no handle
 * anywhere to stop it. It compounds once per turn.
 */
test('stopping a turn cancels a confirm that was already scheduled', async () => {
  const ticks = stubChrome(() => ({ watching: true, confirmSoon: true }));
  mod.startCompletionTicks(7, TICK);
  await advance(TICK + 100); // the first tick has landed and scheduled its confirm
  assert.equal(ticks.length, 1);

  mod.stopCompletionTicks(7);
  await advance(TICK * 3);
  assert.equal(ticks.length, 1, `${ticks.length - 1} ticks fired after the turn was stopped`);
});

test('a new turn does not inherit the previous turn\'s confirm chain', async () => {
  const first = stubChrome(() => ({ watching: true, confirmSoon: true }));
  mod.startCompletionTicks(7, TICK);
  await advance(TICK + 100);
  assert.equal(first.length, 1, 'the first turn never ticked');

  // The next turn: slow cadence, nothing to confirm. Anything above the slow
  // rate here is the old turn's orphaned chain still running.
  const second = stubChrome(() => ({ watching: true, confirmSoon: false }));
  mod.startCompletionTicks(7, TICK);
  await advance(TICK * 2.5);
  assert.equal(second.length, 2,
    `expected the slow cadence for the new turn, got ${second.length} — the old chain is still ticking`);
});

test('a fast confirmation stops with the turn, not after it', async () => {
  // confirmSoon on the first reply, finished on the next: the scheduled
  // follow-up must not keep the ticker alive past the end of the turn.
  const ticks = stubChrome((n) => (n === 1
    ? { watching: true, confirmSoon: true }
    : { watching: false }));
  mod.startCompletionTicks(7, TICK);
  await advance(TICK * 4);
  assert.equal(ticks.length, 2, `should stop on the confirming check, got ${ticks.length}`);
});
