/**
 * A message the tab never sent goes in front of the next one (v7.10).
 *
 * Reported with a screenshot: a question failed to send ("Failed to
 * communicate with gemini tab after multiple retries"), the next message was
 * "try again", and Gemini, which had never seen the question, answered the one
 * before it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop, carryUndelivered } from '../../../src/backend/core/agent-loop.js';

function loop() {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'carry-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: ({ userMessage }) => userMessage, noteDrift() {}, resetPromptState() {} },
  });
  const sent = [];
  l._enqueueExtensionRequest = (p) => sent.push(p.prompt);
  l._releaseExtension = () => {};
  l.sessionStore = { appendTurn() {}, saveHistory() {}, clear() {}, rollover() {} };
  l.callbacks = { sendToPanel() {}, injectPrompt() {} };
  l.newChatTimeoutMs = 20;            // no browser answers a new chat here
  return { l, sent };
}

/** What the bridge does with a fatal `tab_unreachable`, minus the socket. */
function tabFails(l) {
  l.noteUndelivered();
  l.isProcessing = false;
  l.abortExtensionWork();
}

const QUESTION = 'is there advantage of this tool over connecting gemini web to github ?';

test('the lost question rides in front of "try again", once', async () => {
  const { l, sent } = loop();
  await l.handleUserMessage(QUESTION, l.callbacks);
  tabFails(l);
  await l.handleUserMessage('try again', l.callbacks);
  assert.match(sent[1], /never reached you/);
  assert.ok(sent[1].includes(QUESTION));
  assert.ok(sent[1].endsWith('try again'));
  assert.equal(l.conversationHistory.filter((t) => t.role === 'user').at(-1).content, 'try again',
    'the record keeps what was typed');

  // Answered: nothing is carried after that.
  await l.handleGeminiResponse('m', { content: 'GitHub answer.', complete: true });
  await l.handleUserMessage('thanks', l.callbacks);
  assert.equal(sent[2], 'thanks');
});

test('two failures in a row carry both, oldest first', async () => {
  const { l, sent } = loop();
  await l.handleUserMessage(QUESTION, l.callbacks);
  tabFails(l);
  await l.handleUserMessage('try again', l.callbacks);
  tabFails(l);
  await l.handleUserMessage('third time', l.callbacks);
  const last = sent.at(-1);
  assert.match(last, /messages never reached you/);
  assert.ok(last.indexOf(QUESTION) < last.indexOf('try again'));
  assert.equal(last.split(QUESTION).length - 1, 1, 'the question once, not twice');
});

test('a turn that was answered is not carried, and /new drops it', async () => {
  const { l, sent } = loop();
  await l.handleUserMessage(QUESTION, l.callbacks);
  // A reply of tool calls only adds no agent row, and still means it was seen.
  l._executeToolCalls = async () => {};
  await l.handleGeminiResponse('m', { content: '```json\n{"name": "read_file", "args": {"path": "README.md"}}\n```', complete: true });
  tabFails(l);
  await l.handleUserMessage('go on', l.callbacks);
  assert.equal(sent.at(-1), 'go on');

  l._undelivered = { texts: ['lost'] };
  await l.handleSlashCommand('new', []);
  assert.equal(l._undelivered, null);
});

test('a lost turn 0 is taught again; a lost short turn is not', async () => {
  for (const [prompt, resets] of [['\u200b<system_state>…', 1], ['short turn', 0]]) {
    const { l } = loop();
    await l.handleUserMessage(QUESTION, l.callbacks);
    // Counted from the failure on: starting the turn may reset for its own reasons.
    let reset = 0;
    l.promptBuilder.resetPromptState = () => { reset += 1; };
    l._lastMainPrompt = prompt;
    tabFails(l);
    assert.equal(reset, resets, prompt);
  }
});

test('carryUndelivered leaves a message alone when nothing was lost', () => {
  assert.equal(carryUndelivered(null, 'hi'), 'hi');
  assert.equal(carryUndelivered({ texts: [] }, 'hi'), 'hi');
});

test('the bridge notes it only for a prompt the tab never sent', () => {
  const src = readFileSync(new URL('../../../src/backend/bridge/websocket-server.js', import.meta.url), 'utf8');
  // chat_unreachable (v8.1): the tab could not return to the session's chat,
  // so nothing was typed — the same "never sent".
  assert.match(src, /op === 'tab_unreachable' \|\| payload\?\.op === 'no_tab' \|\| payload\?\.op === 'chat_unreachable'\) \{\s*this\.agentLoop\.noteUndelivered/);
});
