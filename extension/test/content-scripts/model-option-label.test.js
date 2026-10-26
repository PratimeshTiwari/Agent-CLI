/**
 * A picker entry's name and purpose come back as two fields, however it is read.
 *
 * Reported 2026-10-27: the status bar read `3.8 Flash All-around help`. The
 * entry was split on the line breaks in `innerText`, which exist only when the
 * entry is laid out as two blocks; read any other way the name and the purpose
 * are one line. jsdom has no `innerText` at all, so `textContent` here is the
 * honest model of that case.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { loadFunction } from '../load-content-script.js';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '../../content-scripts/gemini-bridge.js');
const modelOptionPieces = loadFunction(SCRIPT, 'modelOptionPieces');
const describeModelOption = loadFunction(SCRIPT, 'describeModelOption', { modelOptionPieces });

const entry = (html) => {
  const { document } = new JSDOM(`<div role="menu">${html}</div>`).window;
  return document.querySelector('[role="menuitem"]');
};

// Angular's whitespace between the two spans is what made "Flash All-around".
const GEMINI = `<button role="menuitem" class="selected"><div class="content">
  <mat-icon aria-hidden="true">check</mat-icon>
  <div class="title">3.8 Flash</div>
  <div class="description">All-around help</div>
</div></button>`;

/** An entry as Chrome reported it: `innerText` with the two on one line. */
const asRead = (html, innerText) => {
  const el = entry(html);
  if (innerText !== undefined) Object.defineProperty(el, 'innerText', { value: innerText });
  return describeModelOption(el);
};

test('the reported case: name and purpose on one line', () => {
  const got = asRead(GEMINI, '3.8 Flash All-around help');
  assert.equal(got.label, '3.8 Flash');
  assert.equal(got.description, 'All-around help');
  assert.equal(got.selected, true);
});

test('markup inside the name stays in the name', () => {
  const got = asRead(`<button role="menuitem"><span class="t">3.1 <b>Pro</b></span>
    <span class="d">Advanced reasoning</span></button>`, '3.1 Pro Advanced reasoning');
  assert.equal(got.label, '3.1 Pro');
  assert.equal(got.description, 'Advanced reasoning');
});

test('an entry that really is one piece is left whole', () => {
  const got = asRead('<button role="menuitem"><span>Extended thinking</span></button>', 'Extended thinking');
  assert.equal(got.label, 'Extended thinking');
  assert.equal(got.description, '');
});

test('control: with the line break there, the lines decide, as before', () => {
  const got = asRead(GEMINI, '3.8 Flash\nAll-around help');
  assert.equal(got.label, '3.8 Flash');
  assert.equal(got.description, 'All-around help');
});
