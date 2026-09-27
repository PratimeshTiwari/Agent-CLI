/**
 * A menu left open must not cost the next turn — run against a DOM.
 *
 * `picker-containment.test.js` pins that `injectPrompt` calls this, before
 * anything is typed and after the composer is marked busy. That is a claim
 * about the *wiring*. This file runs the shipped function, verbatim, against a
 * Gemini-shaped page with the mode picker left open across the composer — the
 * state reported with two screenshots, where the prompt sat unsent under the
 * menu and `waitForSendButton` burned its whole budget on a control it could
 * not click.
 *
 * Every function is lifted out of the real source with `loadFunction`, and so
 * is `SELECTORS` — a hand-copied selector list here would pass while the real
 * one drifted, which is the whole risk this is about.
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

/** `const SELECTORS = { … }`, evaluated from the shipped source. */
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

/**
 * A page with a composer and the mode picker.
 *
 * `open` leaves the menu rendered with the trigger reporting expanded, which is
 * the state a picker path leaves behind when it stops waiting before the menu
 * finishes opening. Escape on the document closes it — the overlay's keydown.
 *
 * **The trigger toggles**, as Gemini's does: clicking it closed *opens* the
 * menu. The first cut of this fixture had a trigger that could only close, and
 * against it an unconditional `trigger.click()` after Escape looked harmless —
 * when on the real page it re-opens the menu Escape has just shut, which is the
 * exact state this function exists to get rid of. Found by mutating the source
 * and watching the suite stay green.
 */
function page({ open, escapeWorks = true, triggerWorks = true, triggerSelector = 'data-test-id' }) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const { document, KeyboardEvent } = dom.window;

  const trigger = document.createElement('button');
  if (triggerSelector === 'data-test-id') trigger.setAttribute('data-test-id', 'bard-mode-menu-button');
  else trigger.setAttribute('aria-label', 'something Google renamed it to');
  trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.appendChild(trigger);

  const composer = document.createElement('div');
  composer.setAttribute('contenteditable', 'true');
  document.body.appendChild(composer);

  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  for (const label of ['3.5 Flash-Lite', '3.8 Flash', '3.1 Pro']) {
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    menu.appendChild(item);
  }
  const close = () => {
    menu.remove();
    trigger.setAttribute('aria-expanded', 'false');
  };
  const reopen = () => {
    document.body.appendChild(menu);
    trigger.setAttribute('aria-expanded', 'true');
  };
  if (open) document.body.appendChild(menu);

  if (triggerWorks) trigger.addEventListener('click', () => {
    if (trigger.getAttribute('aria-expanded') === 'true') close();
    else reopen();
  });
  if (escapeWorks) document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  const sent = [];
  const env = { document, SELECTORS, KeyboardEvent };
  env.findElement = loadFunction(SCRIPT, 'findElement', env);
  env.modelMenuItems = loadFunction(SCRIPT, 'modelMenuItems', env);
  env.safeSend = (m) => sent.push(m);
  const dismiss = loadFunction(SCRIPT, 'dismissStuckMenu', env);

  const isOpen = () => trigger.getAttribute('aria-expanded') === 'true'
    || document.querySelectorAll('[role="menu"] [role="menuitem"]').length > 0;
  return { dismiss, isOpen, sent, trigger };
}

test('a menu left open across the composer is closed before typing', () => {
  const p = page({ open: true });
  assert.equal(p.isOpen(), true, 'the fixture is not reproducing the stuck state');
  assert.equal(p.dismiss(), true);
  assert.equal(p.isOpen(), false, 'the menu is still over the composer; the send lands on its backdrop');
});

test('and it says so, as a notice', () => {
  // The turn survives now, which is exactly why it must be recorded: a silent
  // repair is how the microphone click went unnoticed for a release.
  const p = page({ open: true });
  p.dismiss();
  assert.equal(p.sent.length, 1);
  const [m] = p.sent;
  assert.equal(m.type, 'error');
  assert.equal(m.payload.op, 'menu_left_open');
  assert.equal(m.payload.level, 'notice');
});

test('with no menu open it does nothing and says nothing', () => {
  /*
   * The case on every turn. Anything it did here — a stray Escape, a click on
   * the trigger — would be an interaction with the page on every single turn
   * for no reason, and a click on a *closed* trigger opens the very menu this
   * exists to get rid of.
   */
  const p = page({ open: false });
  let clicked = 0;
  p.trigger.addEventListener('click', () => clicked++);
  assert.equal(p.dismiss(), false);
  assert.equal(p.sent.length, 0, 'a notice on every turn is a notice nobody reads');
  assert.equal(clicked, 0, 'it clicked a closed trigger, which opens the menu');
  assert.equal(p.isOpen(), false);
});

test('when both routes work it stays closed, and is not re-opened', () => {
  /*
   * The ordinary case on a healthy page, and the one the first fixture could not
   * see. Escape closes the menu; a second route that fires regardless then
   * toggles a closed trigger and opens it again.
   */
  const p = page({ open: true });
  let clicks = 0;
  p.trigger.addEventListener('click', () => clicks++);
  p.dismiss();
  assert.equal(p.isOpen(), false, 'closed by Escape, then re-opened by the trigger');
  assert.equal(clicks, 0, 'the trigger was clicked after Escape had already closed it');
});

test('Escape still closes it when the trigger click does nothing', () => {
  // The two routes fail differently. A trigger whose handler changed is the
  // shape of a Gemini redesign; Escape goes through the overlay's keydown and
  // needs no selector at all.
  const p = page({ open: true, triggerWorks: false });
  p.dismiss();
  assert.equal(p.isOpen(), false);
});

test('the trigger still closes it when Escape does nothing', () => {
  const p = page({ open: true, escapeWorks: false });
  p.dismiss();
  assert.equal(p.isOpen(), false);
});

test('a menu found by its items, when the trigger selector has drifted', () => {
  /*
   * The ladder miss this file's header is about. The trigger no longer matches
   * any selector, so `aria-expanded` cannot be read — but the menu's items still
   * can, and Escape needs no selector. This is the case the containment exists
   * for: the picker's own selectors are the thing that broke.
   */
  const p = page({ open: true, triggerSelector: 'renamed' });
  assert.equal(p.dismiss(), true, 'an open menu was missed because its trigger was renamed');
  assert.equal(p.isOpen(), false);
});

test('nothing it can meet makes it throw', () => {
  // On the hot path of every inject. A throw here would fail the send behind it,
  // making this a cause of the lost turn it exists to prevent.
  const env = {
    document: { querySelector() { throw new Error('boom'); }, querySelectorAll() { throw new Error('boom'); } },
    SELECTORS,
    KeyboardEvent: function () { throw new Error('boom'); },
  };
  env.findElement = () => { throw new Error('boom'); };
  env.modelMenuItems = () => { throw new Error('boom'); };
  env.safeSend = () => { throw new Error('boom'); };
  const dismiss = loadFunction(SCRIPT, 'dismissStuckMenu', env);
  assert.doesNotThrow(() => dismiss());
  assert.equal(dismiss(), false);
});
