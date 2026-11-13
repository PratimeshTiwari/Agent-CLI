/**
 * The "+" menu is not the mode picker (1.67.0).
 *
 * Reported 2026-11-14 from a work account whose picker reads "Chat": `/effort`
 * offered "Upload files", "Add from Drive" and "More uploads" as models. On a
 * fresh tab the structural search answered before the picker mounted, and the
 * only popup button there was the "+" one. Its label on /u/3 is "Upload and
 * tools" (read live 2026-11-14); the work account's was not seen.
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
const NOT_MODELS = /upload|drive|file|photo|camera|import|notebook|attach/i;
const foreignMenu = loadFunction(SCRIPT, 'foreignMenu', { describeModelOption, NOT_MODELS });

const item = (label, id) => `<gem-menu-item role="menuitem"${id ? ` data-mode-id="${id}"` : ''}>
  <div class="label-container"><span class="label">${label}</span></div></gem-menu-item>`;
const items = (html) => [...new JSDOM(`<div role="menu">${html}</div>`).window.document.querySelectorAll('gem-menu-item')];

test('the upload menu is refused by name', () => {
  const got = foreignMenu(items(item('Upload files') + item('Add from Drive') + item('More uploads')));
  assert.deepEqual(got, ['Upload files', 'Add from Drive', 'More uploads']);
});

test('control: the mode picker is accepted, with or without data-mode-id', () => {
  assert.equal(foreignMenu(items(item('Auto', 'a1') + item('Code and analysis', 'argon'))), null);
  assert.equal(foreignMenu(items(item('3.8 Flash') + item('3.1 Pro'))), null);
});

const composer = (buttons) => new JSDOM(`<body><div class="input-area">
  <div><div class="ql-editor" contenteditable="true"></div></div>${buttons}</div></body>`).window.document;

function structural(document) {
  const findInputResilient = () => document.querySelector('.ql-editor');
  return loadFunction(SCRIPT, 'findModelTriggerStructurally', { findInputResilient })();
}

test('the structural search skips "+" and prefers a button that says it is the picker', () => {
  const doc = composer(`<button aria-haspopup="menu" aria-label="Add files">+</button>
    <button aria-haspopup="true" aria-label="Notes">x</button>
    <button aria-haspopup="true" aria-label="Choose model, currently Chat">Chat</button>`);
  assert.equal(structural(doc).getAttribute('aria-label'), 'Choose model, currently Chat');
});

test('the selectors get their whole wait before the structural search answers', async () => {
  const doc = composer('<button aria-haspopup="menu" aria-label="Tools">+</button>');
  const picker = { id: 'picker' };
  let calls = 0;
  const findModelTrigger = loadFunction(SCRIPT, 'findModelTrigger', {
    findElement: () => null,
    // The picker mounts while the selectors are being waited on.
    waitForDom: async (fn) => { calls += 1; return picker; },
    findModelTriggerStructurally: () => { throw new Error('structural search ran before the wait'); },
    SELECTORS: { modelTrigger: [] },
    PICKER_READY_BUDGET_MS: 1,
    selectorsMissed: false,
    document: doc,
  });
  assert.equal(await findModelTrigger(), picker);
  assert.equal(calls, 1);
});

test('a page whose selectors never match waits once, then goes straight to the search', async () => {
  let waits = 0;
  const findModelTrigger = loadFunction(SCRIPT, 'findModelTrigger', {
    findElement: () => null,
    waitForDom: async () => { waits += 1; return null; },
    findModelTriggerStructurally: () => 'found',
    SELECTORS: { modelTrigger: [] },
    PICKER_READY_BUDGET_MS: 1,
    selectorsMissed: false,
  });
  assert.equal(await findModelTrigger(), 'found');
  assert.equal(await findModelTrigger(), 'found');
  assert.equal(waits, 1);
});
