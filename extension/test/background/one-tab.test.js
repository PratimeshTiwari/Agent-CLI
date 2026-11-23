/**
 * One agent tab, however many asks need it at once (v9.9.9.3).
 *
 * Reported 2026-11-23: "agent opens a gemini tab, and when i change effort,
 * it again opens a second gemini tab and on that everything happens".
 * `/effort` sends `discover_models`, `switch_model` and `set_thinking`
 * together, and each goes through `ensureModelTab`. Two faults, both
 * reproduced here against the real worker code before the fix:
 *
 * - the tab was recorded only after it was created, so asks arriving together
 *   each saw "no tab" and opened one;
 * - a tab still loading has `url: ''` and a `pendingUrl` in Chrome, and
 *   `pickMainTab` read that as "navigated away" and forgot it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeWebSocket { static OPEN = 1; constructor() { this.readyState = 1; this.sent = []; } send(d) { this.sent.push(JSON.parse(d)); } close() {} }
globalThis.WebSocket = FakeWebSocket;

const stored = {};
const tabs = new Map();
const creates = [];
const updated = new Set();
let nextId = 100;

globalThis.chrome = {
  tabs: {
    sendMessage: async (id, msg) => {
      if (!tabs.has(id)) throw new Error('Could not establish connection');
      return msg.type === 'ping' ? { ready: tabs.get(id).status === 'complete', canType: true } : { success: true };
    },
    // As Chrome does: a new tab has no `url` until its navigation commits.
    create: async ({ url }) => {
      const t = { id: ++nextId, url: '', pendingUrl: url, status: 'loading' };
      tabs.set(t.id, t);
      creates.push(url);
      setTimeout(() => {
        t.url = url; delete t.pendingUrl; t.status = 'complete';
        for (const l of updated) l(t.id, { status: 'complete' }, { ...t });
      }, 50);
      return { ...t };
    },
    remove: async (id) => { tabs.delete(id); },
    get: async (id) => { if (!tabs.has(id)) throw new Error(`No tab with id: ${id}`); return { ...tabs.get(id) }; },
    query: async () => [...tabs.values()].filter((t) => t.url).map((t) => ({ ...t })),
    update: async () => {}, reload: async () => {},
    onUpdated: { addListener: (l) => updated.add(l), removeListener: (l) => updated.delete(l) },
  },
  windows: { create: async () => ({ tabs: [] }), update: async () => {} },
  scripting: { executeScript: async () => {} },
  storage: {
    session: { get: async (k) => ({ [k]: stored[k] }), set: async (o) => Object.assign(stored, o) },
    local: { get: async () => ({}) },
  },
  runtime: { id: 't', getPlatformInfo: async () => ({}), sendMessage: async () => {}, getManifest: () => ({ version: '0' }) },
  commands: { getAll: async () => [] },
  alarms: { get: async () => ({ name: 'reconnect' }), create() {}, clear: async () => true, onAlarm: { addListener() {} } },
};

const worker = await import('../../src/background/content.js');

function reset() {
  for (const id of [...tabs.keys()]) { worker.forgetTab(id); tabs.delete(id); }
  creates.length = 0;
  delete stored.agentOwnedTabs;
}

test('three asks at once open one tab', async () => {
  reset();
  const got = await Promise.all([1, 2, 3].map(() => worker.ensureModelTab('gemini')));
  assert.equal(creates.length, 1, `opened ${creates.length} tabs`);
  assert.equal(new Set(got.map((t) => t.id)).size, 1);
});

test('an ask while the tab is still loading finds it', async () => {
  reset();
  const first = worker.ensureModelTab('gemini');
  await new Promise((r) => setTimeout(r, 10)); // created, url still ''
  const tab = await worker.pickMainTab('gemini');
  assert.ok(tab, 'a loading tab was taken for one that navigated away');
  await first;
  assert.equal(creates.length, 1);
});

test('a tab that really navigated away is still let go', async () => {
  reset();
  const tab = await worker.ensureModelTab('gemini');
  tabs.get(tab.id).url = 'https://example.com/';
  assert.equal(await worker.pickMainTab('gemini'), null);
});

/*
 * 1.72.0, owner 2026-11-23: "efforts are not loaded on first start, changing
 * effort opens a new tab still". The tab on screen was opened by the agent
 * through the OS (the start link, or /chrome's pairing link), so it was not
 * ours: /effort opened another, and its models were never read.
 */
test('a tab the agent opened is adopted: /effort uses it, and opens nothing', async () => {
  reset();
  const t = { id: ++nextId, url: 'https://gemini.google.com/app', status: 'complete' };
  tabs.set(t.id, t); // opened by the OS, not by chrome.tabs.create
  assert.equal(await worker.pickMainTab('gemini'), null, 'control: not ours before');
  assert.equal(await worker.adoptAgentTab(t.id), true);
  assert.equal((await worker.ensureModelTab('gemini')).id, t.id);
  assert.equal(creates.length, 0, 'a second tab');
  assert.deepEqual(await worker.whoseTab(t.id), { main: 'gemini' }, 'so its models are read');
});
