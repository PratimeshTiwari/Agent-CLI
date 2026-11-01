/**
 * No reply text two minutes after a prompt: sent again once, in a fresh tab,
 * then the turn ends (v8.0).
 *
 * Reported with screenshots: Gemini took a tool-results prompt, showed its
 * thinking dots and never wrote anything; after a reload the chat did not hold
 * that prompt at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop, SILENT_REPLY_MS } from '../../../src/backend/core/turn/agent-loop.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function loop() {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'silent-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: ({ userMessage }) => `P:${userMessage}`, noteDrift() {}, resetPromptState() {} },
  });
  const sent = [];
  const panel = [];
  l._enqueueExtensionRequest = (p) => sent.push(p);
  l._releaseExtension = () => {};
  l.sessionStore = { appendTurn() {}, saveHistory() {} };
  l.callbacks = { sendToPanel: (m) => panel.push(m), injectPrompt() {} };
  l.newChatTimeoutMs = 20;
  l.silentReplyMs = 30;
  return { l, sent, panel };
}

test('two minutes by default', () => assert.equal(SILENT_REPLY_MS, 120_000));

test('silence: the same prompt again, flagged for a fresh tab, once; then the turn ends', async () => {
  const { l, sent, panel } = loop();
  await l.handleUserMessage('write a plan file', l.callbacks);
  assert.equal(sent.length, 1);
  await wait(60);
  assert.equal(sent.length, 2, 'resent');
  assert.equal(sent[1].prompt, sent[0].prompt, 'verbatim');
  assert.equal(sent[1].freshTab, true);
  assert.ok(panel.some((m) => m.type === 'status' && /No response from Gemini in 2 min · retrying/.test(m.payload.message)));
  assert.equal(l.isProcessing, true);

  await wait(60);
  assert.equal(sent.length, 2, 'not a third time');
  assert.equal(l.isProcessing, false);
  const err = panel.find((m) => m.type === 'error');
  assert.match(err.payload.message, /^Communication with the Gemini tab failed · check the browser\nhttps:\/\/gemini\.google\.com\/app/);
});

test('text arriving stops the clock, however long the reply then takes', async () => {
  const { l, sent } = loop();
  await l.handleUserMessage('explain', l.callbacks);
  await l.handleGeminiResponse('m', { content: 'Thinking about', complete: false });
  await wait(60);
  assert.equal(sent.length, 1, 'no resend while it writes');
  assert.equal(l.isProcessing, true);
});

test('a finished reply, or esc, stops it too', async () => {
  const done = loop();
  await done.l.handleUserMessage('hi', done.l.callbacks);
  await done.l.handleGeminiResponse('m', { content: 'Hello.', complete: true });
  const stopped = loop();
  await stopped.l.handleUserMessage('hi', stopped.l.callbacks);
  stopped.l.isProcessing = false;
  stopped.l.abortExtensionWork();
  await wait(60);
  assert.equal(done.sent.length, 1);
  assert.equal(stopped.sent.length, 1);
});
