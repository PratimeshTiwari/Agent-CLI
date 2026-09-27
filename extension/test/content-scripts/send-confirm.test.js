/**
 * Sending a prompt, in a tab whose timers do not run.
 *
 * Reported with a screenshot: tool results pasted into the composer, the send
 * button lit, nothing sent, and no retry until the prompt was sent by hand.
 * And separately, from the traces: the `type` stage went from a 27ms median
 * over 376 turns to 994ms, about a second on every round trip.
 *
 * Both had the same clock under them. CLAUDE.md measured page timers in a
 * hidden tab delivering **1.9%** of their ticks — collapsing to roughly one a
 * minute — while a MutationObserver runs at full rate. The completion check and
 * the picker had already been moved off page timers; the typing path had not.
 *
 * So the tests that matter here inject a `setTimeout` that **never fires**.
 * That is the worst case a hidden tab can produce, and it is the one condition
 * nothing in this suite had simulated: every earlier test ran with Node's
 * timers, which are never throttled, and so could not see the bug at all.
 *
 * Every function is lifted verbatim from the shipped source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadFunction } from '../load-content-script.js';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '../../content-scripts/gemini-bridge.js');
const src = readFileSync(SCRIPT, 'utf8');

function realSelectors() {
  const start = src.indexOf('const SELECTORS = {');
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  return new Function(`return ${src.slice(src.indexOf('{', start), end)};`)();
}
const SELECTORS = realSelectors();
const constant = (name) => Number(new RegExp(`const ${name} = (\\d+);`).exec(src)[1]);

/** A timer that never fires: a hidden tab at its worst. */
const frozen = { setTimeout: () => 0, clearTimeout: () => {} };
/** Node's own, for the paths that are meant to use a real clock. */
const live = { setTimeout, clearTimeout };

/**
 * A Gemini-shaped page: a composer holding our prompt, and optionally a send
 * button. `clicks` scripts what each click does — `'accept'` clears the
 * composer the way Gemini does when it takes a prompt, `'swallow'` does
 * nothing, which is the reported failure.
 */
function page({ button = true, clicks = ['accept'] } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const { window } = dom;
  const { document } = window;
  const composer = document.createElement('div');
  composer.className = 'ql-editor';
  composer.setAttribute('contenteditable', 'true');
  composer.textContent = 'PROMPT-OPENING the rest of the prompt';
  document.body.appendChild(composer);

  const log = { clicks: 0, enters: 0 };
  const makeButton = () => {
    const b = document.createElement('button');
    b.setAttribute('aria-label', 'Send message');
    b.addEventListener('click', () => {
      const what = clicks[log.clicks] ?? 'swallow';
      log.clicks += 1;
      if (what === 'accept') composer.textContent = '';
    });
    return b;
  };
  const btn = button ? makeButton() : null;
  if (btn) document.body.appendChild(btn);
  composer.addEventListener('keydown', (e) => { if (e.key === 'Enter') log.enters += 1; });
  return { window, document, composer, btn, makeButton, log };
}

function lift(p, timers, extra = {}) {
  const env = {
    document: p.document,
    window: p.window,
    MutationObserver: p.window.MutationObserver,
    KeyboardEvent: p.window.KeyboardEvent,
    performance: p.window.performance,
    console: { log() {}, warn() {} },
    SELECTORS,
    ...timers,
    ...extra,
  };
  env.findElement = loadFunction(SCRIPT, 'findElement', env);
  env.waitForDom = loadFunction(SCRIPT, 'waitForDom', env);
  return env;
}

test('waitForSendButton finds a button that renders after the first look, with timers frozen', async () => {
  /*
   * The pasted-and-never-sent screenshot. Gemini renders the send button only
   * once the composer holds text, so the first check finds nothing; the old
   * code then waited on `setTimeout(check, 60)`, which in a hidden tab arrived
   * after the 30s deadline had passed. With no timer at all it would never look
   * again — so this fails by *timing out*, not by hanging.
   */
  const p = page({ button: false });
  const env = lift(p, frozen, {
    SEND_LADDER_GRACE_MS: constant('SEND_LADDER_GRACE_MS'),
    findSendButtonStructurally: () => null,
    reportDrift: () => {},
  });
  const waitForSendButton = loadFunction(SCRIPT, 'waitForSendButton', env);

  const pending = waitForSendButton(p.composer, 30000, null);
  const btn = p.makeButton();
  p.document.body.appendChild(btn); // the render — a DOM mutation, not a tick

  const found = await Promise.race([
    pending,
    new Promise((r) => setTimeout(() => r('never resolved'), 1000)),
  ]);
  assert.equal(found, btn, 'the button rendered, and nothing looked again');
});

test('and one that is rendered disabled, then enabled', async () => {
  // Enabling is an attribute change — also a mutation, also invisible to a
  // timer that does not run.
  const p = page({ button: false });
  const env = lift(p, frozen, {
    SEND_LADDER_GRACE_MS: constant('SEND_LADDER_GRACE_MS'),
    findSendButtonStructurally: () => null,
    reportDrift: () => {},
  });
  const waitForSendButton = loadFunction(SCRIPT, 'waitForSendButton', env);
  const btn = p.makeButton();
  btn.setAttribute('aria-disabled', 'true');
  p.document.body.appendChild(btn);

  const pending = waitForSendButton(p.composer, 30000, null);
  btn.setAttribute('aria-disabled', 'false');
  const found = await Promise.race([pending, new Promise((r) => setTimeout(() => r('never'), 1000))]);
  assert.equal(found, btn);
});

