/**
 * The shared menu look (`ui/panel.js`): every row a menu draws is one it was
 * given, and the choice under the cursor is always on screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wrapLines, panelRoom, listWindow, settingTone } from '../../src/ui/panel.js';
import { ROLES } from '../../src/ui/theme.js';
import { describeSettings } from '../../src/core/settings.js';

test('listWindow: never taller than its room, and the cursor is always shown', () => {
  for (let count = 0; count <= 30; count++) {
    for (let room = 1; room <= 14; room++) {
      for (let cursor = 0; cursor < Math.max(1, count); cursor++) {
        const w = listWindow({ count, cursor, room });
        const rows = (w.end - w.start) + (w.above && room >= 3 ? 1 : 0) + (w.below && room >= 3 ? 1 : 0);
        const ctx = JSON.stringify({ count, room, cursor, w });
        assert.ok(rows <= Math.max(room, count <= room ? count : room), `too tall: ${ctx}`);
        if (count) assert.ok(cursor >= w.start && cursor < w.end, `cursor hidden: ${ctx}`);
        assert.equal(w.above, w.start, ctx);
        assert.equal(w.below, count - w.end, ctx);
        if (count) assert.ok(w.end > w.start, `nothing shown: ${ctx}`);
      }
    }
  }
});

test('listWindow: a list that fits has no markers', () => {
  assert.deepEqual(listWindow({ count: 4, cursor: 3, room: 4 }), { start: 0, end: 4, above: 0, below: 0 });
});

test('panelRoom: spacing goes first, then the description, never the list', () => {
  const sub = 'Allowed commands run without asking. Blocked ones are refused outright, and this sentence is long.';
  const tall = panelRoom({ rows: 20, width: 60, subtitle: sub });
  assert.equal(tall.tight, false);
  assert.equal(tall.sub.length, 2);
  assert.equal(tall.room, 20 - (2 + 2 + 2 + 1));
  const mid = panelRoom({ rows: 13, width: 60, subtitle: sub });
  assert.equal(mid.sub.length, 1);
  const short = panelRoom({ rows: 9, width: 60, subtitle: sub });
  assert.equal(short.tight, true);
  assert.deepEqual(short.sub, []);
  assert.equal(short.room, 9 - 3);
});

test('wrapLines: cut lines say so and stay inside the width', () => {
  const lines = wrapLines('one two three four five six seven eight nine ten', 12, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
  for (const l of lines) assert.ok(l.length <= 12, l);
});

test('no menu draws a border any more', () => {
  // The owner's complaint was the boxes themselves. A border added back to one
  // menu is the drift this guards against: it is two rows nobody charged for.
  const src = readFileSync(new URL('../../src/ui/components/Menus.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /borderStyle=/);
  assert.doesNotMatch(src, /from 'ink-select-input'/, 'a menu is back on the old list');
});

test('settings values are coloured by kind: on, off, modes, levels, waiting work, paths', () => {
  assert.equal(settingTone({ label: 'Memory', value: 'on' }), 'success');
  assert.equal(settingTone({ label: 'Subagents', value: 'off' }), 'muted');
  assert.equal(settingTone({ label: 'Edit approval', value: 'strict' }), 'strict');
  assert.equal(settingTone({ label: 'Effort', value: 'high' }), 'link');
  assert.equal(settingTone({ label: 'Diffs', value: '2 pending' }), 'attention');
  assert.equal(settingTone({ label: 'Diffs', value: '0 pending' }), 'muted');
  assert.equal(settingTone({ label: 'Extension', value: 'not connected yet' }), 'attention');
  assert.equal(settingTone({ label: 'Workspace', value: '/w' }), 'muted');
  assert.equal(settingTone({ label: 'Turns', value: '14' }), 'text');
});

test('every settings tone is a role a palette defines', () => {
  for (const row of describeSettings(null)) {
    const tone = settingTone(row);
    assert.ok(ROLES.includes(tone), `${row.label}: ${tone}`);
  }
});
