/**
 * The companion activates, and the chat view's host half answers the page.
 *
 * Run against a stub of the `vscode` module, because the real one exists only
 * inside an editor. Shallow on purpose — the shape of the server's tool smoke
 * sweep: the failure worth catching is "this throws on the way in", which
 * costs the whole extension, and which a typo is enough to cause.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

function stubVscode(root, version = '1.107.0') {
  const registered = { commands: new Map(), views: new Map(), providers: new Map() };
  const disposable = { dispose() {} };
  class EventEmitter { constructor() { this.event = () => disposable; } fire() {} }
  const Uri = {
    file: (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => `file://${p}` }),
    joinPath: (base, ...parts) => Uri.file(path.join(base.fsPath, ...parts)),
    from: (o) => ({ ...o, toString: () => `${o.scheme}:${o.path}?${o.query || ''}` }),
  };
  const shown = [];
  const executed = [];
  const statusItems = [];
  const vscode = {
    version, Uri, EventEmitter,
    StatusBarAlignment: { Left: 1, Right: 2 },
    Range: class {}, CodeLens: class {}, CodeAction: class {},
    CodeActionKind: { Empty: 'empty' },
    workspace: {
      workspaceFolders: [{ uri: Uri.file(root) }],
      registerTextDocumentContentProvider: (scheme, p) => { registered.providers.set(scheme, p); return disposable; },
      findFiles: async () => [Uri.file(path.join(root, 'a.js'))],
      openTextDocument: async (u) => ({ getText: () => 'x', lineCount: 1, languageId: 'javascript', uri: u }),
    },
    window: {
      activeTextEditor: undefined,
      onDidChangeActiveTextEditor: () => disposable,
      onDidChangeTextEditorSelection: () => disposable,
      registerWebviewViewProvider: (id, p) => { registered.views.set(id, p); return disposable; },
      showInformationMessage: (...a) => { shown.push(a[0]); return Promise.resolve(undefined); },
      showWarningMessage: (...a) => { shown.push(a[0]); return Promise.resolve(undefined); },
      showErrorMessage: (...a) => { shown.push(a[0]); return Promise.resolve(undefined); },
      setStatusBarMessage: () => disposable,
      createStatusBarItem: () => {
        const item = { shown: false, show() { item.shown = true; }, dispose() {} };
        statusItems.push(item);
        return item;
      },
      showQuickPick: async (items) => items[items.length - 1],
      createTerminal: (o) => ({ show() {}, sendText: (t) => executed.push(['terminal', o.cwd, t]) }),
      showTextDocument: async () => {},
    },
    languages: {
      getDiagnostics: () => [],
      onDidChangeDiagnostics: () => disposable,
      registerCodeActionsProvider: () => disposable,
      registerCodeLensProvider: () => disposable,
    },
    commands: {
      registerCommand: (id, fn) => { registered.commands.set(id, fn); return disposable; },
      executeCommand: async (...a) => { executed.push(a); },
    },
  };
  return { vscode, registered, shown, executed, statusItems };
}

/** Drops every companion module from the cache, so the next require binds to the new stub. */
function forgetCompanion() {
  const dir = path.join(__dirname, '..') + path.sep;
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(dir) && !k.includes(`${path.sep}test${path.sep}`) && !k.includes('node_modules')) delete require.cache[k];
  }
}

/** Activates the companion against a stub; returns the stub's records. */
function activateWith(t, root, version, globalState) {
  const stub = stubVscode(root, version);
  const realLoad = Module._load;
  Module._load = function (req, ...rest) { return req === 'vscode' ? stub.vscode : realLoad.call(this, req, ...rest); };
  t.after(() => { Module._load = realLoad; });
  forgetCompanion();
  require('../extension.js').activate({
    subscriptions: [],
    extensionUri: stub.vscode.Uri.file(path.join(__dirname, '..')),
    extension: { packageJSON: require('../package.json') },
    globalState,
  });
  return stub;
}

const memento = (seed = {}) => {
  const data = { ...seed };
  return { data, get: (k) => data[k], update: (k, v) => { data[k] = v; return Promise.resolve(); } };
};

test('the chat lives in the secondary side bar where the editor has one', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-bar-'));
  const pkg = require('../package.json').contributes;
  activateWith(t, root, '1.107.0', memento()); // chat-panel.js needs the stub to load
  const { supportsSecondarySidebar } = require('../chat-panel.js');

  await t.test('1.106 and later have it; Cursor 2.x is built on older', () => {
    assert.equal(supportsSecondarySidebar('1.107.0'), true);
    assert.equal(supportsSecondarySidebar('1.106.0'), true);
    assert.equal(supportsSecondarySidebar('1.105.1'), false);
    assert.equal(supportsSecondarySidebar('1.93.0'), false);
    assert.equal(supportsSecondarySidebar(undefined), false);
  });

  await t.test('package.json gates each home on the context key, so exactly one shows', () => {
    assert.equal(pkg.viewsContainers.secondarySidebar[0].when, '!agentCli:noSecondarySidebar');
    assert.equal(pkg.viewsContainers.activitybar[0].when, 'agentCli:noSecondarySidebar');
    assert.equal(pkg.views.agentCliSecondary[0].id, 'agentCli.chatSecondary');
    assert.equal(pkg.views.agentCli[0].id, 'agentCli.chat');
  });

  for (const [version, key, view] of [['1.107.0', false, 'agentCli.chatSecondary'], ['1.99.3', true, 'agentCli.chat']]) {
    await t.test(`VS Code ${version}: context key ${key}, focus goes to ${view}`, async () => {
      const state = memento();
      const { registered, executed, statusItems } = activateWith(t, root, version, state);
      assert.ok(registered.views.has('agentCli.chat') && registered.views.has('agentCli.chatSecondary'));
      assert.ok(executed.some((a) => a[0] === 'setContext' && a[1] === 'agentCli:noSecondarySidebar' && a[2] === key));
      assert.ok(executed.some((a) => a[0] === `${view}.focus`), 'first activation shows the chat');
      assert.equal(state.data['agentCli.chatOpenedOnce'], true);
      assert.ok(statusItems[0]?.shown && statusItems[0].command === 'agentCli.focusChat', 'the status bar opens it');
      executed.length = 0;
      await registered.commands.get('agentCli.focusChat')();
      assert.ok(executed.some((a) => a[0] === `${view}.focus`));
    });
  }

  await t.test('control: it is shown once, not on every start', () => {
    const { executed } = activateWith(t, root, '1.107.0', memento({ 'agentCli.chatOpenedOnce': true }));
    assert.ok(!executed.some((a) => /\.focus$/.test(String(a[0]))));
  });
});

