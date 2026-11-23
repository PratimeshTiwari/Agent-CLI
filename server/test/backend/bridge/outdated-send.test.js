/**
 * The bridge and the prompt ids (v9.9.9): a failure or a stream chunk of a
 * prompt the loop has moved past must not touch the turn in flight.
 *
 * Reproduced in `tabrig/`: A was stopped while still going into the tab, B
 * was sent, and anything of A's that came back afterwards was B's to suffer —
 * a late `tab_unreachable` ended B's turn, a late chunk was drawn under B.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from '../../../src/backend/bridge/websocket-server.js';
import { AgentLoop } from '../../../src/backend/core/turn/agent-loop.js';

function setup() {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'outdated-send-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: ({ userMessage }) => `P:${userMessage}`, noteDrift() {}, resetPromptState() {} },
  });
  const injected = [];
  const panel = [];
  l.sessionStore = { appendTurn() {}, saveHistory() {} };
  l.callbacks = { sendToPanel: (m) => { panel.push(m); return true; }, injectPrompt: (p) => injected.push(p) };
  l.newChatTimeoutMs = 20;
  const bridge = new WebSocketServer({ port: 0, agentLoop: l });
  bridge.clients.set('c1', { type: 'extension' });
  const deliver = (type, payload) => bridge._handleMessage('c1', { type, payload });
  return { l, injected, panel, deliver };
}

async function twoTurns(s) {
  await s.l.handleUserMessage('A', s.l.callbacks);
  s.l.stopTurn();
  await s.l.handleUserMessage('B', s.l.callbacks);
  return { a: s.injected[0].sendId, b: s.injected[1].sendId };
}

test('a stopped prompt\'s late failure does not end the next turn', async () => {
  const s = setup();
  const { a } = await twoTurns(s);
  await s.deliver('error', { op: 'tab_unreachable', stage: 'send', targetModel: 'gemini', sendId: a, message: 'failed' });
  assert.equal(s.l.isProcessing, true);
  assert.equal(s.l.extensionLock.isBusy('main:gemini'), true);
  assert.ok(!s.panel.some((m) => m.type === 'error'));
});

test('the awaited prompt\'s failure, or an untagged one, still ends it', async () => {
  for (const tag of ['b', null]) {
    const s = setup();
    const ids = await twoTurns(s);
    await s.deliver('error', { op: 'tab_unreachable', stage: 'send', targetModel: 'gemini', ...(tag ? { sendId: ids[tag] } : {}), message: 'failed' });
    assert.equal(s.l.isProcessing, false, `${tag || 'untagged'} ends the turn`);
  }
});

test('stream chunks reach the loop: an old one is not drawn, a current one is and stops the silence clock', async () => {
  const s = setup();
  s.l.silentReplyMs = 30;
  const { a, b } = await twoTurns(s);
  await s.deliver('gemini_response_stream', { content: 'old text', complete: false, streaming: true, sendId: a });
  assert.ok(!s.panel.some((m) => m.type === 'response_stream'));
  await s.deliver('gemini_response_stream', { content: 'new text', complete: false, streaming: true, sendId: b });
  assert.equal(s.panel.filter((m) => m.type === 'response_stream').length, 1);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(s.injected.length, 2, 'no fresh-tab resend while B is being written');
});
