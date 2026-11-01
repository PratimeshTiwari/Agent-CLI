/**
 * The shared menu look (`frontend/menus/panel.js`): every row a menu draws is one it was
 * given, and the choice under the cursor is always on screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wrapLines, panelRoom, listWindow, settingTone } from '../../../src/frontend/menus/panel.js';
import { ROLES } from '../../../src/frontend/theme.js';
import { describeSettings } from '../../../src/backend/core/settings.js';

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
  const src = readFileSync(new URL('../../../src/frontend/components/Menus.jsx', import.meta.url), 'utf8');
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

/*
 * v6.3, owner: the Subagents menu "seems very cluttered" — a 169-character
 * paragraph under the title. Every literal description a menu passes to
 * `fit` is one plain line now; a dynamic one (`${…}`) is not ours to measure.
 */
const SUB_MAX = 60;
test('every menu description is one short plain line', () => {
  const src = readFileSync(new URL('../../../src/frontend/components/Menus.jsx', import.meta.url), 'utf8');
  const subs = [...src.matchAll(/fit\(\s*('([^'\\]|\\.)*'|`[^`]*`)/g)].map((m) => m[1].slice(1, -1));
  assert.ok(subs.length >= 8, `found only ${subs.length} descriptions — the scan is broken`);
  for (const sub of subs) {
    if (!sub || sub.includes('${')) continue;
    assert.ok(sub.length <= SUB_MAX, `${sub.length} characters: "${sub}"`);
    assert.doesNotMatch(sub, / — /, `two clauses: "${sub}"`);
  }
  // A description built with `+` across lines is how the long ones hid.
  assert.doesNotMatch(src, /fit\(\s*\n?\s*'[^']*'\s*\n?\s*\+/, 'a description is concatenated');
});

test('switch menus say their state in colour, and options lead with a glyph', () => {
  const src = readFileSync(new URL('../../../src/frontend/components/Menus.jsx', import.meta.url), 'utf8');
  for (const title of ['Subagents', 'Command rules']) {
    assert.match(src, new RegExp(`title="${title}" \\{\\.\\.\\.onOff\\(`), `${title} has no coloured state`);
  }
  assert.match(src, /glyph: '●', glyphTone: 'success', label: 'On'/);
  assert.match(src, /glyph: '\+', glyphTone: 'success', label: 'Allow a command…'/);
  const panel = readFileSync(new URL('../../../src/frontend/components/Panel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /statusTone/, 'Panel colours its status');
  assert.match(panel, /showNumbers = numbered && !glyphs/, 'a glyph list hides the number column');
});

test('a label past the column cap is cut, so every detail starts in one column (v7.9)', async () => {
  const { fitLabel } = await import('../../../src/frontend/components/Panel.jsx').catch(() => ({}));
  // Panel.jsx is JSX; when it cannot be imported under plain node, read the source.
  if (fitLabel) {
    assert.equal(fitLabel('Switch the browser to 3.1 Pro', 28).length, 28);
    assert.equal(fitLabel('Ask', 6), 'Ask   ');
  } else {
    const src = readFileSync(new URL('../../../src/frontend/components/Panel.jsx', import.meta.url), 'utf8');
    assert.match(src, /const label = hasDetail \? fitLabel\(String\(item\.label\), labelWidth\)/);
    assert.match(src, /text\.length > width \? `\$\{text\.slice\(0, Math\.max\(0, width - 1\)\)\}…` : text\.padEnd\(width\)/);
  }
});

test('the mismatch ask has two answers: match the agent, match the browser (v7.9)', () => {
  const src = readFileSync(new URL('../../../src/frontend/components/Menus.jsx', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf("activeMenu?.type === 'effort_mismatch'"), src.indexOf("activeMenu?.type === 'startup'"));
  assert.equal((block.match(/label: 'Match the (agent|browser)'/g) || []).length, 2);
  assert.doesNotMatch(block, /label: `Send on /, 'the third, one-off answer is gone');
});
