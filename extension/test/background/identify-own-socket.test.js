/**
 * A socket identifies on itself, never on whichever socket is current by then.
 *
 * Reported from chrome://extensions, 2026-10-24: `Uncaught (in promise)
 * InvalidStateError: Failed to execute 'send' on 'WebSocket': Still in
 * CONNECTING state`, at the `identify` send in `onopen`. That handler awaits
 * storage first, and in the gap the socket can close and a retry can open the
 * next one; `ws.send` then reached the new, still-connecting socket. The same
 * aliasing let the old socket's `onclose` null out its successor.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const sockets = [];
class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(data) {
    if (this.readyState !== 1) throw new Error("InvalidStateError: Still in CONNECTING state");
    this.sent.push(JSON.parse(data));
  }
  close() { this.readyState = 3; }
}

let release;
globalThis.WebSocket = FakeWebSocket;
globalThis.chrome = {
  alarms: { get: async () => ({ name: 'reconnect' }), create() {}, clear: async () => true, onAlarm: { addListener() {} } },
  storage: {
    local: { get: async () => ({}) },
    session: {
      get: async () => ({}),
      // The await `onopen` sits in. Held open until the test lets it go.
      set: () => new Promise((r) => { release = r; }),
    },
  },
  runtime: { getPlatformInfo: async () => ({}), id: 'test', getManifest: () => ({ version: '0.0.0' }), sendMessage: async () => {} },
  commands: { getAll: async () => [] },
  tabs: { query: async () => [] },
};

test('a socket replaced while onopen waits does not send on its successor', async (t) => {
  // The close schedules a retry and a keep-alive; real ones would hold the process open.
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.after(() => mock.timers.reset());
  const socket = await import('../../src/background/socket.js');
  await socket.connectWebSocket();
  const first = sockets.at(-1);

  first.readyState = 1;
  const opening = first.onopen();            // parks in setState
  await new Promise((r) => setImmediate(r));

  // It drops during the wait, and a retry opens the next socket.
  first.readyState = 3;
  const closing = first.onclose({ code: 1006 });
  release?.();
  await new Promise((r) => setImmediate(r));
  await socket.connectWebSocket();
  const second = sockets.at(-1);
  assert.notEqual(second, first, 'control: a second socket was opened');
  assert.equal(second.readyState, 0);

  // Let every pending storage write finish, including the one onopen awaits.
  for (let i = 0; i < 5; i++) { release?.(); await new Promise((r) => setImmediate(r)); }
  await assert.doesNotReject(opening, 'identify was sent on the connecting socket');
  await closing;
  assert.equal(second.sent.length, 0, 'the old socket spoke on the new one');
  assert.equal(socket.ws, second, 'the old socket\'s onclose tore down its successor');
});
