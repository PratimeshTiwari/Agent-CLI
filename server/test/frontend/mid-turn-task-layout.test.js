/**
 * ctrl+o during a turn: the task list is charged to the turn, and gives way first.
 * A frame taller than the terminal is Ink's clear-and-repaint path, so a row
 * drawn here must be a row the turn gave up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactBodyLines, midTurnTaskLayout } from '../../src/frontend/transcript/live-layout.js';

const layout = (o) => midTurnTaskLayout({ open: true, lines: 4, budget: 20, ...o });

test('closed, empty or compact draws nothing and costs nothing', () => {
  assert.deepEqual(layout({ open: false }), { rows: 0, lines: 0 });
  assert.deepEqual(layout({ lines: 0 }), { rows: 0, lines: 0 });
  assert.deepEqual(layout({ compact: true }), { rows: 0, lines: 0 });
});

test('a list that fits costs its lines, a header and a margin', () => {
  assert.deepEqual(layout({ lines: 4 }), { rows: 6, lines: 4 });
});

test('a list that does not fit says so on a row of its own, and that row is charged', () => {
  assert.deepEqual(layout({ lines: 20 }), { rows: 8, lines: 5 });
});

test('the turn always keeps its floor', () => {
  for (let budget = 1; budget <= 30; budget++) {
    for (const lines of [1, 2, 6, 7, 40]) {
      const { rows } = layout({ budget, lines });
      assert.ok(rows === 0 || budget - rows >= 3, `budget ${budget}, ${lines} lines: ${rows} rows`);
    }
  }
});

test('with room for one line, a longer list is not drawn as a list of one', () => {
  assert.deepEqual(layout({ budget: 6, lines: 1 }), { rows: 3, lines: 1 });
  assert.deepEqual(layout({ budget: 6, lines: 2 }), { rows: 0, lines: 0 });
});

test('the count is of drawn lines across every artifact', () => {
  assert.deepEqual(artifactBodyLines({ task: '- [ ] a\n\n- [ ] b\n', walkthrough: 'done' }), ['- [ ] a', '- [ ] b', 'done']);
  assert.deepEqual(artifactBodyLines(null), []);
});
