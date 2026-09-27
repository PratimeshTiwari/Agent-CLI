/**
 * A change of Gemini conversation is written down.
 *
 * Reported from use: after `/effort` moved the browser from Flash to Pro, the
 * next question — *"can you verify this above analysis?"* — was answered with
 * *"you didn't include the analysis"*. Nothing could say whether the chat had
 * changed underneath the session: `session-meta.json` keeps only the latest id,
 * and `_recordThread`'s repair resends the system prompt and tools but **not
 * the conversation**, so a changed thread produces exactly that reply.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { readErrors, summarizeErrors } from '../../src/core/error-log.js';

const recordThread = AgentLoop.prototype._recordThread;
const url = (id) => `https://gemini.google.com/app/${id}`;

function loop(current) {
  const l = {
    workspace: mkdtempSync(join(tmpdir(), 'thread-changed-')),
    chatThread: current ? { id: current, model: 'gemini' } : null,
    modelConfig: { effort: 'high' },
    resets: 0,
    promptBuilder: { resetPromptState() { l.resets += 1; } },
    sessionStore: { setThread() {} },
  };
  return l;
}

test('moving to a different conversation is recorded, with both ids', () => {
  const l = loop('6ac13eb62b44baa8');
  recordThread.call(l, url('0123456789abcdef'));
  const [row] = readErrors(l.workspace);
  assert.equal(row.op, 'thread_changed');
  assert.deepEqual(row.meta, { from: '6ac13eb62b44baa8', to: '0123456789abcdef', effort: 'high' });
  assert.equal(l.resets, 1, 'and the prompt state is still repaired');
});

test('as a notice, because nothing failed', () => {
  const l = loop('aaaaaaaaaaaaaaaa');
  recordThread.call(l, url('bbbbbbbbbbbbbbbb'));
  assert.equal(summarizeErrors(l.workspace).total, 0);
  assert.equal(summarizeErrors(l.workspace).notices.count, 1);
});

test('the first conversation of a session is not a change', () => {
  // Turn 0's own conversation, which already carried the full prompt. A row
  // here on every session would be the noise the log levels exist to remove.
  const l = loop(null);
  recordThread.call(l, url('cccccccccccccccc'));
  assert.equal(readErrors(l.workspace).length, 0);
  assert.equal(l.resets, 0);
});

test('and nor is hearing the same conversation again', () => {
  const l = loop('dddddddddddddddd');
  recordThread.call(l, url('dddddddddddddddd'));
  assert.equal(readErrors(l.workspace).length, 0);
});
