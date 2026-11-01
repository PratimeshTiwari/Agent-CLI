/**
 * A tool row is one line, cut from the right.
 *
 * Reported with a screenshot, 2026-10-26: a long `run_command` drew as
 * `⏺ run_comma` with `nd` on the line below. The row was a flex row of
 * separate Texts, and Yoga shrinks every child of a row to fit — so the
 * subject's width was taken out of the *name*, which then wrapped. One Text
 * with the parts inline is cut from the right, and the name comes first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const turn = readFileSync(new URL('../../src/frontend/components/TranscriptTurn.jsx', import.meta.url), 'utf8');

test('the tool row is a single truncated Text', () => {
  // v6.5: `● Run(…)`, the dot coloured by state. The head is still one Text.
  const at = turn.indexOf('<Text color={tone}>{dot}</Text>');
  assert.ok(at > -1, 'control: the row is still drawn here');
  const before = turn.slice(Math.max(0, at - 60), at);
  assert.match(before, /<Text wrap="truncate">\s*$/);
  assert.doesNotMatch(before, /<Box flexDirection="row">\s*$/);
});
