import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnEndLine, turnDuration, doneAt } from '../../src/frontend/format.js';

/*
 * `✻ Worked for 3.5s · 2 rounds · 1 edit · done 1:06 AM` — Claude Code's shape
 * (owner, 2026-10-26: "the end-of-turn line gets its own look").
 */

const at = new Date(2026, 9, 28, 1, 6, 30).getTime();

test('the mark, the duration, the breakdown and the clock, in that order', () => {
  assert.equal(turnEndLine({ seconds: 3.54, breakdown: '2 rounds · 1 edit', endedAt: at, locale: 'en-US' }),
    '✻ Worked for 3.5s · 2 rounds · 1 edit · done 1:06 AM');
});

test('the clock follows the locale', () => {
  assert.match(doneAt(at, 'en-GB'), /^0?1:06$/, '24-hour, no AM/PM');
  assert.equal(doneAt(null), null);
});

test('long turns read in minutes and hours, not hundreds of seconds', () => {
  assert.equal(turnDuration(59.94), '59.9s');
  assert.equal(turnDuration(125.3), '2m 5s');
  assert.equal(turnDuration(3 * 3600 + 120), '3h 2m');
});

test('a turn never stamped says Worked, with no duration and no clock', () => {
  assert.equal(turnEndLine({ seconds: null, breakdown: '1 action' }), '✻ Worked · 1 action');
  assert.equal(turnEndLine({ seconds: null }), '✻ Worked');
});
