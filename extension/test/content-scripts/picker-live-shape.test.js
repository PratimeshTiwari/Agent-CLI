/**
 * The picker as it is on the live page (read 2026-11-06 with Claude in Chrome),
 * run through the bridge's own functions.
 *
 * Models are `menuitemradio` with `data-mode-id`; a rule; a `menuitem` row that
 * opens Thinking level; levels as `menuitemradio` with no `data-mode-id`. On
 * the Auto account 3.1 Pro and 4 Argon carry a lock icon and keep
 * `aria-disabled="false"`.
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
const modelOptionPieces = loadFunction(SCRIPT, 'modelOptionPieces');
const describeModelOption = loadFunction(SCRIPT, 'describeModelOption', { modelOptionPieces });
const markSelected = loadFunction(SCRIPT, 'markSelected', { norm });

const model = (id, name, sub, { checked = false, lock = false, disabled = false } = {}) => `
  <gem-menu-item role="menuitemradio" aria-checked="${checked}" aria-disabled="${disabled}" aria-haspopup="false"
      data-mode-id="${id}" class="${checked ? 'selected ' : ''}ng-star-inserted">
    <gem-menu-item-content class="checkmark-only"><div class="leading-container">${
      checked ? '<mat-icon fonticon="check" class="mat-icon"></mat-icon>' : ''
    }${lock ? '<mat-icon fonticon="lock" class="mat-icon"></mat-icon>' : ''}</div>
      <div class="label-container"><span class="label">${name}</span><div class="sublabel">${sub}</div></div>
      <div class="trailing-container"></div></gem-menu-item-content></gem-menu-item>`;
const level = (name, sub, checked = false) => `
  <gem-menu-item role="menuitemradio" aria-checked="${checked}" aria-disabled="false" class="${checked ? 'selected' : ''}">
    <gem-menu-item-content><div class="label-container"><span class="label">${name}</span>
      <div class="sublabel">${sub}</div></div></gem-menu-item-content></gem-menu-item>`;
// The levels' pane sits inside the main menu, after the row. The live page was
// not dumped that deep, but the real `describeMenu` run on it marked the levels
// as after the rule, which only that nesting gives.
const page = (models) => `
  <div class="cdk-overlay-pane"><gem-menu role="menu" data-test-id="gem-mode-menu">
    ${models}
    <mat-divider class="mat-divider mat-divider-horizontal"></mat-divider>
    <gem-menu-item role="menuitem" aria-haspopup="true" aria-expanded="false">
      <gem-menu-item-content><div><span>Thinking level</span></div>
      <div class="trailing-container"><mat-icon fonticon="arrow_right"></mat-icon></div></gem-menu-item-content>
    </gem-menu-item>
    <div class="cdk-overlay-pane"><gem-menu role="menu">
      ${level('Low', 'Quick and efficient', true)}${level('Medium', 'Balanced depth')}${level('High', 'Extra thorough')}
    </gem-menu></div>
  </gem-menu></div>`;
const AUTO = page(model('a1', 'Auto', 'Gemini 3 models', { checked: true })
  + model('p1', '3.1 Pro', 'Advanced reasoning', { lock: true })
  + model('g1', '4 Argon', 'Complex tasks', { lock: true }));
const FULL = page(model('l1', '3.5 Flash-Lite', 'Fastest answers')
  + model('f1', '3.8 Flash', 'All-around help', { checked: true })
  + model('p1', '3.1 Pro', 'Advanced reasoning') + model('g1', '4 Argon', 'Complex tasks'));

function read(html) {
  const { window } = new JSDOM(`<body>${html}</body>`);
  const { document } = window;
  const SELECTORS = { modelMenuItem: loadSelectors() };
  const modelMenuItems = loadFunction(SCRIPT, 'modelMenuItems', { SELECTORS, document });
  const describeMenu = loadFunction(SCRIPT, 'describeMenu', { noteTickedLevel: () => {}, describeModelOption, document });
  const items = modelMenuItems();
  return { items, described: describeMenu(items) };
}
// The selector list as shipped, lifted from the source rather than copied.
function loadSelectors() {
  const src = require('node:fs').readFileSync(SCRIPT, 'utf8');
  const block = src.slice(src.indexOf('modelMenuItem: ['), src.indexOf('],', src.indexOf('modelMenuItem: [')) + 1);
  return eval(block.slice(block.indexOf('[')));
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const brief = (d) => d.map((x) => [x.label, x.isMode ? 'mode' : 'model', x.selected ? 'sel' : '', x.locked ? 'locked' : ''].join('|'));

test('the Auto account: locks read, levels are modes, Auto is the model', () => {
  const { items, described } = read(AUTO);
  assert.equal(items.length, 7, 'every entry, not just the role=menuitem row');
  assert.deepEqual(brief(described), [
    'Auto|model|sel|', '3.1 Pro|model||locked', '4 Argon|model||locked',
    'Thinking level|mode||', 'Low|mode|sel|', 'Medium|mode||', 'High|mode||',
  ]);
});

test('the four-model account: nothing locked, the check icon is not a lock', () => {
  const { described } = read(FULL);
  assert.deepEqual(described.filter((d) => d.locked), []);
  assert.deepEqual(described.filter((d) => !d.isMode).map((d) => d.label),
    ['3.5 Flash-Lite', '3.8 Flash', '3.1 Pro', '4 Argon']);
});

test('levels are modes even with no rule, by data-mode-id', () => {
  const { described } = read(AUTO.replace(/<mat-divider[^>]*><\/mat-divider>/, ''));
  assert.deepEqual(described.filter((d) => !d.isMode).map((d) => d.label), ['Auto', '3.1 Pro', '4 Argon']);
});

test('negative control: no data-mode-id anywhere leaves the rule alone in charge', () => {
  const { described } = read(FULL.replace(/data-mode-id="\w+"/g, ''));
  assert.deepEqual(described.filter((d) => !d.isMode).map((d) => d.label),
    ['3.5 Flash-Lite', '3.8 Flash', '3.1 Pro', '4 Argon']);
});

test('a lock drawn as ligature text, or aria-disabled, is a lock too', () => {
  const { described } = read(AUTO.replace('<mat-icon fonticon="lock" class="mat-icon"></mat-icon>', '<mat-icon>lock</mat-icon>'));
  // By position: a ligature puts "lock" in the text, and jsdom has no innerText
  // to leave it out. The live page draws icons by attribute.
  assert.deepEqual(described.slice(0, 3).map((d) => d.locked), [false, true, true]);
  const { described: d2 } = read(page(model('f1', '3.8 Flash', 'All-around help', { checked: true })
    + model('p1', '3.1 Pro', 'Advanced reasoning', { disabled: true })));
  assert.equal(d2.find((d) => d.label === '3.1 Pro').locked, true);
  assert.equal(d2.find((d) => d.label === '3.8 Flash').locked, false);
});

test('the trigger "Gemini Auto" selects Auto and leaves the level ticked', () => {
  const { described } = read(AUTO);
  const cleared = described.map((d) => (d.isMode ? d : { ...d, selected: false }));
  const rows = markSelected(cleared, 'Gemini Auto');
  assert.deepEqual(rows.filter((r) => r.selected).map((r) => r.label), ['Auto', 'Low']);
});

test('markSelected still tells Flash from Flash-Lite with levels present', () => {
  const { described } = read(FULL);
  const rows = markSelected(described.map((d) => (d.isMode ? d : { ...d, selected: false })), 'Flash');
  assert.deepEqual(rows.filter((r) => r.selected && !r.isMode).map((r) => r.label), ['3.8 Flash']);
});

test('a second row that opens a submenu does not shrink the list to the rows', () => {
  const two = AUTO.replace('<mat-divider', `<gem-menu-item role="menuitem" aria-haspopup="true">
    <gem-menu-item-content><span>Another menu</span></gem-menu-item-content></gem-menu-item><mat-divider`);
  const { items } = read(two);
  assert.equal(items.length, 8, 'the role selector alone matches only the two rows');
});

test('a switch to a locked model throws and clicks nothing', async () => {
  const { window } = new JSDOM(`<body>${AUTO}</body>`);
  const { document } = window;
  const items = [...document.querySelectorAll('gem-menu-item')];
  let clicks = 0;
  for (const el of items) el.addEventListener('click', () => { clicks += 1; });
  let closed = 0;
  const describeMenu = loadFunction(SCRIPT, 'describeMenu', { noteTickedLevel: () => {}, describeModelOption, document });
  const selectModelByLabel = loadFunction(SCRIPT, 'selectModelByLabel', {
    findModelTrigger: async () => document.body,
    openModelMenu: async () => items,
    closeModelMenu: () => { closed += 1; },
    describeModelOption,
    describeMenu,
    currentModelLabel: () => 'Gemini Auto',
    waitForDom: async () => null,
    markSelected,
    MODEL_SETTLE_BUDGET_MS: 1,
  });
  await assert.rejects(selectModelByLabel('3.1 Pro'), /"3\.1 Pro" is locked on this account/);
  assert.equal(clicks, 0, 'a locked entry was clicked');
  assert.ok(closed >= 1, 'the menu was left open');
  // Control: an unlocked entry is clicked.
  await selectModelByLabel('Auto');
  assert.equal(clicks, 1);
});

/*
 * The picker as read live on 2026-11-13 (/u/3): the purpose on the label line
 * and the model on the sublabel — "Code and analysis / 4 Argon". Reported as
 * `/effort` failing every switch with "it stayed on Low": the server matched on
 * purposes, and the trigger, which still names the model, matched none of them.
 */
