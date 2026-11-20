/**
 * Races between a turn and the replies of the prompts before it (v9.9.9).
 *
 * Reported 2026-11-21: "sometimes prompt gets stuck or something takes extra
 * time". Each case here was first reproduced against the real loop and lock,
 * then fixed: a reply carries the `sendId` of the prompt it answers, a dying
 * turn stops the tab, stream text reaches the silence clock, a panel message
 * sent mid-turn is held, and a lane is released by the name it was sent on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../../src/backend/core/turn/agent-loop.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (c, ms = 2000) => { const e = Date.now() + ms; while (!c() && Date.now() < e) await wait(2); return c(); };
// `_askThread`'s timer is unref'd; keep the loop alive while a test waits on it.
const keep = setInterval(() => {}, 1000);
test.after(() => clearInterval(keep));

function loop() {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'stale-id-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: ({ userMessage }) => `P:${userMessage}`, noteDrift() {}, resetPromptState() {} },
  });
  const injected = [];
  const panel = [];
  l.sessionStore = { appendTurn() {}, saveHistory() {} };
  l.callbacks = { sendToPanel: (m) => { panel.push(m); return true; }, injectPrompt: (p) => injected.push(p) };
  l.newChatTimeoutMs = 20;
  return { l, injected, panel };
}
const answers = (l) => l.conversationHistory.filter((t) => t.role !== 'user').map((t) => t.content);
const reply = (l, sent, content, extra = {}) =>
  l.handleGeminiResponse('m', { content, complete: true, sendId: sent.sendId, ...extra });
const LANE = 'main:gemini';

test('every main prompt carries its own sendId', async () => {
  const { l, injected } = loop();
  await l.handleUserMessage('A', l.callbacks);
  await reply(l, injected[0], 'a');
  await l.handleUserMessage('B', l.callbacks);
  assert.ok(injected[0].sendId && injected[1].sendId);
  assert.notEqual(injected[0].sendId, injected[1].sendId);
});

test('esc, then a new turn: the stopped turn\'s late reply is not the new turn\'s answer', async () => {
  const { l, injected } = loop();
  await l.handleUserMessage('question A', l.callbacks);
  l.stopTurn();
  await l.handleUserMessage('question B', l.callbacks);
  await reply(l, injected[0], 'ANSWER TO A');
  assert.deepEqual(answers(l), [], 'A\'s reply is dropped');
  assert.equal(l.isProcessing, true, 'B is still waiting');
  assert.equal(l.extensionLock.isBusy(LANE), true, 'and still holds the tab');
  await reply(l, injected[1], 'ANSWER TO B');
  assert.deepEqual(answers(l), ['ANSWER TO B']);
});

test('a compaction summary after its deadline frees the tab for the next prompt and is not its answer', async () => {
  const { l, injected } = loop();
  const r = await l._askThread('summarise', { timeoutMs: 10 });
  assert.equal(r.timedOut, true);
  await l.handleUserMessage('question B', l.callbacks);
  assert.equal(injected.length, 1, 'B waits behind the ask, which still holds the tab');
  await reply(l, injected[0], 'SUMMARY TEXT');
  assert.deepEqual(answers(l), []);
  assert.equal(injected.length, 2, 'the ask\'s end lets B go');
  assert.equal(injected[1].prompt, 'P:question B');
  await reply(l, injected[1], 'ANSWER TO B');
  assert.deepEqual(answers(l), ['ANSWER TO B']);
});

test('an older extension\'s untagged reply is taken as before', async () => {
  const { l } = loop();
  await l.handleUserMessage('A', l.callbacks);
  await l.handleGeminiResponse('m', { content: 'untagged', complete: true });
  assert.deepEqual(answers(l), ['untagged']);
});

test('a stream chunk of an earlier prompt is not drawn, and the accepted signal never is', async () => {
  const { l, injected } = loop();
  await l.handleUserMessage('A', l.callbacks);
  l.stopTurn();
  await l.handleUserMessage('B', l.callbacks);
  assert.equal(l.noteReplyProgress({ content: 'old', sendId: injected[0].sendId }), false);
  assert.equal(l.noteReplyProgress({ content: 'new', sendId: injected[1].sendId }), true);
  assert.equal(l.noteReplyProgress({ content: '', accepted: true, sendId: injected[1].sendId }), false);
  assert.equal(l.noteReplyProgress({ content: 'untagged' }), true);
});

test('stream text stops the silence clock (it went only to the screen)', async () => {
  const { l, injected } = loop();
  l.silentReplyMs = 30;
  await l.handleUserMessage('write a long doc', l.callbacks);
  l.noteReplyProgress({ content: 'Chapter one', sendId: injected[0].sendId });
  await wait(80);
  assert.equal(injected.length, 1, 'no fresh-tab resend while it writes');
  assert.equal(l.isProcessing, true);
});

test('the silence clock restarts when the tab has the prompt', async () => {
  const { l, injected } = loop();
  l.silentReplyMs = 60;
  await l.handleUserMessage('A', l.callbacks);
  await wait(45); // queue, picker, typing into a hidden tab
  l.noteReplyProgress({ content: '', accepted: true, sendId: injected[0].sendId });
  await wait(35); // 80 ms after the enqueue, 35 after the tab took it
  assert.equal(injected.length, 1, 'not resent: Gemini has had it 35 ms');
  assert.ok(await until(() => injected.length === 2), 'still resent after a real silence');
});

test('a turn ended by the second silence stops the tab; esc stops it once', async () => {
  const { l, panel } = loop();
  l.silentReplyMs = 20;
  await l.handleUserMessage('A', l.callbacks);
  assert.ok(await until(() => !l.isProcessing));
  assert.equal(panel.filter((m) => m.type === 'stop_generation').length, 1);

  const esc = loop();
  await esc.l.handleUserMessage('A', esc.l.callbacks);
  esc.l.stopTurn();
  assert.equal(esc.panel.filter((m) => m.type === 'stop_generation').length, 1);
});

test('no stop is sent when no reply is owed', async () => {
  const { l, injected, panel } = loop();
  await l.handleUserMessage('A', l.callbacks);
  await reply(l, injected[0], 'done');
  l._stopOwedReply();
  assert.equal(panel.filter((m) => m.type === 'stop_generation').length, 0);
});

test('a panel message sent mid-turn is held and sent after, in order; a stop empties it', async () => {
  const { l, injected, panel } = loop();
  await l.handleUserMessage('A', l.callbacks);
  await l.handleUserMessage('panel one', l.callbacks);
  await l.handleUserMessage('panel two', l.callbacks);
  assert.ok(panel.some((m) => /Queued · sent when this turn ends/.test(m.payload?.message || '')));
  assert.equal(injected.length, 1);
  await reply(l, injected[0], 'done A');
  assert.ok(await until(() => injected.length === 2));
  assert.equal(injected[1].prompt, 'P:panel one');
  await reply(l, injected[1], 'done 1');
  assert.ok(await until(() => injected.length === 3));
  assert.equal(injected[2].prompt, 'P:panel two');

  const stopped = loop();
  await stopped.l.handleUserMessage('A', stopped.l.callbacks);
  await stopped.l.handleUserMessage('held', stopped.l.callbacks);
  stopped.l.stopTurn();
  await wait(20);
  assert.equal(stopped.injected.length, 1, 'esc drops what was held');
});

test('a model change before the reply releases the lane the prompt holds', async () => {
  const { l, injected } = loop();
  await l.handleUserMessage('A', l.callbacks);
  l.modelConfig.main = 'other';
  await reply(l, injected[0], 'done');
  assert.equal(l.extensionLock.isBusy(LANE), false);
});
