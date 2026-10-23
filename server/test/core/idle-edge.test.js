/**
 * The loop says when it goes idle — once per turn, from any writer.
 *
 * Eleven places set `isProcessing`: the loop's own endings, the bridge on a
 * fatal extension error, and the UI on `:stop`. The terminal's queue waits on
 * this edge (App.jsx), so a writer that skipped it would bring back the
 * stuck "queued" prompt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop } from '../../src/core/agent-loop.js';

const bare = () => Object.create(AgentLoop.prototype);

test('busy → idle notifies, once', () => {
  const loop = bare();
  let calls = 0;
  loop.onIdle(() => { calls += 1; });
  loop.isProcessing = true;
  loop.isProcessing = false;
  assert.equal(calls, 1);
});

test('control: idle → idle, and idle → busy, do not', () => {
  const loop = bare();
  let calls = 0;
  loop.onIdle(() => { calls += 1; });
  loop.isProcessing = false;
  loop.isProcessing = true;
  loop.isProcessing = true;
  assert.equal(calls, 0);
});

test('an outside writer — the bridge, the UI — triggers it the same way', () => {
  const loop = bare();
  let calls = 0;
  loop.onIdle(() => { calls += 1; });
  Object.assign(loop, { isProcessing: true });
  loop['isProcessing'] = false; // what websocket-server.js and App.jsx do
  assert.equal(calls, 1);
});

test('a listener that throws does not stop the others, or the turn ending', () => {
  const loop = bare();
  let reached = false;
  loop.onIdle(() => { throw new Error('boom'); });
  loop.onIdle(() => { reached = true; });
  loop.isProcessing = true;
  assert.doesNotThrow(() => { loop.isProcessing = false; });
  assert.equal(reached, true);
  assert.equal(loop.isProcessing, false);
});

test('unsubscribing stops it', () => {
  const loop = bare();
  let calls = 0;
  const off = loop.onIdle(() => { calls += 1; });
  off();
  loop.isProcessing = true;
  loop.isProcessing = false;
  assert.equal(calls, 0);
});
