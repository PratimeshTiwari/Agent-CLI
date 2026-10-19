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

const src = readFileSync(new URL('../../src/ui/components/TranscriptTurn.jsx', import.meta.url), 'utf8');
const summary = src.slice(src.indexOf('export function TurnSummary('));
const code = summary.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const live = code.slice(code.indexOf('{isLive ? ('), code.indexOf(') : ('));
const done = code.slice(code.indexOf(') : ('), code.indexOf('{worked > 0'));

test('the live branch draws the spinner and the status, and no past tense', () => {
  assert.match(live, /<Dots tick=\{tick\} \/> \{status\}/);
  assert.doesNotMatch(live, /Worked/, '"Worked for ⠋ Thinking…" read as a turn that had stopped');
});

test('the finished branch still says what the turn cost', () => {
  assert.match(done, /`Worked for \$\{duration\}s`/);
});
