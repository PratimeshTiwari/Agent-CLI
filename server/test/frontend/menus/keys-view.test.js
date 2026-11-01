/**
 * `?` on an empty prompt shows the keys (v6.18, plan Phase 9): a short grid
 * in the palette's place, charged the palette's rows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEY_HINTS, keyCell, keysLayout } from '../../../src/frontend/menus/keys-view.js';
import { KEY_ROWS } from '../../../src/frontend/menus/help.js';

test('every key in the glance is one /help lists in full', () => {
  const full = KEY_ROWS.map(([k]) => k);
  for (const [key] of KEY_HINTS) {
    const known = full.includes(key) || full.some((k) => k.split(' ').includes(key));
    assert.ok(known, `${key} is not in /help's keys`);
  }
});

test('columns by width, filled down then across, all twelve when there is room', () => {
  const wide = keysLayout(120, 6);
  assert.equal(wide.length, 4);
  assert.ok(wide.every((row) => row.length === 3));
  assert.equal(wide[0][0].key, '/');
  assert.equal(wide[1][0].key, 'shift+tab', 'down first');
  assert.equal(keysLayout(80, 6).length, 6);
  assert.equal(keysLayout(50, 20).length, 12);
});

test('short of rows: as many as fit, the last cell pointing at /help', () => {
  const g = keysLayout(80, 3);
  assert.equal(g.length, 3);
  const cells = g.flat();
  assert.equal(cells.length, 6);
  assert.deepEqual(cells.map((c) => c.key).at(-1), '/help');
  assert.equal(keysLayout(80, 1).flat().length, 2, 'one row at 13 rows during a turn');
});

test('a cell never runs past its column', () => {
  for (const width of [40, 60, 80, 96, 140]) {
    for (const row of keysLayout(width, 6)) {
      const text = row.map((c) => { const { key, desc } = keyCell(c); return key + desc; }).join('');
      assert.ok(text.length <= width - 2, `${width}: ${text.length} "${text}"`);
    }
  }
});

test('App charges the grid to the frame like the palette, and only for a lone ?', () => {
  const app = readFileSync(new URL('../../../src/frontend/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /input === '\?' && !activeMenu\s*\? keysLayout\(terminalWidth, paletteRoom\)/);
  assert.match(app, /- \(keysGrid \? keysGrid\.length : 0\)/);
});