test('the companion activates and the chat view answers its page', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-smoke-'));
  fs.writeFileSync(path.join(root, 'a.js'), 'x');
  const { vscode, registered, shown, executed } = stubVscode(root);

  const realLoad = Module._load;
  Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : realLoad.call(this, req, ...rest); };
  t.after(() => { Module._load = realLoad; });
  forgetCompanion();
  const ext = require('../extension.js');

  const context = {
    subscriptions: [],
    extensionUri: vscode.Uri.file(path.join(__dirname, '..')),
    extension: { packageJSON: require('../package.json') },
  };
  ext.activate(context);

  await t.test('every command in package.json is registered', () => {
    const declared = require('../package.json').contributes.commands.map((c) => c.command);
    for (const id of declared) assert.ok(registered.commands.has(id), `${id} declared but not registered`);
  });

  // The view, resolved the way VS Code resolves it.
  const posted = [];
  let onMessage = null;
  const webview = {
    options: {}, html: '', cspSource: 'vscode-resource:',
    asWebviewUri: (u) => ({ toString: () => `vscode-resource:${u.fsPath}` }),
    postMessage: (m) => { posted.push(m); return Promise.resolve(true); },
    onDidReceiveMessage: (fn) => { onMessage = fn; return { dispose() {} }; },
  };
  registered.views.get('agentCli.chat').resolveWebviewView({ webview, onDidDispose: () => ({ dispose() {} }) });

  await t.test('the page is the side panel with the shim in front', () => {
    assert.match(webview.html, /vscode-shim\.js/);
    assert.match(webview.html, /media\/panel\/panel\.js/);
    assert.equal(webview.options.enableScripts, true);
  });

  await t.test('no agent: the page is told why, and starting one is offered', async () => {
    onMessage({ type: 'need_bridge' });
    assert.deepEqual(posted.at(-1), { type: 'bridge', payload: { missing: 'no-agent' } });
    assert.ok(shown.some((s) => /no agent is running/i.test(s)));
  });

  await t.test('a running agent: the page is given its port and token', () => {
    fs.mkdirSync(path.join(root, '.agent', 'state'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agent', 'state', 'bridge.json'), JSON.stringify({ port: 7801, token: 'tok', pid: process.pid }));
    onMessage({ type: 'need_bridge' });
    assert.deepEqual(posted.at(-1), { type: 'bridge', payload: { port: 7801, token: 'tok' } });
  });

  await t.test('a diff opens in the editor', async () => {
    onMessage({ type: 'show_diff', payload: { diffId: 'd1', filePath: 'a.js', absPath: path.join(root, 'a.js'), newContent: 'y' } });
    await new Promise((r) => setImmediate(r));
    assert.ok(executed.some((a) => a[0] === 'vscode.diff'));
    const provider = registered.providers.get('agent-cli-proposed');
    assert.equal(provider.provideTextDocumentContent({ path: '/a.js', query: 'd1' }), 'y');
  });

  await t.test('@ attaches a file as a marker plus its text', async () => {
    onMessage({ type: 'pick_file' });
    await new Promise((r) => setTimeout(r, 20));
    const insert = posted.find((m) => m.type === 'insert');
    assert.ok(insert, 'nothing was inserted');
    assert.equal(insert.payload.marker, '@a.js:1');
    assert.match(insert.payload.body, /^a\.js \(lines 1-1\):/);
  });

  await t.test('Attach to Agent CLI queues the selected files by path', () => {
    const queue = path.join(root, '.agent', 'state', 'chat-queue.jsonl');
    fs.rmSync(queue, { force: true });
    const a = vscode.Uri.file(path.join(root, 'a.js'));
    const b = vscode.Uri.file(path.join(root, 'b.pdf'));
    registered.commands.get('agentCli.attachToChat')(a, [a, b]);
    registered.commands.get('agentCli.attachToChat')(a, undefined);
    const lines = fs.readFileSync(queue, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.paths), [[a.fsPath, b.fsPath], [a.fsPath]]);
  });

  await t.test('Start Agent runs `agent` in the folder', () => {
    registered.commands.get('agentCli.startAgent')();
    assert.ok(executed.some((a) => a[0] === 'terminal' && a[1] === root && a[2] === 'agent'));
  });
});
