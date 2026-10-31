/**
 * The fourth repair (1.56.0): the same conversation, in a fresh tab.
 *
 * After send, re-inject and reload have failed, the chat is opened again on its
 * own `/app/<id>` in a new tab and the old one is closed. Never a blank chat:
 * that answers a question it never saw.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

function stubChrome({ openFails = false } = {}) {
  const log = [];
  const listeners = [];
  const stored = {};
  globalThis.chrome = {
    tabs: {
      sendMessage: async (tabId, msg) => (msg.type === 'ping' ? { ready: true, canType: true } : { success: true }),
      create: async ({ url }) => {
        log.push(`create ${url}`);
        if (openFails) throw new Error('no window');
        const tab = { id: 99, url };
        setTimeout(() => listeners.forEach((l) => l(99, { status: 'complete' })), 0);
        return tab;
      },
      remove: async (id) => { log.push(`remove ${id}`); },
      get: async (id) => ({ id, url: 'https://gemini.google.com/app/abc' }),
      query: async () => [],
      update: async () => {},
      onUpdated: { addListener: (l) => listeners.push(l), removeListener() {} },
    },
    scripting: { executeScript: async () => {} },
    storage: {
      session: { get: async (k) => ({ [k]: stored[k] }), set: async (o) => Object.assign(stored, o) },
      local: { get: async () => ({}) },
    },
    runtime: { id: 'test', getPlatformInfo: async () => ({}), sendMessage: async () => {} },
    alarms: { get: async () => undefined, create() {}, clear: async () => {}, onAlarm: { addListener() {} } },
  };
  return log;
}

const { reopenInFreshTab } = await import('../../src/background/content.js');

test('the chat is reopened on its own id, and the old tab closed after', async () => {
  const log = stubChrome();
  const fresh = await reopenInFreshTab({ id: 7, url: 'https://gemini.google.com/u/1/app/abc' }, 'gemini');
  assert.equal(fresh.id, 99);
  assert.deepEqual(log, ['create https://gemini.google.com/u/1/app/abc', 'remove 7']);
});

test("the server's threadUrl when the tab has none", async () => {
  const log = stubChrome();
  await reopenInFreshTab({ id: 7, url: 'https://gemini.google.com/app' }, 'gemini', 'https://gemini.google.com/app/def');
  assert.equal(log[0], 'create https://gemini.google.com/app/def');
});

test('no conversation to go back to: no tab is opened', async () => {
  const log = stubChrome();
  assert.equal(await reopenInFreshTab({ id: 7, url: 'https://gemini.google.com/app' }, 'gemini'), null);
  assert.deepEqual(log, []);
});

test('if the fresh tab cannot open, the old one is kept', async () => {
  const log = stubChrome({ openFails: true });
  assert.equal(await reopenInFreshTab({ id: 7, url: 'https://gemini.google.com/app/abc' }, 'gemini'), null);
  assert.ok(!log.includes('remove 7'));
  const { isOwnedTab } = await import('../../src/background/content.js');
  assert.equal(await isOwnedTab(7), true, 'still the lane\'s tab');
});
