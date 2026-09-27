/**
 * A new conversation has never seen the system prompt. By definition.
 *
 * `_recordThread` resets the prompt state when the thread changes — that is
 * what catches the person opening a new chat in the tab themselves — and it is
 * guarded on there having been a *previous* thread, because the first id of a
 * session belongs to turn 0, which already carried the full prompt.
 *
 * `startNewChat` defeats that guard by nulling `chatThread` first. So by the
 * time the new conversation's first reply arrives, `previous` is null and the
 * reset never fires. The next prompt is the short turn — a bracketed context
 * line and a list of tool **names** — typed into a chat that has never been
 * given the definitions.
 *
 * Reported as *"it did not send the new base prompt on new?"*, with Gemini
 * answering that it does not have "direct execution access to your local
 * workspace or the specific custom tools you've configured". `tool_amnesia`
 * caught it a moment later and spent a turn re-sending the definitions — the
 * backstop working, for a failure prevention should have made impossible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop } from '../../src/core/agent-loop.js';

const startNewChat = AgentLoop.prototype.startNewChat;

function loop() {
  const l = {
    chatThread: { id: 'old-thread', model: 'gemini' },
    resets: 0,
    promptBuilder: { resetPromptState() { l.resets += 1; } },
    sessionStore: { clearThread() {} },
    _toExtension() {},
    callbacks: null,
    _backgroundCallbacks: null,
  };
  return l;
}

test('/new tells the prompt builder the chat is new', () => {
  const l = loop();
  startNewChat.call(l, { timeoutMs: 1 });

  assert.equal(l.resets, 1,
    'the next prompt is the short turn — tool names with no definitions — sent '
    + 'into a conversation that has never seen them');
});

test('and it happens even though the thread is nulled first', () => {
  // The ordering is the whole bug: `_recordThread`'s own reset is guarded on a
  // previous thread, and this method removes it before that guard can run.
  const l = loop();
  startNewChat.call(l, { timeoutMs: 1 });
  assert.equal(l.chatThread, null);
  assert.equal(l.resets, 1);
});

test('the thread being left is still remembered, so a handover has an address', () => {
  const l = loop();
  startNewChat.call(l, { timeoutMs: 1 });
  assert.equal(l.previousThread?.id, 'old-thread',
    'a handover you cannot look back from is a reset with a nicer name');
});

// Starting from no thread at all — a session's very first `/new` — must not
// throw, and resetting there is harmless: the next prompt is turn 0 anyway.
test('it works with no previous thread', () => {
  const l = loop();
  l.chatThread = null;
  assert.doesNotThrow(() => startNewChat.call(l, { timeoutMs: 1 }));
  assert.equal(l.resets, 1);
});