const TURNED = page(model('a1', 'Auto', 'Adapts to your needs', { checked: true })
  + model('l1', 'Quick answers', '3.5 Flash-Lite')
  + model('f1', 'Everyday help', '3.8 Flash')
  + model('p1', 'Code and analysis', '3.1 Pro')
  + model('g1', 'Most complex work', '4 Argon', { lock: true }));

test('2026-11-13: the model name is the label, wherever Gemini puts it', () => {
  const { described } = read(TURNED);
  assert.deepEqual(described.filter((d) => !d.isMode).map((d) => [d.label, d.description]), [
    ['Auto', 'Adapts to your needs'],
    ['3.5 Flash-Lite', 'Quick answers'], ['3.8 Flash', 'Everyday help'],
    ['3.1 Pro', 'Code and analysis'], ['4 Argon', 'Most complex work'],
  ]);
  // Levels have no version on either line and stay as they are.
  assert.deepEqual(described.filter((d) => d.level).map((d) => d.label), ['Low', 'Medium', 'High']);
});

test('2026-11-13: the trigger naming a model, or a purpose, selects that model', () => {
  const { described } = read(TURNED);
  const cleared = described.map((d) => (d.isMode ? d : { ...d, selected: false }));
  const picked = (t) => markSelected(cleared, t).filter((r) => r.selected && !r.isMode).map((r) => r.label);
  assert.deepEqual(picked('Pro'), ['3.1 Pro']);
  assert.deepEqual(picked('Flash'), ['3.8 Flash']);
  assert.deepEqual(picked('Code and analysis'), ['3.1 Pro']);
});

