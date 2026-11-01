/**
 * Compaction asks the chat itself, and only between turns (v5.9).
 *
 * What it did before: fired at the *start* of a turn, alongside it; pasted
 * every older turn — tool results replaced by placeholders — into a cold
 * subagent tab; then switched the main tab to a new chat with no check that
 * the turn beside it had finished, so the turn's next prompt landed in a
 * conversation that had never seen the task.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../src/backend/core/agent-loop.js';
import { compactHistory, usableSummary, HANDOVER_POINTER } from '../../../src/backend/core/compaction.js';

const SRC = readFileSync(new URL('../../../src/backend/core/agent-loop.js', import.meta.url), 'utf8');

/** A loop with a fake lane: records what is enqueued. */
function loop() {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'cit-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: () => 'p', noteDrift() {}, resetPromptState() {} },
  });
  const enqueued = [];
  l._enqueueExtensionRequest = (p) => enqueued.push(p);
  l._releaseExtension = () => {};
  // A browser that never answers a new chat: not what these test (v7.9).
  l.newChatTimeoutMs = 20;
  l.callbacks = { sendToPanel() {}, injectPrompt() {} };
  l.sessionStore = { appendTurn() {}, saveHistory() {} };
  l.isProcessing = true;
  return { l, enqueued };
}

const TOOL_REPLY = '```json\n{"name": "run_command", "args": {"command": "rm -rf x"}}\n```';

test('the side question goes to the main tab and its reply comes back whole', async () => {
  const { l, enqueued } = loop();
  const asked = l._askThread('summarise please');
  assert.equal(enqueued[0].prompt, 'summarise please');
  await l.handleGeminiResponse('m', { content: 'partial', complete: false });
  await l.handleGeminiResponse('m', { content: 'The summary.', complete: true });
  assert.deepEqual(await asked, { ok: true, text: 'The summary.' });
  assert.equal(l.conversationHistory.length, 0, 'a side answer is not a turn in the history');
});

test('its reply is never executed, whatever it contains', async () => {
  const { l } = loop();
  let executed = false;
  l._executeToolCalls = async () => { executed = true; };
  const asked = l._askThread('summarise please');
  await l.handleGeminiResponse('m', { content: TOOL_REPLY, complete: true });
  await asked;
  assert.equal(executed, false);
});

test('esc cancels it, and compaction then changes nothing', async () => {
  const { l } = loop();
  const asked = l._askThread('summarise please');
  l.abortExtensionWork();
  assert.deepEqual(await asked, { ok: false, cancelled: true });
});

test('a reply that arrives after it gave up is swallowed, not read as a turn', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l } = loop();
  let executed = false;
  l._executeToolCalls = async () => { executed = true; };
  const asked = l._askThread('summarise please', { timeoutMs: 1000 });
  t.mock.timers.tick(1001);
  assert.deepEqual(await asked, { ok: false, timedOut: true });
  await l.handleGeminiResponse('m', { content: TOOL_REPLY, complete: true });
  assert.equal(executed, false, 'the late summary was treated as the next turn\'s reply');
});

test('a summary made of tool calls, or of nothing, is not used', () => {
  assert.equal(usableSummary(TOOL_REPLY), false);
  assert.equal(usableSummary('ok'), false);
  assert.equal(usableSummary('The task is to fix the parser; core/agent-loop.js was edited, tests pass.'), true);
});

test('the fresh chat is told where the rest is, and when to look', async () => {
  const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'agent' : 'user', content: 'y'.repeat(400) }));
  const fake = {
    conversationHistory: history, workspace: mkdtempSync(join(tmpdir(), 'cit2-')), contextTokens: 1,
    sessionStore: { saveHistory() {} }, promptBuilder: { resetPromptState() {} }, callbacks: { sendToPanel() {} },
    _resetContextCount() {}, async startNewChat() { return true; },
    async _askThread() { return { ok: true, text: 'Goal: fix the parser. Edited core/agent-loop.js; tests pass.' }; },
  };
  await compactHistory(fake);
  assert.match(fake.conversationHistory[0].content, /Goal: fix the parser/);
  assert.ok(fake.conversationHistory[0].content.includes(HANDOVER_POINTER));
  assert.match(HANDOVER_POINTER, /recall_history/);
});

