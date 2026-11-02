/**
 * The editor panel (v5.2): what reaches it, and who may connect at all.
 *
 * Two failures this guards, in opposite directions. A panel that is *starved*
 * of a request type deadlocks the turn waiting on its answer. A panel that is
 * *fed* `inject_prompt` is handed the user's prompt to type into nothing —
 * the turn hangs until the lane watchdog and the prompt is gone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import {
  WebSocketServer, WORKER_ONLY_TYPES, admitClient, tokenFromUrl,
} from '../../../src/backend/bridge/websocket-server.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A client whose socket records what it was sent. */
const fakeClient = (type) => {
  const got = [];
  return { type, got, ws: { OPEN: 1, readyState: 1, send: (m) => got.push(JSON.parse(m).type) } };
};

function bridgeWith(...types) {
  const server = Object.create(WebSocketServer.prototype);
  const clients = types.map(fakeClient);
  server.clients = new Map(clients.map((c, i) => [`c${i}`, c]));
  server.pendingInjects = [];
  return { server, clients };
}

test('routing to an editor panel', async (t) => {
  await t.test('a panel message reaches the extension and the editor', () => {
    const { server, clients: [ext, editor] } = bridgeWith('extension', 'editor');
    assert.equal(server.broadcast('extension', { type: 'agent_response' }), true);
    assert.deepEqual(ext.got, ['agent_response']);
    assert.deepEqual(editor.got, ['agent_response']);
  });

  await t.test('the requests a turn parks on reach the editor', () => {
    const { server, clients: [, editor] } = bridgeWith('extension', 'editor');
    for (const type of ['ask_question', 'request_command_approval', 'diff_request', 'response_stream']) {
      server.broadcast('extension', { type });
    }
    assert.deepEqual(editor.got, ['ask_question', 'request_command_approval', 'diff_request', 'response_stream']);
  });

  await t.test('inject_prompt never reaches an editor — not even via "all"', () => {
    const { server, clients: [ext, editor] } = bridgeWith('extension', 'editor');
    server.broadcast('extension', { type: 'inject_prompt' });
    server.broadcast('all', { type: 'inject_prompt' });
    assert.deepEqual(editor.got, []);
    assert.deepEqual(ext.got, ['inject_prompt', 'inject_prompt']);
  });

  await t.test('with only an editor connected, a prompt is held for the extension', () => {
    const { server, clients: [editor] } = bridgeWith('editor');
    assert.equal(server.sendInjectPrompt({ prompt: 'p' }), false, 'nobody who can type it received it');
    assert.equal(server.pendingInjects.length, 1);
    assert.deepEqual(editor.got, []);
  });

  await t.test('control: a client of another type gets nothing extension-bound', () => {
    const { server, clients: [other] } = bridgeWith('unknown');
    server.broadcast('extension', { type: 'agent_response' });
    assert.deepEqual(other.got, []);
  });
});

test('WORKER_ONLY_TYPES matches what the worker handles itself', () => {
  // Read from the worker's source: derived from our own constant it would be
  // comparing the list to itself.
  const src = readFileSync(join(HERE, '../../../../extension/src/background/socket.js'), 'utf8');
  const start = src.indexOf('async function handleServerMessage');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const cases = [...body.matchAll(/case '([a-z_]+)':/g)].map((m) => ({ type: m[1], at: m.index }));

  const workerOnly = [];
  for (let i = 0; i < cases.length; i++) {
    // The statements belonging to this label run until the next `break;` after it.
    const end = body.indexOf('break;', cases[i].at);
    const segment = body.slice(cases[i].at, end);
    if (!segment.includes('broadcastToSidePanel')) workerOnly.push(cases[i].type);
  }
  assert.ok(workerOnly.includes('inject_prompt'), 'control: the parse found the worker cases');
  assert.ok(!workerOnly.includes('agent_response'), 'control: panel cases are told apart');

  // stop_generation is a worker case since extension 1.59.0. This test had
  // excused it as "consumed by the content script", but a content script never
  // sees the socket: it fell to `default` and every stop went to the panel.
  const expected = [...WORKER_ONLY_TYPES].sort();
  assert.deepEqual(workerOnly.sort(), expected);
});

test('admission', async (t) => {
  const T = 'a'.repeat(48);
  await t.test('a website is refused, token or not', () => {
    assert.equal(admitClient({ origin: 'https://evil.com', token: T, expected: T }), false);
  });
  await t.test('the Chrome extension needs no token — it cannot read one', () => {
    assert.equal(admitClient({ origin: 'chrome-extension://abc', expected: T }), true);
  });
  await t.test('an editor webview needs the token', () => {
    assert.equal(admitClient({ origin: 'vscode-webview://123', expected: T }), false);
    assert.equal(admitClient({ origin: 'vscode-webview://123', token: T, expected: T }), true);
  });
  await t.test('a local process with no Origin needs the token', () => {
    assert.equal(admitClient({ expected: T }), false);
    assert.equal(admitClient({ token: 'b'.repeat(48), expected: T }), false);
    assert.equal(admitClient({ token: 'short', expected: T }), false);
    assert.equal(admitClient({ token: T, expected: T }), true);
  });
  await t.test('with no token issued, the old rule stands', () => {
    assert.equal(admitClient({}), true);
    assert.equal(admitClient({ origin: 'https://evil.com' }), false);
  });
  await t.test('the token is read off the URL', () => {
    assert.equal(tokenFromUrl(`/?token=${T}`), T);
    assert.equal(tokenFromUrl('/'), null);
    assert.equal(tokenFromUrl(undefined), null);
  });
});

test('a started bridge writes bridge.json and enforces its token', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'bridge-file-'));
  const agentLoop = { workspace, setBackgroundCallbacks() {}, mode: 'plan', sessionStore: { loadHistory: () => [] } };
  const server = new WebSocketServer({ port: 0, agentLoop });
  await server.start();
  const file = join(workspace, '.agent', 'state', 'bridge.json');
  const info = JSON.parse(readFileSync(file, 'utf8'));

  await t.test('it records port, pid and token, readable by its owner only', () => {
    assert.equal(info.port, server.wss.address().port);
    assert.equal(info.pid, process.pid);
    assert.equal(info.token, server.token);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  const connect = (query, origin) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/${query}`, origin ? { origin } : undefined);
    ws.on('message', (m) => { ws.close(); resolve(JSON.parse(m).type); });
    ws.on('error', () => resolve('refused'));
  });

  await t.test('a local client without the token is refused', async () => {
    assert.equal(await connect(''), 'refused');
  });
  await t.test('with it, the client is welcomed', async () => {
    assert.equal(await connect(`?token=${info.token}`), 'status');
  });
  await t.test('an editor webview with it is welcomed', async () => {
    assert.equal(await connect(`?token=${info.token}`, 'vscode-webview://abc'), 'status');
  });
  await t.test('the extension still needs nothing', async () => {
    assert.equal(await connect('', 'chrome-extension://abcdef'), 'status');
  });

  await t.test('stop removes the file', async () => {
    await server.stop();
    assert.equal(existsSync(file), false);
  });

  await t.test("stop leaves another agent's file alone", async () => {
    const second = new WebSocketServer({ port: 0, agentLoop });
    await second.start();
    const theirs = JSON.stringify({ port: 1, pid: 999999, token: 'x' });
    writeFileSync(file, theirs); // another agent started on this workspace since
    await second.stop();
    assert.equal(readFileSync(file, 'utf8'), theirs);
  });
});
