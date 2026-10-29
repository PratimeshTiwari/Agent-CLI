import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { previewSize, PREVIEW_ROWS } from '../../src/ui/theme-preview.js';
import { panelRoom } from '../../src/ui/panel.js';
import { PALETTES } from '../../src/ui/theme.js';

const SIX = Object.keys(PALETTES).length;
// The menu's own arithmetic: `fit` in Menus.jsx, at a given menu height.
const fitAt = (rows) => (extra) => panelRoom({ rows, width: 100, extra });

test('the box is drawn when the menu has room for it and every palette', () => {
  assert.equal(previewSize(fitAt(20), SIX, 2), 'full', 'a 24-row terminal gives a menu 20 rows');
});

test('it shrinks before a palette is hidden', () => {
  for (let rows = 3; rows <= 30; rows++) {
    const size = previewSize(fitAt(rows), SIX, 2);
    if (size === 'rows') continue; // the floor: nothing smaller to give up
    assert.ok(fitAt(rows)(2 + PREVIEW_ROWS[size]).room >= SIX,
      `${rows} rows: a ${size} preview hid a palette`);
  }
});

test('the floor is the two bare rows, never nothing', () => {
  assert.equal(previewSize(fitAt(8), SIX, 2), 'rows');
  assert.equal(previewSize(fitAt(3), SIX, 2), 'rows');
});

test('bigger menus never get a smaller preview', () => {
  const order = ['rows', 'boxed', 'full'];
  let last = 0;
  for (let rows = 3; rows <= 40; rows++) {
    const at = order.indexOf(previewSize(fitAt(rows), SIX, 2));
    assert.ok(at >= last, `${rows} rows went down to ${order[at]}`);
    last = at;
  }
});

test('/theme and setup draw the same preview component', () => {
  for (const file of ['Menus.jsx', 'Onboarding.jsx']) {
    const src = readFileSync(new URL(`../../src/ui/components/${file}`, import.meta.url), 'utf8');
    assert.match(src, /<ThemePreview /, `${file} has its own copy of the sample again`);
  }
});
