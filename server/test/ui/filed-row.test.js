/**
 * The "Previous conversation filed" row must not share a frame with what typing opens.
 *
 * It is dismissed by an effect on the first keystroke, and an effect runs after
 * the render — so typing `/` drew the row (two rows, charged to nothing) beside
 * the command list it had just opened. At 13 rows that frame was taller than the
 * terminal: 2 full clears under the pty, on `main`. The render condition reads
 * the input itself now. A source assertion, because seeing it needs a pty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/ui/components/InputBar.jsx', import.meta.url), 'utf8');

test('the filed row is hidden in the same render that has input', () => {
  const cond = /\{filedSession && ([^\n]*) && \(/.exec(src);
  assert.ok(cond, 'the filed row condition moved; re-point this test');
  assert.match(cond[1], /!input\b/, 'only the effect hides it, one frame late');
  assert.match(cond[1], /!filedDismissed/, 'control: deleting what was typed must not bring it back');
});
