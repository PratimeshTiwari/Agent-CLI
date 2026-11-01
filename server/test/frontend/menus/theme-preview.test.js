import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { previewSize, PREVIEW_ROWS } from '../../../src/frontend/menus/theme-preview.js';
import { panelRoom } from '../../../src/frontend/menus/panel.js';
import { PALETTES, PALETTE_INFO } from '../../../src/frontend/theme.js';

const SIX = Object.keys(PALETTES).length;
// The menu's own arithmetic: `fit` in Menus.jsx, at a given menu height.
const fitAt = (rows) => (extra) => panelRoom({ rows, width: 100, extra });

test('the box is drawn when the menu has room for it and every palette', () => {
  assert.equal(previewSize(fitAt(20), SIX, 1), 'full', 'a 24-row terminal gives a menu 20 rows');
});

test('it shrinks before a palette is hidden', () => {
  for (let rows = 3; rows <= 30; rows++) {
    const size = previewSize(fitAt(rows), SIX, 1);
    if (size === 'rows') continue; // the floor: nothing smaller to give up
    assert.ok(fitAt(rows)(1 + PREVIEW_ROWS[size]).room >= SIX,
      `${rows} rows: a ${size} preview hid a palette`);
  }
});

test('the floor is the two bare rows, never nothing', () => {
  assert.equal(previewSize(fitAt(8), SIX, 1), 'rows');
  assert.equal(previewSize(fitAt(3), SIX, 1), 'rows');
});

test('bigger menus never get a smaller preview', () => {
  const order = ['rows', 'boxed', 'full'];
  let last = 0;
  for (let rows = 3; rows <= 40; rows++) {
    const at = order.indexOf(previewSize(fitAt(rows), SIX, 1));
    assert.ok(at >= last, `${rows} rows went down to ${order[at]}`);
    last = at;
  }
});

test('every palette says what it is beside its name', () => {
  for (const [name, info] of Object.entries(PALETTE_INFO)) {
    assert.ok(info.label && info.blurb, `${name} has no label or blurb`);
  }
  // "Terminal" next to "Dark" did not say that one follows your terminal.
  assert.match(PALETTE_INFO.terminal.label + PALETTE_INFO.terminal.blurb, /terminal/i);
  assert.match(PALETTE_INFO.dark.blurb, /fixed/);
  const menus = readFileSync(new URL('../../../src/frontend/components/Menus.jsx', import.meta.url), 'utf8');
  assert.match(menus, /detail: PALETTE_INFO\[n\]\.blurb/, '/theme shows the blurb beside each name');
});

test('/theme and setup draw the same preview component', () => {
  for (const file of ['Menus.jsx', 'Onboarding.jsx']) {
    const src = readFileSync(new URL(`../../../src/frontend/components/${file}`, import.meta.url), 'utf8');
    assert.match(src, /<ThemePreview /, `${file} has its own copy of the sample again`);
  }
});
