/**
 * A fresh session starts in a new chat (v7.9).
 *
 * The extension types into the tab it owns, and nothing moved that tab off the
 * last session's conversation. Reported with a screenshot: on a warm start the
 * setup prompt went in under the previous chat's last reply, and Gemini said
 * "Ready." there. A cold start's first message went there too, less visibly.
 *
 * Only `--continue` / `--resume` onto a saved thread keep the old conversation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentLoop, NEW_CHAT_TIMEOUT_MS } from '../../../src/backend/core/turn/agent-loop.js';
import { SessionStore } from '../../../src/backend/storage/session-store.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const THREAD = { model: 'gemini', id: '17d6b14b8a5d1ff2' };

function built(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fresh-chat-'));
  const store = new SessionStore(dir);
  if (opts.history) {
    store.saveHistory(opts.history);
    if (opts.thread) store.setThread(opts.thread);
  }
  const loop = new AgentLoop({
    workspace: dir, mcpServer: {}, promptBuilder: {}, diffEngine: {}, riskClassifier: {},
    ...opts.args,
  });
  loop._toExtension = () => true;
  loop.promptBuilder = { resetPromptState: () => {}, pendingRecap: undefined };
  return loop;
}

const TURNS = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }];

test('who owes a new chat', async (t) => {
  await t.test('a fresh session does', () => {
    assert.equal(built({ history: TURNS, thread: THREAD })._freshChatOwed, true);
  });

  await t.test('--continue onto a saved thread does not: that chat is the memory', () => {
    const loop = built({ history: TURNS, thread: THREAD, args: { continueSession: true } });
    loop._backgroundCallbacks = { sendToPanel: () => true };
    assert.equal(loop.resumeThreadOnConnect(), 'thread');
    assert.equal(loop._freshChatOwed, false);
  });

  await t.test('--continue with no thread recaps, and a recap goes to a new chat', () => {
    const loop = built({ history: TURNS, args: { continueSession: true } });
    loop._backgroundCallbacks = { sendToPanel: () => true };
    assert.equal(loop.resumeThreadOnConnect(), 'recap');
    assert.equal(loop._freshChatOwed, true);
  });
});

/** The two methods under test on a bare prototype, with the browser faked. */
function fake({ delivered = true, ack = true } = {}) {
  const l = Object.create(AgentLoop.prototype);
  const events = [];
  Object.assign(l, {
    workspace: mkdtempSync(join(tmpdir(), 'fresh-chat-')),
    chatThread: null,
    _freshChatOwed: true,
    callbacks: null,
    _backgroundCallbacks: null,
    promptBuilder: { resetPromptState() {} },
    sessionStore: { clearThread() {} },
    _toExtension(type) {
      events.push(type);
      if (delivered && ack && type === 'new_chat') setImmediate(() => l.handleChatStarted({ ok: true }));
      return delivered;
    },
  });
  return { l, events };
}

test('spending it', async (t) => {
  await t.test('asks once, before anything else', async () => {
    const { l, events } = fake();
    await l._startFreshChatIfOwed();
    await l._startFreshChatIfOwed();
    assert.deepEqual(events, ['new_chat']);
    assert.equal(l._freshChatOwed, false);
  });

  await t.test('nothing connected: no wait, and still owed for the next prompt', async () => {
    const { l, events } = fake({ delivered: false });
    const started = Date.now();
    await l._startFreshChatIfOwed();
    assert.ok(Date.now() - started < 1000, 'waited out the 5 s budget for a browser nobody asked');
    assert.deepEqual(events, ['new_chat']);
    assert.equal(l._freshChatOwed, true);
  });

  await t.test('control: a session that already has a thread is left alone', async () => {
    const { l, events } = fake();
    l.chatThread = THREAD;
    await l._startFreshChatIfOwed();
    assert.deepEqual(events, []);
  });

  await t.test('/new and compaction spend it too', async () => {
    const { l } = fake();
    await l.startNewChat({ timeoutMs: 1000 });
    assert.equal(l._freshChatOwed, false);
  });
});

/*
 * Reported: `/compact` said the browser did not start a new conversation.
 * Extension 1.55.0 acks only once the page has loaded (up to ~13 s) and this
 * waited 5. A second ask settles it either way: a tab already on a new chat
 * acks at once, and one that refused gets another go.
 */
