/**
 * The diff approval box fits the terminal (v9.9.6). At 13 rows a two-line edit
 * drew a frame exactly as tall as the screen, which Ink answers by clearing it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffBoxLayout, DIFF_BOX_BELOW, rowsFromPatch } from '../../../src/frontend/transcript/diff-preview.js';

const patch = (n) => ['@@ -1,1 +1,' + (n + 1) + ' @@', ' const a = 1;', ...Array.from({ length: n }, (_, i) => `+line ${i}`)].join('\n');

test('every height leaves the frame shorter than the screen', () => {
  // 13 rows is the floor the frame is held to (COMPACT_BELOW_ROWS); below it the
  // box sheds what it can and still needs its choices.
  for (const terminalHeight of [13, 16, 20, 24, 40]) {
    for (const n of [1, 2, 10, 40]) {
      for (const expanded of [false, true]) {
        const l = diffBoxLayout({ patch: patch(n), choices: 3, reason: true, expanded, terminalHeight });
        assert.ok(l.height + DIFF_BOX_BELOW <= terminalHeight,
          `${terminalHeight} rows, ${n} lines, expanded ${expanded}: box ${l.height}`);
        assert.ok(l.rows.length >= 1, 'at least one line of the change is shown');
      }
    }
  }
});

test('13 rows, a two-line edit: spacing goes first, the reason and the lines stay', () => {
  const l = diffBoxLayout({ patch: patch(1), choices: 3, reason: true, terminalHeight: 13 });
  assert.equal(l.height, 9);
  assert.equal(l.margins, false);
  assert.equal(l.reason, true);
  assert.equal(l.rows.length, 3);
});

test('control: a tall terminal keeps the old box: 16 lines, spacing and reason', () => {
  const l = diffBoxLayout({ patch: patch(40), choices: 3, reason: true, terminalHeight: 40 });
  assert.deepEqual([l.margins, l.reason, l.hint], [true, true, true]);
  assert.deepEqual(l.rows, rowsFromPatch(patch(40), { maxLines: 16 }));
});

test('expanded grows into the room there is, and no further', () => {
  const l = diffBoxLayout({ patch: patch(40), choices: 2, reason: false, expanded: true, terminalHeight: 30 });
  assert.equal(l.height, 30 - DIFF_BOX_BELOW);
  assert.ok(l.rows.length > 16);
});