test('/compact during a turn waits for the turn', async () => {
  let asked = false;
  const fake = { isProcessing: true, conversationHistory: [], async _askThread() { asked = true; } };
  const r = await compactHistory(fake, undefined, { auto: false });
  assert.equal(asked, false);
  assert.equal(fake._compactAfterTurn, true);
  assert.match(r.message, /as soon as it finishes/);
});

test('auto-compaction waits for your next message — never mid-turn, never at a turn\'s end', () => {
  // Owner's call, 2026-10-25: "do not compact mid conversation, that should hit
  // after threshold is met and user enters a new message".
  const finish = SRC.slice(SRC.indexOf('  _finishTurn('));
  const before = finish.slice(0, finish.indexOf('this.isProcessing = false;'));
  assert.doesNotMatch(before, /_wantsCompaction\(\)/, 'the end of a turn auto-compacts again');
  assert.match(before, /if \(this\._compactAfterTurn && !this\.isCompacting\) \{\s*this\._compactThenIdle\(\);\s*return;/,
    'a /compact typed during the turn must still run when it ends');
  assert.doesNotMatch(SRC, /_compactAndResume/, 'mid-turn compaction is back');
});

test('a failed handover is not retried on every turn', () => {
  const { l } = loop();
  l.contextManager = { needsCompaction: () => true };
  Object.defineProperty(l, 'contextTokens', { value: 1000, configurable: true });
  l._compactFailedAt = 1000;
  assert.equal(l._wantsCompaction(), false);
  Object.defineProperty(l, 'contextTokens', { value: 1200, configurable: true });
  assert.equal(l._wantsCompaction(), true, 'control: it tries again once the thread has grown');
});

test('a new chat is refused while the main tab has a prompt in flight', async () => {
  const { l } = loop();
  let sent = false;
  l.extensionLock = { isBusy: () => true };
  l._toExtension = () => { sent = true; };
  assert.equal(await l.startNewChat(), false);
  assert.equal(sent, false);
});

// ── What the run under the pty found ─────────────────────────────────────────

import { mergeLoopHistory } from '../../../src/frontend/transcript/transcript.js';
import { PromptBuilder } from '../../../src/backend/core/prompt-builder.js';
import { recentMessages } from '../../../src/backend/core/compaction.js';

test('the fresh chat is handed the summary — it never was', () => {
  const pb = Object.create(PromptBuilder.prototype);
  Object.assign(pb, { hasSeenSystemPrompt: true, messagesSinceRefresh: 0, workspace: mkdtempSync(join(tmpdir(), 'pb-')) });
  pb._loadTaskList = () => null;
  pb.pendingCompactedContext = { summary: 'SUMMARY-MARKER', recent: '[user] last thing' };
  const first = pb.buildPrompt({ userMessage: 'next question' });
  assert.match(first, /<compacted_context[\s\S]*SUMMARY-MARKER[\s\S]*\[user\] last thing/);
  const second = pb.buildPrompt({ userMessage: 'and another' });
  assert.doesNotMatch(second, /SUMMARY-MARKER/, 'once is an introduction; every turn is a repeated payload');
});

test('compaction sets it, restarts the count at zero, and records how far the front moved', async () => {
  const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'agent' : 'user', content: `t${i} `.repeat(300) }));
  const fake = {
    conversationHistory: history, workspace: mkdtempSync(join(tmpdir(), 'cit3-')), contextTokens: 1,
    sessionStore: { saveHistory() {} }, promptBuilder: {}, callbacks: { sendToPanel() {} },
    reset: null, _resetContextCount(n) { this.reset = n; }, async startNewChat() { return true; },
    async _askThread() { return { ok: true, text: 'Goal: fix the parser; edited core/agent-loop.js; tests pass.' }; },
  };
  const r = await compactHistory(fake, undefined, { auto: true });
  assert.equal(r.handedOver, true);
  assert.match(fake.promptBuilder.pendingCompactedContext.summary, /Goal: fix the parser/);
  // Counting the kept turns in full re-triggered compaction on the next turn.
  assert.equal(fake.reset, 0);
  // Three exchanges kept (v6.15): six rows here, so six summarised.
  assert.equal(fake.historyOffset, 12 - 6 - 1);
});

