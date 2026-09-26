/**
 * The structural fallback must never return the microphone.
 *
 * Reported with two screenshots on 2026-09-26: the dictation waveform running,
 * a stop button where send had been, and the prompt still sitting in the
 * composer — and it stays that way until dictation is stopped by hand, so the
 * turn is lost and the machine is listening.
 *
 * `/logs extension` had been saying so since 11:22 that morning, twice, in as
 * many words:
 *
 *     SELECTORS.sendButton matched nothing; found
 *     <button aria-label="Dictate (⌘⇧D)"> by shape instead.
 *
 * **"Appeared after the text did" is a good signal and not a sufficient one.**
 * Measured against the live page: with text in the box exactly one button
 * appears, `aria-label="Send message"`, and the ladder matches it — so the
 * ladder is not broken. The fallback was running *before* that button had
 * mounted, where the only candidates are whatever the composer churned while
 * Angular settled.
 *
 * `findModelTriggerStructurally` has had a veto like this since it was written.
 * This function was left without one.
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

const VETO = new RegExp(
  /const NOT_THE_SEND_BUTTON = \/(.+?)\/i;/.exec(src)[1].replace(/\\\\/g, '\\'), 'i',
);

/**
 * The fallback, over a page where `before` held nothing and `now` holds these.
 * Every button therefore counts as "appeared", which is the state the bug
 * happened in.
 */
function pick(buttons) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const { document } = dom.window;
  for (const b of buttons) {
    const el = document.createElement('button');
    if (b.label) el.setAttribute('aria-label', b.label);
    if (b.icon) {
      const i = document.createElement('mat-icon');
      i.setAttribute('data-mat-icon-name', b.icon);
      el.appendChild(i);
    }
    document.body.appendChild(el);
  }
  const all = [...document.querySelectorAll('button')];
  const found = loadFunction(SCRIPT, 'findSendButtonStructurally', {
    enabledButtons: () => new Set(all),
    NOT_THE_SEND_BUTTON: VETO,
    document,
  })(new Set(), null);
  return found ? found.getAttribute('aria-label') : null;
}

/**
 * The same, but with a composer to be inside of.
 *
 * `outside: true` puts the button in the page body rather than the composer —
 * which is where `Temporary chat` and the notebook menus actually live.
 */
function pickInComposer(buttons) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page"></div></body></html>');
  const { document } = dom.window;
  const page = document.getElementById('page');
  const composer = document.createElement('div');
  const input = document.createElement('div');
  input.setAttribute('contenteditable', 'true');
  composer.appendChild(input);
  page.appendChild(composer);

  for (const b of buttons) {
    const el = document.createElement('button');
    if (b.label) el.setAttribute('aria-label', b.label);
    if (b.icon) {
      const i = document.createElement('mat-icon');
      i.setAttribute('data-mat-icon-name', b.icon);
      el.appendChild(i);
    }
    (b.outside ? document.body : composer).appendChild(el);
  }
  const all = [...document.querySelectorAll('button')];
  const found = loadFunction(SCRIPT, 'findSendButtonStructurally', {
    enabledButtons: () => new Set(all),
    NOT_THE_SEND_BUTTON: VETO,
    document,
  })(new Set(), input);
  return found ? found.getAttribute('aria-label') : null;
}

// The exact pair the live page offers, in the window where send has not mounted.
test('the microphone is never the send button', () => {
  assert.equal(pick([{ label: 'Dictate (⌘⇧D)', icon: 'mic' }]), null,
    'it returned the control that starts voice dictation and loses the turn');
});

test('and the real send button still is', () => {
  assert.equal(
    pick([{ label: 'Send message', icon: 'arrow_upward' }]),
    'Send message',
  );
});

/*
 * The case that actually happened: the mic re-rendered and looked new while
 * the send button had not arrived. With the veto there is no candidate, so the
 * poll keeps waiting — which is the correct outcome, not a lost turn.
 */
test('a churned microphone beside no send button yields nothing', () => {
  assert.equal(pick([
    { label: 'Dictate (⌘⇧D)', icon: 'mic' },
    { label: 'Upload & tools', icon: 'plus' },
    { label: 'Open mode picker, currently Flash' },
  ]), null);
});

test('and send is still found when it arrives alongside the noise', () => {
  assert.equal(pick([
    { label: 'Dictate (⌘⇧D)', icon: 'mic' },
    { label: 'Send message', icon: 'arrow_upward' },
  ]), 'Send message');
});

/*
 * Every control the live page offers, by the label it actually carries — taken
 * from the page on 2026-09-26, not invented.
 *
 * `Temporary chat` is the one that made the point: it walked straight through
 * the veto, because a denylist is only ever as good as its list. It lives in
 * the sidebar, which is why containment is the stronger test — and the first
 * draft of this file asserted it *was* vetoed, which was a claim about the
 * regex rather than about the behaviour that matters.
 */
test('nothing else in the composer can be mistaken for send', () => {
  // These share the box with the prompt, so only the veto can exclude them.
  for (const [label, icon] of [
    ['Dictate (⌘⇧D)', 'mic'],
    ['Upload & tools', 'plus'],
    ['Open mode picker, currently Flash', 'keyboard_arrow_down'],
  ]) {
    assert.equal(pickInComposer([{ label, icon }]), null,
      `${label} was treated as the send button`);
  }
});

test('and nothing outside it is even a candidate', () => {
  // These live in the sidebar, where the veto happens not to reach — which is
  // the point of testing containment separately rather than lengthening a list.
  for (const label of [
    'Settings', 'Temporary chat', 'Close sidebar', 'Toggle Notebooks',
    'Open notebook actions menu', 'More options for Some Chat',
  ]) {
    assert.equal(pickInComposer([{ label, outside: true }]), null,
      `${label} was treated as the send button`);
  }
});

/*
 * Containment, which is what catches whatever the denylist does not. A button
 * outside the composer cannot be the send button however new it looks.
 */
test('a churned sidebar button outside the composer is not a candidate', () => {
  assert.equal(
    pickInComposer([{ label: 'Temporary chat', outside: true }]),
    null,
  );
});

test('and the send button inside the composer still wins over outside noise', () => {
  assert.equal(pickInComposer([
    { label: 'Temporary chat', outside: true },
    { label: 'Some New Thing', icon: 'arrow_upward' },
  ]), 'Some New Thing', 'containment narrowed away the real button');
});

/*
 * The veto is a denylist, so it can only ever be as good as its list. The
 * grace period is what makes the whole class unlikely: the fallback is for a
 * selector that *changed*, which is permanent, and a button that has not
 * rendered yet is a different problem.
 */
test('the ladder gets a grace period before the fallback may guess', () => {
  assert.match(src, /const SEND_LADDER_GRACE_MS = (\d+);/);
  const grace = Number(/const SEND_LADDER_GRACE_MS = (\d+);/.exec(src)[1]);
  assert.ok(grace >= 500,
    `${grace}ms — the send button takes a few hundred ms to mount, so the fallback `
    + 'still runs while the page is settling');
  assert.ok(grace <= 5000,
    `${grace}ms — a genuinely changed selector would stall every turn this long`);

  const body = src.slice(src.indexOf('function waitForSendButton('));
  assert.match(body.slice(0, body.indexOf('\n}')), /ladderHadAChance/,
    'the fallback is consulted on the first check again');
});