/**
 * `confirmSend` and the three things it reads, lifted together. The response
 * count and the Stop button are stubbed, because jsdom has no layout — a real
 * `getBoundingClientRect` there is always zero, which would make every Stop
 * button look hidden and the test pass for the wrong reason.
 */
function confirmer(p, { generating = () => false, responses = () => 0, holds, timers = live } = {}) {
  const sent = [];
  const env = lift(p, timers, {
    SEND_CONFIRM_MS: 60,
    SEND_RETRIES: constant('SEND_RETRIES'),
    safeSend: (m) => sent.push(m),
    findInputResilient: () => p.composer,
    stopButtonVisible: generating,
    getResponseCount: responses,
    initialResponseCount: 0,
    lastTypedPrefix: 'PROMPT-OPENING',
  });
  env.composerStillHoldsPrompt = holds || loadFunction(SCRIPT, 'composerStillHoldsPrompt', env);
  env.sendAccepted = loadFunction(SCRIPT, 'sendAccepted', env);
  return { confirmSend: loadFunction(SCRIPT, 'confirmSend', env), sent };
}

test('a click that is taken is confirmed at once, and says nothing', async () => {
  const p = page({ clicks: ['accept'] });
  const { confirmSend, sent } = confirmer(p);
  p.btn.click();
  assert.equal(await confirmSend(p.btn), 0, 'no retry was needed');
  assert.equal(p.log.clicks, 1, 'and none was made');
  assert.equal(sent.length, 0, 'a notice on every turn is a notice nobody reads');
});

test('a swallowed click is clicked again, and the retry is recorded', async () => {
  // The screenshot's case, and the one that previously waited for a human.
  const p = page({ clicks: ['swallow', 'accept'] });
  const { confirmSend, sent } = confirmer(p);
  p.btn.click();
  assert.equal(await confirmSend(p.btn), 1);
  assert.equal(p.log.clicks, 2);
  assert.equal(p.composer.textContent, '', 'the prompt went');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.op, 'send_retried');
  assert.equal(sent[0].payload.level, 'notice', 'the turn went ahead; it must not end it');
});

test('a prompt that will not go fails honestly, after a bounded number of tries', async () => {
  const p = page({ clicks: [] }); // every click swallowed
  const { confirmSend } = confirmer(p);
  p.btn.click();
  await assert.rejects(confirmSend(p.btn), /\[send_unconfirmed\]/);
  assert.equal(p.log.clicks, 1 + constant('SEND_RETRIES'), 'bounded: the retries, and no more');
});

test('it never clicks again once generation has started', async () => {
  /*
   * The double-send guard. Gemini can be generating before the composer has
   * visibly cleared; a Stop button means the prompt is in, and a second click
   * there would submit it twice.
   */
  const p = page({ clicks: ['swallow'] });
  const { confirmSend } = confirmer(p, { generating: () => true });
  p.btn.click();
  assert.equal(await confirmSend(p.btn), 0);
  assert.equal(p.log.clicks, 1, 'clicked again while Gemini was already answering');
});

test('or once a response block has appeared', async () => {
  const p = page({ clicks: ['swallow'] });
  const { confirmSend } = confirmer(p, { responses: () => 1 });
  p.btn.click();
  assert.equal(await confirmSend(p.btn), 0);
  assert.equal(p.log.clicks, 1);
});

test('and uncertainty never earns a second click', async () => {
  /*
   * `composerStillHoldsPrompt` answers null when it cannot tell — the composer
   * re-mounted, say. Only proof that the prompt is still there justifies a
   * retry; anything less is how a prompt gets sent twice, which trips Gemini's
   * repetition filters and is the failure this whole file exists to avoid.
   */
  const p = page({ clicks: ['swallow'] });
  const { confirmSend } = confirmer(p, { holds: () => null });
  p.btn.click();
  assert.equal(await confirmSend(p.btn), 0);
  assert.equal(p.log.clicks, 1);
});

test('a retry with no clickable button presses Enter instead', async () => {
  const p = page({ clicks: ['swallow'] });
  const { confirmSend } = confirmer(p);
  p.btn.click();
  p.btn.remove(); // re-rendered away between the click and the retry
  await assert.rejects(confirmSend(p.btn));
  assert.ok(p.log.enters >= 1, 'with the button gone there was nothing left to try');
});

test('confirmation works with timers frozen too', async () => {
  // The composer clearing is a mutation, so the confirmation must not depend on
  // a timer either — or it would sit out its budget in a hidden tab every turn.
  const p = page({ clicks: ['swallow'] });
  const { confirmSend } = confirmer(p, { timers: frozen });
  p.btn.click();
  const pending = confirmSend(p.btn);
  p.composer.textContent = ''; // Gemini takes it, late
  const got = await Promise.race([pending, new Promise((r) => setTimeout(() => r('never'), 1000))]);
  assert.equal(got, 0);
});
