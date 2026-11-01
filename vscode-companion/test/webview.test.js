/**
 * The editor chat panel, end to end without VS Code: the real agent bridge,
 * the Chrome side panel's real page and the shim, in jsdom.
 *
 * The webview's socket is given the origin VS Code sends, `vscode-webview://…`,
 * so admission is exercised the way it happens for real — token and all.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');
const WS = require('ws');
const { buildWebviewHtml, readBridge, EDITOR_ABSENT_BUTTONS } = require('../chat-panel-html.js');

const SIDE_PANEL = path.join(__dirname, '..', '..', 'extension', 'side-panel');
const panelHtml = fs.readFileSync(path.join(SIDE_PANEL, 'panel.html'), 'utf8');
const panelJs = fs.readFileSync(path.join(SIDE_PANEL, 'panel.js'), 'utf8');
const shimJs = fs.readFileSync(path.join(__dirname, '..', 'media', 'vscode-shim.js'), 'utf8');

const OPTS = { cspSource: 'vscode-resource:', nonce: 'N0NCE', css: 'C.css', panelJs: 'P.js', shimJs: 'S.js', version: '1.8.0' };

test('the webview page', async (t) => {
  const html = buildWebviewHtml(panelHtml, OPTS);

  await t.test('drops the buttons that mean nothing in an editor, keeps the rest', () => {
    for (const id of EDITOR_ABSENT_BUTTONS) assert.ok(!html.includes(`id="${id}"`), id);
    for (const id of ['new-btn', 'sessions-btn', 'mode-toggle', 'command-input']) assert.ok(html.includes(`id="${id}"`), id);
  });
  await t.test('loads the shim before the panel, both by nonce', () => {
    const shimAt = html.indexOf('src="S.js"');
    const panelAt = html.indexOf('src="P.js"');
    assert.ok(shimAt !== -1 && panelAt !== -1 && shimAt < panelAt);
    assert.equal((html.match(/<script nonce="N0NCE"/g) || []).length, 2);
    assert.ok(!html.includes('<script src="panel.js">'), 'the unrewritten tag is gone');
  });
  await t.test('its CSP allows scripts by nonce only, and sockets to loopback only', () => {
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(csp, /script-src 'nonce-N0NCE'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.match(csp, /connect-src ws:\/\/127\.0\.0\.1:\*/);
  });
});

test('readBridge', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-bridge-'));
  const file = path.join(dir, 'bridge.json');
  await t.test('no file: no agent', () => assert.deepEqual(readBridge(file), { missing: 'no-agent' }));
  await t.test('a live pid: the port and token', () => {
    fs.writeFileSync(file, JSON.stringify({ port: 7777, token: 't', pid: process.pid }));
    assert.deepEqual(readBridge(file), { port: 7777, token: 't' });
  });
  await t.test('a dead pid: stale, not a port to dial', () => {
    fs.writeFileSync(file, JSON.stringify({ port: 7777, token: 't', pid: 4242 }));
    assert.deepEqual(readBridge(file, () => false), { missing: 'stale' });
  });
  await t.test('garbage: unreadable', () => {
    fs.writeFileSync(file, JSON.stringify({ port: 'x' }));
    assert.deepEqual(readBridge(file), { missing: 'unreadable' });
  });
});

/** Boot the real bridge with a loop that answers every prompt. */
async function bridge() {
  const { WebSocketServer } = await import('../../server/src/backend/bridge/websocket-server.js');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-ws-'));
  const received = [];
  const agentLoop = {
    workspace, mode: 'plan',
    setBackgroundCallbacks() {},
    sessionStore: { loadHistory: () => [{ role: 'user', content: 'an earlier question' }, { role: 'agent', content: 'an earlier answer' }] },
    async handleUserMessage(content, callbacks) {
      received.push(content);
      callbacks.sendToPanel({ id: 'r', type: 'agent_response', payload: { content: `ANSWER to: ${content.slice(0, 20)}` }, timestamp: Date.now() });
      // A prompt for the browser goes out too — it must reach the extension only.
      callbacks.injectPrompt({ prompt: 'for the browser tab' });
    },
  };
  const server = new WebSocketServer({ port: 0, agentLoop });
  await server.start();
  const info = JSON.parse(fs.readFileSync(path.join(workspace, '.agent', 'state', 'bridge.json'), 'utf8'));
  return { server, info, received, workspace };
}

