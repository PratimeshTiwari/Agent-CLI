/**
 * A reply that says it will look and makes no call is asked once to make it
 * (v7.9, prompt v3's `lookFirst`).
 *
 * The loop goes on only when a reply carries a tool call, so "Let me check the
 * symbol index." with nothing after it ended the turn on the promise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../src/backend/core/agent-loop.js';
import { PromptBuilder } from '../../../src/backend/core/prompt-builder.js';

function loop(version) {
  const workspace = mkdtempSync(join(tmpdir(), 'promise-'));
  const promptBuilder = new PromptBuilder(workspace, workspace);
  const l = new AgentLoop({ workspace, mcpServer: {}, diffEngine: {}, riskClassifier: {}, promptBuilder });
  // After construction: the loop sets the builder's version from user settings.
  promptBuilder.promptVersion = version;
  const sent = [];
  const panel = [];
  l._enqueueExtensionRequest = (p) => sent.push(p.prompt);
  l._releaseExtension = () => {};
  l.callbacks = { sendToPanel: (m) => panel.push(m), injectPrompt() {} };
  l.sessionStore = { appendTurn() {}, saveHistory() {} };
  l.requestModelOptions = () => {};
  l.isProcessing = true;
  l._promiseNudged = false;
  l._turnEvidence = new Map();
  return { l, sent, panel };
}

const PROMISE = 'Let me check the symbol index.';

test('v3: a promise with no call is asked once to make the call', async () => {
  const { l, sent, panel } = loop('v3');
  await l.handleGeminiResponse('m', { content: PROMISE, complete: true });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /your reply had no tool call/);
  assert.match(sent[0], /\[tools: .*read_file/);
  assert.equal(l.isProcessing, true, 'the turn goes on');
  const reply = panel.find((m) => m.type === 'agent_response');
  assert.equal(reply.payload.continuing, true, 'the screen keeps the turn live');
  assert.ok(panel.some((m) => m.type === 'status' && /asked it to make the call/.test(m.payload.message)));

  // A second promise in the same turn ends it: asking again only spends rounds.
  await l.handleGeminiResponse('m', { content: PROMISE, complete: true });
  assert.equal(sent.length, 1);
  assert.equal(l.isProcessing, false);
});

test('v2 and v1 end the turn as before', async () => {
  for (const version of ['v1', 'v2']) {
    const { l, sent } = loop(version);
    await l.handleGeminiResponse('m', { content: PROMISE, complete: true });
    assert.equal(sent.length, 0, version);
    assert.equal(l.isProcessing, false, version);
  }
});

test('v3: an answer, or an offer, ends the turn', async () => {
  for (const content of [
    'The symbol index is built lazily and cached by mtime.',
    "If you'd like, I can check the tests too.",
  ]) {
    const { l, sent } = loop('v3');
    await l.handleGeminiResponse('m', { content, complete: true });
    assert.equal(sent.length, 0, content);
    assert.equal(l.isProcessing, false, content);
  }
});
