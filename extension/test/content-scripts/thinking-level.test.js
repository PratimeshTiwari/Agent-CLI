/**
 * Thinking level in the tab (1.65.0): the trigger read, the click path and the
 * check before a prompt is typed. The functions are the shipped source, lifted;
 * what they call is stubbed at the edges (the menu, the clock, the socket).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { loadFunction } from '../load-content-script.js';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '../../content-scripts/gemini-bridge.js');
const norm = (s) => String(s || '').trim().toLowerCase();
const LEVEL_WORDS = ['low', 'medium', 'high'];
const split = (knownLevels = []) => loadFunction(SCRIPT, 'splitTriggerLabel', { norm, LEVEL_WORDS, knownLevels });

test('the trigger names the level after the model, except the lightest', () => {
  const s = split();
  assert.deepEqual(s('Pro Medium'), { model: 'Pro', level: 'Medium' });
  assert.deepEqual(s('3.1 Flash-Lite High'), { model: '3.1 Flash-Lite', level: 'High' });
  assert.deepEqual(s('Flash-Lite'), { model: 'Flash-Lite', level: null });
  assert.deepEqual(s('High'), { model: 'High', level: null }, 'a one-word label is a model, never a bare level');
});

test('levels read from the menu replace the stand-in words, two-word ones included', () => {
  const s = split(['Standard', 'Extra high']);
  assert.deepEqual(s('Pro Extra high'), { model: 'Pro', level: 'Extra high' });
  assert.deepEqual(s('Pro Medium'), { model: 'Pro Medium', level: null }, 'not a level on this account');
});

function applyWith({ now, select }) {
  const sent = [];
  const fn = loadFunction(SCRIPT, 'applyThinking', {
    norm,
    currentThinkingLabel: () => now(),
    selectThinkingLevel: select,
    findElement: () => ({ getAttribute: () => 'false' }),
    SELECTORS: {},
    findModelTriggerStructurally: () => null,
    waitForDom: async (check) => check(),
    MENU_CLOSE_BUDGET_MS: 1,
    safeSend: (m) => sent.push(m),
    splitTriggerLabel: split(),
    currentTriggerText: () => 'Pro High',
  });
  return { fn, sent };
}

test('already on the level: the menu is never opened', async () => {
  let opened = 0;
  const { fn, sent } = applyWith({ now: () => 'High', select: async () => { opened++; } });
  await fn('high');
  await fn(null);
  assert.equal(opened, 0);
  assert.deepEqual(sent, []);
});

test('on another level: set, then reported as the model and the level', async () => {
  const { fn, sent } = applyWith({ now: () => 'Low', select: async (w) => w });
  await fn('High');
  assert.deepEqual(sent, [{ type: 'model_selected', payload: { label: 'Pro', level: 'High' } }]);
});

test('a failure is a notice naming what it stays on, and the prompt still goes', async () => {
  const { fn, sent } = applyWith({ now: () => 'Low', select: async () => { throw new Error('[set_thinking] "High" is locked on this account'); } });
  await fn('High');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'error');
  assert.deepEqual({ ...sent[0].payload, message: undefined },
    { op: 'set_thinking', level: 'notice', wanted: 'High', stays: 'Low', message: undefined });
});

/* The click path, on a picker shaped like the live one. */
const level = (name, { checked = false, lock = false } = {}) => `
  <gem-menu-item role="menuitemradio" aria-checked="${checked}" aria-disabled="false">
    <gem-menu-item-content><div class="leading-container">${lock ? '<mat-icon fonticon="lock"></mat-icon>' : ''}</div>
    <div class="label-container"><span class="label">${name}</span></div></gem-menu-item-content></gem-menu-item>`;
const PAGE = (levels) => `<gem-menu role="menu">
  <gem-menu-item role="menuitemradio" data-mode-id="p1" aria-checked="true"><span class="label">3.1 Pro</span></gem-menu-item>
  <mat-divider class="mat-divider"></mat-divider>
  <gem-menu-item role="menuitem" aria-haspopup="true" aria-expanded="false"><span>Thinking level</span></gem-menu-item>
  <gem-menu role="menu">${levels}</gem-menu></gem-menu>`;

function selectOn(levels) {
  const { window } = new JSDOM(`<body>${PAGE(levels)}</body>`);
  const { document } = window;
  const items = [...document.querySelectorAll('gem-menu-item')];
  let trigger = 'Pro';
  const clicks = [];
  for (const el of items) {
    Object.defineProperty(el, 'offsetWidth', { get: () => 1 });
    el.addEventListener('click', () => {
      clicks.push(el.textContent.trim());
      if (el.getAttribute('role') === 'menuitemradio' && !el.hasAttribute('data-mode-id')) {
        const name = el.textContent.trim();
        trigger = name === 'Low' ? 'Pro' : `Pro ${name}`;
      }
    });
  }
  const modelOptionPieces = loadFunction(SCRIPT, 'modelOptionPieces');
  const describeModelOption = loadFunction(SCRIPT, 'describeModelOption', { modelOptionPieces });
  const describeMenu = loadFunction(SCRIPT, 'describeMenu', { describeModelOption, document, knownLevels: [] });
  const knownLevels = ['Low', 'Medium', 'High'];
  const splitTriggerLabel = split(knownLevels);
  const currentThinkingLabel = () => splitTriggerLabel(trigger).level || knownLevels[0];
  let closed = 0;
  const fn = loadFunction(SCRIPT, 'selectThinkingLevel', {
    norm,
    findModelTrigger: async () => ({}),
    openModelMenu: async () => items,
    closeModelMenu: () => { closed++; },
    describeMenu,
    currentThinkingLabel,
    waitForDom: async (check) => check(),
    MENU_OPEN_BUDGET_MS: 1,
    MODEL_SETTLE_BUDGET_MS: 1,
  });
  return { fn, clicks, closed: () => closed };
}

test('opens the row, clicks the level, reads it back from the trigger', async () => {
  const { fn, clicks } = selectOn(level('Low', { checked: true }) + level('Medium') + level('High'));
  assert.equal(await fn('medium'), 'Medium');
  assert.deepEqual(clicks, ['Thinking level', 'Medium']);
});

test('a locked level is refused, and the menu is shut', async () => {
  const { fn, clicks, closed } = selectOn(level('Low', { checked: true }) + level('Medium') + level('High', { lock: true }));
  await assert.rejects(fn('High'), /locked on this account/);
  assert.deepEqual(clicks, []);
  assert.ok(closed() >= 1);
});

test('a level the picker does not have names what it offered', async () => {
  const { fn } = selectOn(level('Low', { checked: true }) + level('High'));
  await assert.rejects(fn('Medium'), /it offered: Low, High/);
});

test('describeMenu marks the row and the levels, and nothing else', () => {
  const { window } = new JSDOM(`<body>${PAGE(level('Low') + level('High'))}</body>`);
  const { document } = window;
  const modelOptionPieces = loadFunction(SCRIPT, 'modelOptionPieces');
  const describeModelOption = loadFunction(SCRIPT, 'describeModelOption', { modelOptionPieces });
  const describeMenu = loadFunction(SCRIPT, 'describeMenu', { describeModelOption, document, knownLevels: [] });
  const d = describeMenu([...document.querySelectorAll('gem-menu-item')]);
  assert.deepEqual(d.map((m) => [m.submenu, m.level]), [[false, false], [true, false], [false, true], [false, true]]);
});
