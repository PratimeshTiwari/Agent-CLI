/**
 * The status bar's context field says where compaction happens, briefly.
 *
 * It appended ` · 18% to auto-compact` / ` · compacts after this turn` to
 * `62% of 96k`, on a side of the bar that does not shrink, so near the
 * threshold the left side — `agent · scope · /help` — was squeezed off.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { contextField } from '../../src/ui/format.js';

test('far from the threshold: the budget', () => {
  assert.equal(contextField(18, 96000, 80), '18% of 96k');
  assert.equal(contextField(59, 500, 80), '59% of 500');
});

test('within twenty points: where it compacts, and no budget', () => {
  assert.equal(contextField(60, 96000, 80), '60% · compacts at 80%');
  assert.equal(contextField(79, 96000, 80), '79% · compacts at 80%');
});

test('at or past it: next', () => {
  assert.equal(contextField(80, 96000, 80), '80% · compacts next');
  assert.equal(contextField(93, 96000, 80), '93% · compacts next');
});

test('never longer than the field it replaced at its longest', () => {
  for (let pct = 0; pct <= 100; pct += 1) {
    assert.ok(contextField(pct, 96000, 80).length <= '100% of 96k · 20% to auto-compact'.length - 10, String(pct));
  }
});
