/**
 * A prompt typed in the terminal appears in the side panel too.
 *
 * Reported with a screenshot, 2026-10-26: the panel showed the agent's replies
 * to terminal prompts and never the prompts. The panel drew only what it sent
 * itself; the loop told it about everything after the question and nothing
 * about the question.
 *
 * Two server halves: the loop announces each user turn (`user_turn`), and the
 * server tells every panel when the loop goes idle (`turn_idle`) — the only
 * end a stopped turn has, since it sends no `agent_response`. The panel's half
 * is in `extension/test/side-panel/user-turn.test.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { WebSocketServer } from '../../src/bridge/websocket-server.js';

function loop() {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'mirror-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: () => 'p', noteDrift() {}, resetPromptState() {} },
  });
  l._enqueueExtensionRequest = () => {};
  l._releaseExtension = () => {};
  l.sessionStore = { appendTurn() {}, saveHistory() {} };
  l._wantsCompaction = () => false;
  const sent = [];
  const callbacks = { sendToPanel: (m) => { sent.push(m); return true; }, injectPrompt() {} };
  return { l, sent, callbacks };
}

test('every user turn is announced to the panels', async () => {
  const { l, sent, callbacks } = loop();
  await l.handleUserMessage('why is the build red?', callbacks).catch(() => {});
  const turn = sent.find((m) => m.type === 'user_turn');
  assert.ok(turn, `sent: ${sent.map((m) => m.type).join(', ')}`);
  assert.equal(turn.payload.content, 'why is the build red?');
});

test('an image prompt is announced without its base64', async () => {
  const { l, sent, callbacks } = loop();
  const prompt = '[Image attached: /w/x.png (1KB, image/png)]\n\n<image_data>\ndata:image/png;base64,AAAA\n</image_data>\n\nwhat is this';
  await l.handleUserMessage(prompt, callbacks).catch(() => {});
  const turn = sent.find((m) => m.type === 'user_turn');
  assert.ok(!turn.payload.content.includes('base64,AAAA'));
});

// Control: a message turned away because the loop is busy was not asked.
test('a prompt refused as busy is not announced', async () => {
  const { l, sent, callbacks } = loop();
  l.isProcessing = true;
  await l.handleUserMessage('second', callbacks);
  assert.equal(sent.some((m) => m.type === 'user_turn'), false);
});

function server(agentLoop) {
  const s = new WebSocketServer({ port: 0, agentLoop, githubHandler: null });
  const out = [];
  s.broadcast = (to, m) => { out.push([to, m]); return true; };
  return { s, out };
}

test('the server tells the panels when the loop goes idle', () => {
  const { l } = loop();
  const { out } = server(l);
  l.isProcessing = true;
  assert.equal(out.length, 0);
  l.isProcessing = false;
  assert.deepEqual(out.map(([to, m]) => [to, m.type]), [['extension', 'turn_idle']]);
});

// Control: idle → idle is not an edge, and must not spam the worker.
test('no turn_idle without a busy → idle edge', () => {
  const { l } = loop();
  const { out } = server(l);
  l.isProcessing = false;
  l.isProcessing = false;
  assert.equal(out.length, 0);
});
