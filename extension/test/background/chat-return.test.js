/**
 * Before a main prompt is typed, the tab is on this session's chat (1.58.0).
 * Owner: "the agent should be intelligent enough to check whether it is
 * continuing on the same chat … if it fails, show a warning".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatToReturnTo } from '../../src/background/chat-url.js';

test('where the tab must go, keeping the account', () => {
  const want = 'https://gemini.google.com/app/aaa';
  assert.equal(chatToReturnTo('https://gemini.google.com/app/aaa', want), null, 'already there');
  assert.equal(chatToReturnTo('https://gemini.google.com/u/1/app/aaa', want), null, 'same chat, any account');
  assert.equal(chatToReturnTo('https://gemini.google.com/app/bbb', want), want);
  assert.equal(chatToReturnTo('https://gemini.google.com/app', want), want, 'a blank chat never saw the task');
  assert.equal(chatToReturnTo('https://gemini.google.com/u/1/app/bbb', want), 'https://gemini.google.com/u/1/app/aaa', "the tab's account");
  assert.equal(chatToReturnTo('https://gemini.google.com/u/1/app', 'https://gemini.google.com/u/2/app/aaa'), 'https://gemini.google.com/u/2/app/aaa', "the server's account wins");
  assert.equal(chatToReturnTo('https://gemini.google.com/app/bbb', null), null, 'no chat named: no opinion');
  assert.equal(chatToReturnTo('https://gemini.google.com/app/bbb', 'https://gemini.google.com/app'), null);
});

function stubChrome({ before, after }) {
  const log = [];
  const listeners = [];
  let url = before;
  globalThis.chrome = {
    tabs: {
      get: async (id) => ({ id, url }),
      update: async (id, { url: to }) => {
        log.push(`update ${to}`);
        url = after ?? to;
        setTimeout(() => listeners.forEach((l) => l(id, { status: 'complete' })), 0);
        return { id, url };
      },
      sendMessage: async () => ({ ready: true, canType: true }),
      onUpdated: { addListener: (l) => listeners.push(l), removeListener() {} },
      query: async () => [],
    },
    scripting: { executeScript: async () => {} },
    storage: { session: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({}) } },
    runtime: { id: 'test', getPlatformInfo: async () => ({}), sendMessage: async () => {} },
    alarms: { get: async () => undefined, create() {}, clear: async () => {}, onAlarm: { addListener() {} } },
  };
  return log;
}

const { ensureOnChat } = await import('../../src/background/content.js');

test('on another chat: moved back, then it may send', async () => {
  const log = stubChrome({ before: 'https://gemini.google.com/app/bbb' });
  assert.deepEqual(await ensureOnChat({ id: 5 }, 'https://gemini.google.com/app/aaa'), { ok: true });
  assert.deepEqual(log, ['update https://gemini.google.com/app/aaa']);
});

test('already there, or no chat named: the tab is not touched', async () => {
  for (const [before, threadUrl] of [['https://gemini.google.com/app/aaa', 'https://gemini.google.com/app/aaa'], ['https://gemini.google.com/app/bbb', undefined]]) {
    const log = stubChrome({ before });
    assert.deepEqual(await ensureOnChat({ id: 5 }, threadUrl), { ok: true });
    assert.deepEqual(log, []);
  }
});

test('the chat will not load there (deleted, another account): nothing is sent', async () => {
  stubChrome({ before: 'https://gemini.google.com/app/bbb', after: 'https://gemini.google.com/app' });
  assert.deepEqual(await ensureOnChat({ id: 5 }, 'https://gemini.google.com/app/aaa'), { ok: false, wanted: 'aaa', landed: null });
});

test('the main lane checks before its first send, and stops when it fails', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../src/background/content.js', import.meta.url), 'utf8');
  const check = src.indexOf('const placed = await ensureOnChat(tabs[0], payload.threadUrl);');
  const send = src.indexOf('success = await trySendToTab(tabs[0], message, targetModel, { repairs: false });');
  assert.ok(check > 0 && send > check);
  assert.match(src.slice(check, send), /if \(!placed\.ok\) \{[\s\S]*op: 'chat_unreachable'[\s\S]*return;\s*\}/);
});