/** The webview: panel.html with the shim and panel.js run inside it. */
function webview({ origin = 'vscode-webview://test-panel' } = {}) {
  const dom = new JSDOM(panelHtml.replace('<script src="panel.js"></script>', ''), { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const toHost = [];
  const frames = [];
  w.acquireVsCodeApi = () => ({ postMessage: (m) => toHost.push(m) });
  // VS Code's webview sends its own origin; the `ws` client lets us say so.
  w.WebSocket = class extends WS {
    constructor(url) {
      super(url, { origin });
      this.on('message', (d) => frames.push(JSON.parse(String(d)).type));
    }
  };
  w.eval(shimJs);
  w.eval(panelJs);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const fromHost = (data) => w.dispatchEvent(new w.MessageEvent('message', { data }));
  return { dom, w, toHost, frames, fromHost };
}

const until = async (cond, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

test('the panel, through the shim, against the real bridge', async (t) => {
  const { server, info, received } = await bridge();
  const v = webview();
  const doc = v.w.document;

  await t.test('it asks the host where the agent is', () => {
    // A field, not deepEqual: the object was made in jsdom's realm.
    assert.equal(v.toHost[0]?.type, 'need_bridge');
  });

  v.fromHost({ type: 'bridge', payload: { port: info.port, token: info.token } });

  await t.test('it connects, identifies as an editor, and shows the history', async () => {
    assert.ok(await until(() => doc.getElementById('connection-text').textContent === 'Connected'), 'never connected');
    const editor = [...server.clients.values()].find((c) => c.type === 'editor');
    assert.ok(editor, 'the server should see an editor client');
    assert.ok(await until(() => doc.body.textContent.includes('an earlier answer')), 'history was not drawn');
  });

  await t.test('a message round-trips and the reply is drawn', async () => {
    const input = doc.getElementById('command-input');
    input.value = 'what does notes.txt say';
    doc.getElementById('send-btn').click();
    assert.ok(await until(() => received.length === 1));
    assert.equal(received[0], 'what does notes.txt say');
    assert.ok(await until(() => doc.body.textContent.includes('ANSWER to: what does notes.txt')), 'reply not drawn');
  });

  await t.test('the browser prompt never reached the panel', () => {
    assert.ok(!v.frames.includes('inject_prompt'), `editor was sent: ${v.frames.join(',')}`);
  });

  await t.test('an @ attachment is sent expanded and shown as its marker', async () => {
    const input = doc.getElementById('command-input');
    input.value = 'explain @';
    input.selectionStart = input.selectionEnd = input.value.length;
    v.fromHost({ type: 'insert', payload: { marker: '@app.js:1-3', body: 'app.js (lines 1-3):\n```js\nconst x = 1;\n```' } });
    assert.equal(input.value, 'explain @app.js:1-3 ');
    doc.getElementById('send-btn').click();
    assert.ok(await until(() => received.length === 2));
    assert.match(received[1], /const x = 1;/, 'the model gets the text');
    assert.doesNotMatch(received[1], /@app\.js:1-3/);
    assert.ok([...doc.querySelectorAll('.message-user, .message.user, [class*="user"]')].some((el) => el.textContent.includes('@app.js:1-3'))
      || doc.body.textContent.includes('explain @app.js:1-3'), 'the transcript keeps the marker');
  });

  await t.test('a diff request is shown in the editor as well as the panel', async () => {
    server.broadcast('extension', { id: 'd', type: 'diff_request', payload: { diffId: 'd1', filePath: 'a.js', patch: '+x', absPath: '/w/a.js', newContent: 'x' } });
    assert.ok(await until(() => v.toHost.some((m) => m.type === 'show_diff' && m.payload.diffId === 'd1')));
    assert.ok(await until(() => doc.getElementById('diff-d1')), 'the panel draws it too');
  });

  await t.test('an editor-side decision answers through the page', async () => {
    const sent = [];
    const editor = [...server.clients.values()].find((c) => c.type === 'editor');
    editor.ws.on('message', (d) => sent.push(JSON.parse(String(d))));
    v.fromHost({ type: 'diff_decision', payload: { diffId: 'd1', action: 'accept' } });
    assert.ok(await until(() => sent.some((m) => m.type === 'diff_response' && m.payload.diffId === 'd1' && m.payload.action === 'accept')));
  });

  v.dom.window.close();
  await server.stop();
});

test('without the token the webview is refused', async () => {
  const { server, info } = await bridge();
  const v = webview();
  v.fromHost({ type: 'bridge', payload: { port: info.port, token: 'not-the-token' } });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(![...server.clients.values()].some((c) => c.type === 'editor'));
  assert.notEqual(v.w.document.getElementById('connection-text').textContent, 'Connected');
  v.dom.window.close();
  await server.stop();
});
