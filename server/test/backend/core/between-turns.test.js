/*
 * The gap between turns (v6.6, #104: "could be faster in between turns").
 *
 * Every stage the trace had started once the tab held the prompt, so the time
 * from one reply landing to the next prompt reaching the tab was never
 * measured. Three stages now cover it: `round_wait` (the loop parked on the
 * person), `round_work` (the rest of reply → send) and `deliver` (send → the
 * tab receiving it). These tests pin the server's half; the tab folds them in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from '../../../src/backend/bridge/websocket-server.js';
import { AgentLoop } from '../../../src/backend/core/agent-loop.js';
import { logTrace, readTraces, STAGES } from '../../../src/backend/core/trace-log.js';

const server = () => new WebSocketServer({
  port: 0, githubHandler: null, agentLoop: { workspace: '/tmp/nowhere', setBackgroundCallbacks() {} },
});
const attach = (srv) => {
  const received = [];
  srv.clients.set(`c-${srv.clients.size}`, {
    type: 'extension',
    ws: { readyState: 1, OPEN: 1, send: (raw) => received.push(JSON.parse(raw)) },
  });
  return received;
};

test('an inject is stamped when it leaves, and re-stamped when a held one finally goes', () => {
  const srv = server();
  const before = Date.now();
  srv.sendInjectPrompt({ prompt: 'held', gap: { work: 12, wait: 0 } });
  const held = srv.pendingInjects[0].message.payload;
  assert.ok(held.sentAt >= before);
  assert.deepEqual(held.gap, { work: 12, wait: 0 }, 'the server\'s split rides along untouched');

  held.sentAt -= 60_000; // as if it had waited a minute for Chrome
  const ext = attach(srv);
  srv.flushPendingInjects();
  assert.ok(ext[0].payload.sentAt >= before, 'time spent waiting for Chrome is not delivery');
});

test('the person\'s time is kept apart: _parked counts what it awaited', async () => {
  const loop = { _parkedMs: 0 };
  const parked = AgentLoop.prototype._parked;
  const value = await parked.call(loop, new Promise((r) => setTimeout(() => r('approved'), 30)));
  assert.equal(value, 'approved');
  assert.ok(loop._parkedMs >= 25, `counted ${loop._parkedMs}ms`);
  // And a rejected wait is still counted, and still rejects.
  await assert.rejects(parked.call(loop, Promise.reject(new Error('gone'))));
});

test('the three stages come first in the order, and a trace keeps the prompt length', () => {
  assert.deepEqual(STAGES.slice(0, 4), ['round_wait', 'round_work', 'deliver', 'find_input']);
  const ws = mkdtempSync(join(tmpdir(), 'gap-'));
  try {
    logTrace(ws, { stages: { deliver: 840, type: 30 }, chars: 1234 });
    logTrace(ws, { stages: { type: 30 }, chars: 'not a number' });
    const [a, b] = readTraces(ws);
    assert.equal(a.chars, 1234);
    assert.equal(a.stages.deliver, 840);
    assert.equal('chars' in b, false, 'junk is left out, not written as NaN');
    assert.match(readFileSync(join(ws, '.agent', 'logs', 'traces.jsonl'), 'utf8'), /"chars":1234/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('a new message starts with no reply clock, so idle time is never round_work', () => {
  const src = readFileSync(new URL('../../../src/backend/core/agent-loop.js', import.meta.url), 'utf8');
  const start = src.indexOf('async handleUserMessage(content, callbacks, options = {}) {');
  const body = src.slice(start, src.indexOf('this._wantsCompaction()', start));
  assert.match(body, /this\._replyAt = null;\s*this\._parkedMs = 0;/);
});

test('the reply clock and the gap are wired where the turn passes them', () => {
  const src = readFileSync(new URL('../../../src/backend/core/agent-loop.js', import.meta.url), 'utf8');
  assert.match(src, /this\._replyAt = Date\.now\(\);\s*this\._parkedMs = 0;/);
  assert.match(src, /\.\.\.\(gap \? \{ gap \} : \{\}\)/);
  assert.match(src, /await this\._parked\(new Promise/, 'the command approval is parked');
  assert.match(readFileSync(new URL('../../../src/backend/core/diff-approval.js', import.meta.url), 'utf8'), /parked\(loop, new Promise/);
  assert.match(readFileSync(new URL('../../../src/backend/core/loop-tools.js', import.meta.url), 'utf8'), /loop\._parked\(asked\)/);
  // The terminal broadcasts its own inject rather than calling sendInjectPrompt;
  // the first pty run had no `deliver` on any prompt because of it.
  assert.match(readFileSync(new URL('../../../src/frontend/hooks/use-agent-callbacks.js', import.meta.url), 'utf8'),
    /payload: \{ \.\.\.msg, sentAt: Date\.now\(\) \}/);
});