test('control: a refused handover hands nothing over and leaves the count', async () => {
  const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'agent' : 'user', content: 'z'.repeat(300) }));
  const fake = {
    conversationHistory: history, workspace: mkdtempSync(join(tmpdir(), 'cit4-')), contextTokens: 1,
    sessionStore: { saveHistory() {} }, promptBuilder: {}, callbacks: { sendToPanel() {} },
    reset: null, _resetContextCount(n) { this.reset = n; }, async startNewChat() { return false; },
    async _askThread() { return { ok: true, text: 'Goal: fix the parser; edited core/agent-loop.js; tests pass.' }; },
  };
  await compactHistory(fake, undefined, { auto: true });
  assert.equal(fake.promptBuilder.pendingCompactedContext, undefined, 'the old thread already has it all');
  assert.equal(fake.reset, null);
});

test('kept turns are capped, so a huge recent reply does not refill the new chat', () => {
  const out = recentMessages([{ role: 'user', content: 'q' }, { role: 'agent', content: 'w'.repeat(335_000) }]);
  assert.ok(out.length < 7000, `${out.length} characters of recent messages`);
  assert.match(out, /characters trimmed/);
});

test('after a rewrite, the screen does not draw the kept turns again', () => {
  const loopBefore = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'agent' : 'user', content: `m${i}` }));
  const shown = mergeLoopHistory([], loopBefore, 0);
  assert.equal(shown.length, 8);
  // Compaction: 3 turns summarised into 1, 5 kept, then a note.
  const loopAfter = [{ role: 'system', content: 'summary' }, ...loopBefore.slice(3), { role: 'assistant', content: 'note' }];
  const merged = mergeLoopHistory(shown, loopAfter, 3 - 1);
  assert.deepEqual(merged.slice(8).map((m) => m.content), ['note'], 'kept turns were drawn a second time');
  // Control: without the offset, it is the duplication that was measured.
  const wrong = mergeLoopHistory(shown, loopAfter, 0);
  assert.ok(wrong.length === shown.length, 'control: with no offset the note is lost instead — positions are meaningless');
});

test('the turn commits while compaction runs, so a long reply is not held live', () => {
  const app = readFileSync(new URL('../../../src/frontend/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /const turnInFlight = \(isProcessing \|\| !!agentLoop\?\.isProcessing\) && !agentLoop\?\.isCompacting;/);
});

/** handleUserMessage with everything past the compaction gate recorded, not run. */
function messageLoop({ wants, onCompact = async () => {} }) {
  const { l } = loop();
  l.isProcessing = false;
  const order = [];
  l._wantsCompaction = () => wants;
  l._runCompaction = async (opts) => { order.push(['compact', opts]); await onCompact(l); };
  l.conversationHistory = { push: (t) => order.push(['push', t.content]) };
  return { l, order };
}

test('past the threshold, the new message compacts first, then is sent', async () => {
  const { l, order } = messageLoop({ wants: true });
  await l.handleUserMessage('next question', l.callbacks).catch(() => {});
  assert.deepEqual(order[0], ['compact', { beforeMessage: true }]);
  assert.deepEqual(order[1], ['push', 'next question'], 'the message must follow the compaction');
});

test('control: under the threshold, nothing compacts', async () => {
  const { l, order } = messageLoop({ wants: false });
  await l.handleUserMessage('next question', l.callbacks).catch(() => {});
  assert.deepEqual(order[0], ['push', 'next question']);
});

test('esc during that compaction stops the message too', async () => {
  const { l, order } = messageLoop({ wants: true, onCompact: async (x) => { x.isProcessing = false; } });
  await l.handleUserMessage('next question', l.callbacks);
  assert.equal(order[0][0], 'compact');
  assert.equal(order.length, 1, `nothing after the stop: ${JSON.stringify(order)}`);
});
