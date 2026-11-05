/**
 * A closed tab is noticed, and a tab that cannot open says so (1.61.0).
 *
 * Reported with screenshots: the Gemini tab was closed during a turn, nothing
 * noticed, and "Reopening gemini in a new tab" then failed without a word.
 * Reproduced with the real extension in headless Chrome: with the last window
 * closed, `tabs.create` rejects with "No current window", nothing caught it,
 * and the server waited out both two-minute silence clocks.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const sockets = [];
class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() {}
}
globalThis.WebSocket = FakeWebSocket;

const stored = {};
const world = { tabs: new Map(), creates: [], windowsOpened: [], createFails: null, windowFails: false, nextId: 100 };
const listeners = new Set();

function open(url) {
  world.nextId += 1;
  const tab = { id: world.nextId, url, status: world.loading ? 'loading' : 'complete' };
  world.tabs.set(tab.id, tab);
  return tab;
}

globalThis.chrome = {
  tabs: {
    sendMessage: async (id, msg) => {
      if (!world.tabs.has(id)) throw new Error('Could not establish connection');
      return msg.type === 'ping' ? { ready: true, canType: true } : { success: true };
    },
    create: async ({ url }) => {
      world.creates.push(url);
      if (world.createFails) throw new Error(world.createFails);
      return open(url);
    },
    remove: async (id) => { world.tabs.delete(id); },
    get: async (id) => {
      if (!world.tabs.has(id)) throw new Error(`No tab with id: ${id}`);
      return world.tabs.get(id);
    },
    query: async () => [...world.tabs.values()],
    update: async () => {},
    reload: async () => {},
    onUpdated: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l) },
  },
  windows: {
    create: async ({ url }) => {
      if (world.windowFails) throw new Error('Could not create a window');
      world.windowsOpened.push(url);
      return { tabs: [open(url)] };
    },
    update: async () => {},
  },
  scripting: { executeScript: async () => {} },
  storage: {
    session: { get: async (k) => ({ [k]: stored[k] }), set: async (o) => Object.assign(stored, o) },
    local: { get: async () => ({}) },
  },
  runtime: {
    id: 'test', getPlatformInfo: async () => ({}), sendMessage: async () => {},
    getManifest: () => ({ version: '0.0.0' }),
  },
  commands: { getAll: async () => [] },
  alarms: { get: async () => ({ name: 'reconnect' }), create() {}, clear: async () => true, onAlarm: { addListener() {} } },
};

mock.timers.enable({ apis: ['setInterval'] });
const socket = await import('../../src/background/socket.js');
const worker = await import('../../src/background/content.js');
await socket.connectWebSocket();
const sent = () => sockets.at(-1).sent;

function reset() {
  for (const id of world.tabs.keys()) worker.forgetTab(id);
  world.tabs.clear();
  world.creates.length = 0;
  world.windowsOpened.length = 0;
  world.createFails = null;
  world.windowFails = false;
  sent().length = 0;
  delete stored.agentOwnedTabs;
}

const CHAT = 'https://gemini.google.com/app/abc';

test('the main tab is reported as the main tab', async () => {
  reset();
  const tab = await worker.ensureModelTab('gemini', { url: CHAT });
  assert.deepEqual(await worker.whoseTab(tab.id), { main: 'gemini' });
});

test('after a worker restart an owned tab is still the main tab', async () => {
  reset();
  const tab = open(CHAT);
  await worker.claimOwnedTab(tab.id);       // nothing in mainTabs, as after a restart
  assert.deepEqual(await worker.whoseTab(tab.id), { main: 'gemini' });
});

test("a person's own Gemini tab closing means nothing", async () => {
  reset();
  assert.equal(await worker.whoseTab(open(CHAT).id), null);
  // Nor while a main tab exists, which is the path that skips storage.
  const mine = await worker.ensureModelTab('gemini', { url: CHAT });
  assert.ok(mine);
  assert.equal(await worker.whoseTab(open(CHAT).id), null);
});

test('the fresh-tab repair closing its old tab is not a person closing it', async () => {
  reset();
  const old = await worker.ensureModelTab('gemini', { url: CHAT });
  const fresh = await worker.reopenInFreshTab(old, 'gemini');
  assert.notEqual(fresh.id, old.id);
  assert.equal(world.tabs.has(old.id), false, 'control: the old tab really was closed');
  assert.equal(await worker.whoseTab(old.id), null);
  assert.deepEqual(await worker.whoseTab(fresh.id), { main: 'gemini' }, 'and the new one is the lane\'s');
});

test('ending a session is not a person closing its tab', async () => {
  reset();
  const tab = open(CHAT);
  worker.claimSubagentTab(tab.id, 's1');
  await new Promise((r) => setImmediate(r));      // the claim is not awaited
  assert.equal(await worker.isOwnedTab(tab.id), true, 'control: the session held it as owned');
  await worker.endSession('s1');
  assert.equal(world.tabs.has(tab.id), false, 'control: the session tab really was closed');
  assert.equal(await worker.whoseTab(tab.id), null);
});

test('a session tab after a worker restart is not the main tab', async () => {
  reset();
  const tab = open(CHAT);
  await worker.claimOwnedTab(tab.id);
  assert.deepEqual(await worker.whoseTab(tab.id), { main: 'gemini' }, 'control: owned and no session');
  stored.agentSessionTabs = { s2: tab.id };
  assert.equal(await worker.whoseTab(tab.id), null);
  delete stored.agentSessionTabs;
});

test('a subagent waiting on its tab is that request, and an answered one is nothing', async () => {
  reset();
  await worker.injectPromptIntoModel({ prompt: 'x', isSubagent: true, requestId: 'r1', sessionId: 's3' });
  const id = [...world.tabs.keys()].at(-1);
  assert.deepEqual(await worker.whoseTab(id), { subagent: 'r1' });
  worker.subagentAnswered(id);
  assert.equal(await worker.whoseTab(id), null);
  await worker.endSession('s3');
});

test('the main tab closing says tab_closed, with the tab it was', () => {
  reset();
  worker.reportClosedTab(7, { main: 'gemini' });
  assert.equal(sent()[0].type, 'tab_closed');
  assert.equal(sent()[0].payload.tabId, 7);
});

test("a subagent's tab closing fails that request only", () => {
  reset();
  worker.reportClosedTab(7, { subagent: 'r1' });
  const { type, payload } = sent()[0];
  assert.equal(type, 'error');
  assert.equal(payload.requestId, 'r1');
  assert.equal(payload.isSubagent, true);
  assert.equal(payload.detail, 'the tab was closed');
});

test('someone else\'s tab closing sends nothing', () => {
  reset();
  worker.reportClosedTab(7, null);
  assert.deepEqual(sent(), []);
});

test('with no window left, the tab opens in a new window', async () => {
  reset();
  world.createFails = 'No current window';
  await worker.injectPromptIntoModel({ prompt: 'x', threadUrl: CHAT });
  assert.deepEqual(world.windowsOpened, [CHAT], 'back on the same chat, in a window of its own');
  assert.equal(sent().filter((m) => m.type === 'error').length, 0);
});

test('a tab that cannot open at all is reported, with the reason', async () => {
  reset();
  world.createFails = 'No current window';
  world.windowFails = true;
  await worker.injectPromptIntoModel({ prompt: 'x', threadUrl: CHAT });
  const error = sent().find((m) => m.type === 'error');
  assert.equal(error?.payload.op, 'no_tab', 'silence here is a four-minute spinner');
  assert.equal(error.payload.detail, 'Could not create a window');
  assert.doesNotMatch(error.payload.message, /[❌🌐]/u);
});

test('a prompt that throws is reported, whoever sent it', () => {
  reset();
  worker.reportInjectFailure({ isSubagent: true, requestId: 'r9' }, new Error('boom'));
  worker.reportInjectFailure({}, new Error('boom'));
  const [sub, main] = sent();
  assert.equal(sub.payload.requestId, 'r9');
  assert.equal(sub.payload.op, 'tab_unreachable');
  assert.equal(main.payload.op, 'no_tab');
  assert.equal(main.payload.detail, 'boom');
});

test('a tab closed under the send is not reopened', async () => {
  reset();
  const tab = await worker.ensureModelTab('gemini', { url: CHAT });
  const real = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (id, msg) => {
    if (msg.type === 'inject_prompt') { world.tabs.delete(id); throw new Error('The tab was closed'); }
    return real(id, msg);
  };
  world.creates.length = 0;
  await worker.injectPromptIntoModel({ prompt: 'x', threadUrl: CHAT });
  chrome.tabs.sendMessage = real;
  assert.equal(world.tabs.has(tab.id), false, 'control: it did close');
  assert.deepEqual(world.creates, [], 'the turn is over; nothing to reopen it for');
  assert.equal(sent().filter((m) => m.type === 'error').length, 0, 'tab_closed says it, once');
});

test('a tab closed while it is still loading is the main tab closing', async () => {
  reset();
  world.loading = true;
  const opening = worker.ensureModelTab('gemini', { url: CHAT });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  world.loading = false;
  const id = [...world.tabs.keys()].at(-1);
  assert.ok(id, 'control: the tab exists and has not finished loading');
  assert.deepEqual(await worker.whoseTab(id), { main: 'gemini' });
  world.tabs.delete(id);
  listeners.forEach((l) => l(id, { status: 'complete' }));
  await opening;
});

test('a tab already loaded when the wait starts does not wait out the budget', async () => {
  reset();
  const started = Date.now();
  await worker.ensureModelTab('gemini', { url: CHAT });   // no load event ever fires here
  assert.ok(Date.now() - started < 4000, 'the listener was attached after the page had finished');
});

test('a handler that throws is not called an unreadable message', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../../src/background/socket.js'), 'utf8');
  const onmessage = source.slice(source.indexOf('sock.onmessage'), source.indexOf('sock.onclose'));
  const parse = onmessage.indexOf('JSON.parse');
  const label = onmessage.indexOf('unparseable');
  const handler = onmessage.indexOf('handleServerMessage');
  assert.ok(parse < label && label < handler, 'the label belongs to the parse alone');
  assert.match(source, /injectPromptIntoModel\(payload\)\.catch\(/);
});
