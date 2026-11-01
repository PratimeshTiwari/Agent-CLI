/**
 * `/chat <link or id>` (v8.1): continue in a Gemini chat the person names,
 * after a send went to the wrong one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadFromInput } from '../../../src/backend/core/chat-thread.js';
import { AgentLoop } from '../../../src/backend/core/agent-loop.js';

test('a link, an account link, a bare host or the id alone', () => {
  const t = { model: 'gemini', id: '84788ca589e6a9f6' };
  assert.deepEqual(threadFromInput('https://gemini.google.com/app/84788ca589e6a9f6'), t);
  assert.deepEqual(threadFromInput('https://gemini.google.com/u/1/app/84788ca589e6a9f6?hl=en'), t);
  assert.deepEqual(threadFromInput('gemini.google.com/app/84788ca589e6a9f6'), t);
  assert.deepEqual(threadFromInput(' 84788ca589e6a9f6 '), t);
  for (const bad of ['', 'hello', 'https://gemini.google.com/app', 'abc123', 'https://example.com/app/84788ca589e6a9f6']) {
    assert.equal(threadFromInput(bad), null, bad);
  }
});

function loop({ busy = false, delivered = true } = {}) {
  const l = Object.create(AgentLoop.prototype);
  const sent = [];
  const saved = [];
  Object.assign(l, {
    chatThread: { model: 'gemini', id: 'aaaaaaaaaaaa' },
    _processing: busy,
    promptBuilder: { pendingRecap: ['x'] },
    sessionStore: { setThread: (t) => saved.push(t) },
    _toExtension: (type, payload) => { sent.push([type, payload]); return delivered; },
  });
  Object.defineProperty(l, 'isProcessing', { value: busy, writable: true });
  return { l, sent, saved };
}

test('the tab is sent there, and the session records it', () => {
  const { l, sent, saved } = loop();
  const r = l.openChat('https://gemini.google.com/app/84788ca589e6a9f6');
  assert.equal(r.ok, true);
  assert.deepEqual(sent, [['open_thread', { thread: { model: 'gemini', id: '84788ca589e6a9f6' } }]]);
  assert.deepEqual(l.chatThread, { model: 'gemini', id: '84788ca589e6a9f6' });
  assert.deepEqual(saved, [l.chatThread]);
  assert.equal(l.promptBuilder.pendingRecap, null, 'that chat holds the work; no recap into it');
});

test('not during a turn, not with nothing connected, not for something that is not a chat', () => {
  for (const [opts, input, why] of [
    [{ busy: true }, '84788ca589e6a9f6', /turn is running/],
    [{ delivered: false }, '84788ca589e6a9f6', /not connected/],
    [{}, 'the other chat', /Not a Gemini chat/],
  ]) {
    const { l, saved } = loop(opts);
    const r = l.openChat(input);
    assert.equal(r.ok, false);
    assert.match(r.message, why);
    assert.equal(l.chatThread.id, 'aaaaaaaaaaaa', 'unchanged');
    assert.deepEqual(saved, []);
  }
});

test('a reply from another chat is said on screen, with the way back', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const rows = [];
  const l = Object.create(AgentLoop.prototype);
  Object.assign(l, {
    workspace: mkdtempSync(join(tmpdir(), 'chat-')),
    chatThread: { model: 'gemini', id: 'aaaaaaaaaaaa' },
    modelConfig: {},
    promptBuilder: { resetPromptState() {} },
    sessionStore: { setThread() {} },
    _noticeRow: (m) => rows.push(m),
  });
  l._recordThread('https://gemini.google.com/app/bbbbbbbbbbbb');
  assert.equal(rows.length, 1);
  assert.match(rows[0], /another chat \(bbbbbbbbbbbb\), not this session's \(aaaaaaaaaaaa\).*\/chat aaaaaaaaaaaa goes back/);

  rows.length = 0;
  l._recordThread('https://gemini.google.com/app/bbbbbbbbbbbb');
  assert.deepEqual(rows, [], 'once, not on every reply after');
  const first = Object.assign(Object.create(AgentLoop.prototype), { ...l, chatThread: null, _noticeRow: (m) => rows.push(m) });
  first._recordThread('https://gemini.google.com/app/cccccccccccc');
  assert.deepEqual(rows, [], "a session's first chat is not a change");
});
