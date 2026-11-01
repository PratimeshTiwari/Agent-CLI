/**
 * A reply after compaction reaches the screen (issue #68).
 *
 * "output clearing in new subsequent prompts": prompts drawn, replies never.
 * Reproduced under the pty on v5.4 — auto-compaction rewrote the loop's
 * history to a summary plus five kept turns at the start of a prompt, and the
 * screen, which records how far it has drawn by position in that history,
 * believed every later reply was already on screen. Fixed by `historyOffset`
 * (v5.9): compaction says how far the front moved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLoopHistory } from '../../src/frontend/transcript/transcript.js';

function session(turns) {
  const loop = [];
  for (let i = 0; i < turns; i++) loop.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: `a${i}` });
  return loop;
}

function compact(loop, keep) {
  const dropped = loop.length - keep;
  return {
    history: [{ role: 'system', type: 'compaction_summary', content: 'summary' }, ...loop.slice(-keep)],
    offset: dropped - 1,
  };
}

test('the first reply after a rewrite is drawn', () => {
  const loop = session(8);
  const shown = mergeLoopHistory([], loop, 0);
  const { history, offset } = compact(loop, 5);
  history.push({ role: 'user', content: 'confirm apply false' }, { role: 'assistant', content: 'REPLY-FOUR' });
  const after = mergeLoopHistory(shown, history, offset);
  assert.ok(after.some((m) => m.content === 'REPLY-FOUR'), 'the reply was answered and never drawn');
  assert.equal(after.filter((m) => m.content === 'a7').length, 1, 'the kept turns must not be drawn twice');
});

test('control: without the offset, the reply is lost — the v5.4 symptom', () => {
  const loop = session(8);
  const shown = mergeLoopHistory([], loop, 0);
  const { history } = compact(loop, 5);
  history.push({ role: 'user', content: 'confirm apply false' }, { role: 'assistant', content: 'REPLY-FOUR' });
  const after = mergeLoopHistory(shown, history, 0);
  assert.ok(!after.some((m) => m.content === 'REPLY-FOUR'));
});
