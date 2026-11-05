/**
 * A closed tab ends a turn that was waiting on it, and only that (v8.10).
 *
 * Reported with screenshots: the Gemini tab was closed mid-turn and the spinner
 * went on, because nothing but the two-minute silence clock could act on it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../src/backend/core/turn/agent-loop.js';

function loop() {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'closed-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: ({ userMessage }) => userMessage, noteDrift() {}, resetPromptState() {} },
  });
  const shown = [];
  const sent = [];
  const enqueue = l._enqueueExtensionRequest.bind(l);
  l._enqueueExtensionRequest = (p) => { sent.push(p.prompt); enqueue(p); };
  l.sessionStore = { appendTurn() {}, saveHistory() {}, clear() {}, rollover() {} };
  l.callbacks = { sendToPanel: (m) => shown.push(m), injectPrompt() {} };
  l.newChatTimeoutMs = 20;
  l.browserTab = { id: 7, url: 'https://gemini.google.com/app/abc' };
  return { l, shown, sent };
}

const of = (shown, type) => shown.filter((m) => m.type === type);

test('a reply owed: the turn ends now, and says so with the link', async () => {
  const { l, shown } = loop();
  await l.handleUserMessage('hello', l.callbacks);
  assert.equal(l.isProcessing, true, 'control: a turn is running');
  assert.ok(l.extensionLock.anyBusy, 'control: a reply is owed');
  assert.ok(l._silentTimer, 'control: the silence clock is armed');

  l.noteTabClosed({ tabId: 7 });

  assert.equal(l.isProcessing, false);
  assert.equal(l.extensionLock.anyBusy, false, 'the next message must not queue behind a dead prompt');
  assert.equal(l._silentTimer, null, 'the silence clock must not fire on a finished turn');
  const [error] = of(shown, 'error');
  assert.match(error.payload.message, /The Gemini tab was closed/);
  assert.match(error.payload.message, /\nhttps:\/\/gemini\.google\.com\/app\/abc/);
  l.abortExtensionWork();
});

test('a message that got no reply rides in front of the next one', async () => {
  const { l, sent } = loop();
  await l.handleUserMessage('the real question', l.callbacks);
  l.noteTabClosed({ tabId: 7 });
  await l.handleUserMessage('go on', l.callbacks);
  assert.ok(sent.at(-1).includes('the real question'));
  assert.ok(sent.at(-1).endsWith('go on'));
  l.abortExtensionWork();
});

test('a turn that already had a reply carries nothing', async () => {
  const { l, sent } = loop();
  await l.handleUserMessage('first', l.callbacks);
  l._turnAnswered = true;
  l.noteTabClosed({ tabId: 7 });
  assert.equal(l.isProcessing, false, 'it still ends');
  await l.handleUserMessage('second', l.callbacks);
  assert.ok(!sent.at(-1).includes('first'));
  l.abortExtensionWork();
});

test('idle: a row, and nothing is ended or carried', () => {
  const { l, shown } = loop();
  let aborted = 0;
  const abort = l.abortExtensionWork.bind(l);
  l.abortExtensionWork = () => { aborted += 1; abort(); };
  l.noteTabClosed({ tabId: 7 });
  assert.equal(aborted, 0);
  assert.equal(of(shown, 'error').length, 0);
  assert.match(of(shown, 'status')[0].payload.message, /was closed · your next message reopens it$/);
  assert.equal(l._undelivered, undefined);
});

test('between rounds of tools the turn goes on: the next prompt reopens the chat', async () => {
  const { l, shown } = loop();
  await l.handleUserMessage('hello', l.callbacks);
  l._releaseExtension();                   // the reply landed; tools are running
  assert.ok(l.pendingGeminiResponse, 'control: this flag says nothing about the reply');
  assert.equal(l.extensionLock.anyBusy, false, 'control: the lane does');
  l.noteTabClosed({ tabId: 7 });
  assert.equal(l.isProcessing, true, 'ending it would lose results the model has not seen');
  assert.equal(of(shown, 'error').length, 0);
  const rows = of(shown, 'status').filter((m) => /was closed/.test(m.payload.message));
  assert.equal(rows.length, 1);
  assert.match(rows[0].payload.message, /next step reopens/, 'no message of yours is needed');
  l.isProcessing = false;
  l.abortExtensionWork();
});

test('one close is one row, however it was reported', () => {
  const { l, shown } = loop();
  l.noteTabClosed({ tabId: 7 });
  l.noteTabClosed({ tabId: 7 });
  assert.equal(of(shown, 'status').length, 1);
  l.noteTabClosed({ tabId: 8 });
  assert.equal(of(shown, 'status').length, 2, 'control: a second tab is a second close');
});
