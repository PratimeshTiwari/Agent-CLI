/**
 * The turn summary says how many round trips a turn took.
 *
 * Rounds are the real cost here — every one is an inject → think → scrape
 * cycle through the browser — and the transcript cannot count them: a round
 * of only tool calls leaves no reply in it. So the loop stamps each call with
 * its round and the summary reads the highest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { workBreakdown } from '../../src/ui/format.js';

const tool = (toolName, round) => ({ type: 'tool', toolName, msg: { round } });

test('rounds lead the breakdown, counted as the highest stamp', () => {
  assert.equal(workBreakdown([tool('read_file', 1), tool('grep_search', 1), tool('edit_file', 2), tool('run_command', 3)]),
    '3 rounds · 2 reads · 1 edit · 1 command');
  assert.equal(workBreakdown([tool('read_file', 1)]), '1 round · 1 read');
});

test('control: calls with no stamp (old sessions) still summarise, without rounds', () => {
  assert.equal(workBreakdown([{ type: 'tool', toolName: 'read_file', msg: {} }]), '1 read');
});
