/**
 * A hold that bought nothing is written down, with the text it held on.
 *
 * Three turns on 2026-09-27 finished with `complete` at 12000, 12001 and 11998ms
 * — six grace checks on the confirming cadence, spent after Gemini had already
 * stopped. The cause is not known and is deliberately not guessed at: the one
 * diagnosed cause is fixed, the real extractor over a tool-call block clears
 * the check, and the only offline evidence ("0 of 62 stored replies held") was
 * taken from replies with their tool calls stripped. So the record carries the
 * one thing that would settle it: the tail of what the check actually saw.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../content-scripts/gemini-bridge.js', import.meta.url), 'utf8');
const branch = src.slice(
  src.indexOf('if (quietStreak >= RESPONSE_SETTLE_CHECKS && looksUnfinished(lastResponseText))'),
  src.indexOf('if (quietStreak >= RESPONSE_SETTLE_CHECKS) {'),
);

test('an expired hold is recorded once, as a notice, with the text', () => {
  assert.match(branch, /unfinishedHolds === UNFINISHED_GRACE_CHECKS \+ 1/,
    'recorded on every later check would be a storm; once is the event');
  assert.match(branch, /op: 'unfinished_hold_expired'/);
  assert.match(branch, /level: 'notice'/, 'the turn completes normally; it must not end it');
  assert.match(branch, /detail: String\(lastResponseText\)\.slice\(-240\)/,
    'without the text this is a count, and a count cannot say which construct fooled the check');
});
