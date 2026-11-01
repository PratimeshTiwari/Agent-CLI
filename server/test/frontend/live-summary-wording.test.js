/**
 * A running turn does not say "Worked for".
 *
 * Reported with a screenshot asking whether the agent had stopped: the live row
 * read `Worked for ⠋ 🤔 Thinking… · 1 action` — past tense in front of a
 * spinner — while the turn was halfway through its second search. The words
 * describe a finished turn, so they belong to the finished branch only.
 *
 * A source assertion because `TranscriptTurn` is JSX, which the repo's plain
 * `node --test` cannot import (CLAUDE.md, the live-reply budget note).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/frontend/components/TranscriptTurn.jsx', import.meta.url), 'utf8');
const summary = src.slice(src.indexOf('export function TurnSummary('));
const code = summary.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const live = code.slice(code.indexOf('{isLive ? ('), code.indexOf(') : ('));
const done = code.slice(code.indexOf(') : ('), code.indexOf('{worked > 0'));

test('the live branch draws a still marker and the tally, and no past tense', () => {
  // A still circle: the thinking line is the one spinner (three at once read
  // as three things running — reported with a screenshot).
  assert.match(live, /◌/);
  assert.doesNotMatch(live, /<Dots/);
  // The thinking line under the turn names what is running; this row said it
  // again, with a third copy in the running list between them.
  assert.doesNotMatch(live, /\{status\}/, 'the status is drawn twice');
  assert.doesNotMatch(live, /Worked/, '"Worked for ⠋ Thinking…" read as a turn that had stopped');
});

test('the finished branch still says what the turn cost, and when it ended', () => {
  assert.match(done, /turnEndLine\(/);
  assert.match(done, /endedAt/);
});