test('a new chat is asked for twice before it is a failure (v7.9)', async (t) => {
  function scripted(answers) {
    const { l, events } = fake({ ack: false });
    l._toExtension = (type) => {
      events.push(type);
      const a = answers.shift();
      if (a !== undefined && a !== 'silent') setImmediate(() => l.handleChatStarted({ ok: a }));
      return true;
    };
    return { l, events };
  }

  await t.test('refused, then done', async () => {
    const { l, events } = scripted([false, true]);
    assert.equal(await l.startNewChat({ timeoutMs: 1000 }), true);
    assert.deepEqual(events, ['new_chat', 'new_chat']);
  });

  await t.test('no answer in time, then done', async () => {
    const { l, events } = scripted(['silent', true]);
    assert.equal(await l.startNewChat({ timeoutMs: 50 }), true);
    assert.deepEqual(events, ['new_chat', 'new_chat']);
  });

  await t.test('control: refused twice is false, and there is no third ask', async () => {
    const { l, events } = scripted([false, false, true]);
    assert.equal(await l.startNewChat({ timeoutMs: 1000 }), false);
    assert.deepEqual(events, ['new_chat', 'new_chat']);
  });

  await t.test('the default wait covers the extension\'s load and bridge waits', () => {
    const ms = NEW_CHAT_TIMEOUT_MS;
    assert.ok(new AgentLoop({ workspace: mkdtempSync(join(tmpdir(), 'fresh-chat-')), mcpServer: {},
      promptBuilder: {}, diffEngine: {}, riskClassifier: {} }).newChatTimeoutMs === ms);
    assert.ok(ms >= 13_000, `${ms} ms is shorter than a tab load (8 s) plus the bridge (5 s)`);
  });
});

test('the warm-up opens the new chat before the setup prompt', async () => {
  const { l, events } = fake();
  Object.assign(l, {
    mode: 'plan',
    modelConfig: { main: 'gemini', effort: 'high' },
    modelOptions: [{ label: '3.1 Pro', isMode: false, selected: true }],
    conversationHistory: [],
    promptBuilder: {
      hasSeenSystemPrompt: false,
      resetPromptState() {},
      buildWarmup: () => 'SETUP',
      markSystemPromptSeen() {},
      noteMessageSent() {},
    },
    _askThread: async (prompt) => { events.push(prompt); return { ok: true, text: 'Ready.' }; },
  });
  l.isProcessing = false;
  assert.equal(await l.warmUp({ waitForModelsMs: 0 }), 'ready');
  assert.deepEqual(events, ['new_chat', 'SETUP']);
});

test('the first message spends it before the model switch and the send', () => {
  // A source assertion, as for `turnInFlight`: driving handleUserMessage needs
  // the whole turn machinery, and moving the call below the send reads as tidying.
  const src = fs.readFileSync(join(HERE, '../../../src/backend/core/turn/agent-loop.js'), 'utf8');
  const start = src.indexOf('  async handleUserMessage(');
  const body = src.slice(start, src.indexOf('this.conversationHistory.push(turn);', start));
  const fresh = body.indexOf('await this._startFreshChatIfOwed();');
  assert.ok(fresh > 0, 'handleUserMessage no longer opens the owed new chat');
  assert.ok(fresh > body.indexOf('_runCompaction'), 'compaction opens its own chat; it goes first');
  assert.ok(fresh < body.indexOf('ensureRungForTurn'), 'a switch in the old chat would be undone by the new one');
});

/*
 * Reported: the extension was reloaded, forgot its tab, and opened a blank
 * chat for a short turn that assumed the old one. A main-lane prompt now names
 * its conversation, so a tab the extension has to open goes back to it.
 */
test('a main-lane prompt names its conversation; a subagent\'s does not (v7.9)', () => {
  const l = Object.create(AgentLoop.prototype);
  const queued = [];
  l.extensionLock = { enqueue: (p) => queued.push(p) };
  l.chatThread = THREAD;
  l.browserTab = { id: 7, thread: THREAD.id, url: `https://gemini.google.com/u/1/app/${THREAD.id}` };
  l._enqueueExtensionRequest({ prompt: 'p', targetModel: 'gemini' });
  l._enqueueExtensionRequest({ prompt: 's', targetModel: 'gemini', isSubagent: true, requestId: 'r' });
  assert.equal(queued[0].threadUrl, `https://gemini.google.com/u/1/app/${THREAD.id}`, 'the account prefix is kept');
  assert.equal(queued[1].threadUrl, undefined);

  // The tab on another chat: its URL is not this conversation's.
  l.browserTab = { id: 7, thread: 'other', url: 'https://gemini.google.com/app/other' };
  l._enqueueExtensionRequest({ prompt: 'p', targetModel: 'gemini' });
  assert.equal(queued[2].threadUrl, `https://gemini.google.com/app/${THREAD.id}`);

  // Control: a new chat has no conversation to go back to.
  l.chatThread = null;
  l._enqueueExtensionRequest({ prompt: 'p', targetModel: 'gemini' });
  assert.equal(queued[3].threadUrl, undefined);
});
