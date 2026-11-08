/**
 * The panel's controls (v8.8), on the real page: panel.html with panel.js
 * running in it, driven by the messages the worker delivers.
 *
 * Reported with screenshots: `**High**` drawn with its asterisks, `/effort`
 * answering with nothing to click, a footer that named the effort and could not
 * change it, a mode button that could only cycle, and a grey slab beside send.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../side-panel');
const HTML = readFileSync(resolve(DIR, 'panel.html'), 'utf8');
const JS = readFileSync(resolve(DIR, 'panel.js'), 'utf8');
const CSS = readFileSync(resolve(DIR, 'panel.css'), 'utf8');

const STATE = {
  mode: 'plan',
  effort: 'high',
  model: '3.1 Pro',
  contextPct: 14,
  efforts: [
    { id: 'low', name: 'Low', model: '3.1 Flash-Lite', available: true },
    { id: 'high', name: 'High', model: '3.1 Pro', available: true },
    { id: 'max', name: 'Max', model: 'not on this account', available: false },
  ],
  modes: [
    { id: 'plan', about: 'edits need approval' },
    { id: 'auto', about: 'safe edits apply on their own' },
    { id: 'strict', about: 'every edit needs approval' },
  ],
};
const COMMANDS = [
  { name: 'compact', desc: 'Compact history' },
  { name: 'context', desc: 'What is in the window' },
  { name: 'chat', desc: 'Continue in a chat you name' },
  { name: 'effort', desc: 'How hard to work' },
];

function page(t, { state = STATE, commands = COMMANDS } = {}) {
  const dom = new JSDOM(HTML.replace(/<script src="panel\.js"><\/script>/, ''), {
    runScripts: 'dangerously', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const win = dom.window;
  const sent = [];
  const listeners = [];
  win.chrome = {
    runtime: {
      id: 'x',
      getManifest: () => ({ version: '0' }),
      onMessage: { addListener: (f) => listeners.push(f) },
      sendMessage: async (m) => { sent.push(m); return { success: true, connected: true }; },
    },
    storage: { session: { get: async () => ({}), set: async () => {} } },
  };
  // A script element, not eval: the page's `let`s must stay reachable.
  const script = win.document.createElement('script');
  script.textContent = JS;
  win.document.body.appendChild(script);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  const deliver = (type, payload) => listeners.forEach((f) => f({ type, payload }, {}, () => {}));
  deliver('status', { status: 'connected', workspace: '/w/repo', mode: 'plan', state, commands });
  const doc = win.document;
  const $ = (s) => doc.querySelector(s);
  const input = $('#command-input');
  const type = (text) => { input.value = text; input.dispatchEvent(new win.Event('input')); };
  const key = (k) => input.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const pick = (name) => [...doc.querySelectorAll('.pop-row')]
    .find((r) => r.querySelector('.pop-name').textContent === name)
    .dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  // Through JSON: the page's arrays belong to jsdom's realm, not this one.
  const commands_ = () => JSON.parse(JSON.stringify(sent.filter((m) => m.type === 'slash_command').map((m) => m.payload)));
  return { win, doc, $, sent, deliver, input, type, key, pick, commands: commands_ };
}

const rows = (doc) => [...doc.querySelectorAll('.pop-name')].map((r) => r.textContent);

test('a one-line status is formatted, not shown with its asterisks', (t) => {
  const { $, deliver } = page(t);
  deliver('command_result', { message: '⚙ mode **plan** → **auto** · safe `edits`' });
  const row = $('.status-text');
  assert.equal(row.querySelector('strong').textContent, 'plan');
  assert.ok(row.querySelector('code'), 'the backticks were not rendered');
  assert.doesNotMatch(row.textContent, /\*\*|`/);
});

test('a status still cannot carry markup', (t) => {
  const { $, deliver } = page(t);
  deliver('command_result', { message: 'x <img src=q onerror=alert(1)>' });
  assert.equal($('.status-text img'), null);
});

test('the mode is a menu: current ticked, a pick sends that mode', (t) => {
  const { $, doc, commands, pick } = page(t);
  assert.equal($('#popover').hidden, true);
  $('#mode-toggle').click();
  assert.equal($('#popover').hidden, false);
  assert.deepEqual(rows(doc), ['plan', 'auto', 'strict']);
  assert.equal(doc.querySelector('.pop-row.active .pop-check').textContent, '✔');
  pick('auto');
  assert.deepEqual(commands(), [{ command: 'auto', args: [] }]);
  assert.equal($('#mode-text').textContent, 'auto');
  assert.equal($('#mode-icon').textContent, '⏵⏵');
  assert.equal($('#popover').hidden, true);
});

test('picking the mode already set sends nothing', (t) => {
  const { $, commands, pick } = page(t);
  $('#mode-toggle').click();
  pick('plan');
  assert.deepEqual(commands(), []);
});

test('the effort is a menu of this account\'s models, and Max without Argon is refused', (t) => {
  const { $, doc, commands, pick } = page(t);
  $('#effort-btn').click();
  assert.deepEqual(rows(doc), ['Low', 'High', 'Max']);
  assert.match($('#popover').textContent, /3\.1 Flash-Lite/);
  pick('Max');
  assert.deepEqual(commands(), [], 'a rung this account does not have was sent');
  pick('Low');
  assert.deepEqual(commands(), [{ command: 'effort', args: ['low'] }]);
});

test('the keyboard skips a rung that cannot be chosen', (t) => {
  const { $, doc, key } = page(t);
  $('#effort-btn').click();
  key('ArrowDown');                    // from High, past Max, round to Low
  assert.equal(doc.querySelector('.pop-row.active .pop-name').textContent, 'Low');
  key('Escape');
  assert.equal($('#popover').hidden, true);
});

test('bare /effort opens the menu; /effort low runs', (t) => {
  const { $, type, key, commands } = page(t);
  type('/effort ');
  key('Enter');
  assert.equal($('#popover').hidden, false, 'bare /effort opened nothing');
  assert.deepEqual(commands(), []);
  key('Escape');
  type('/effort low');
  key('Enter');
  assert.deepEqual(commands(), [{ command: 'effort', args: ['low'] }]);
});

test('an agent older than the panel: the button falls back to the command', (t) => {
  const { $, commands } = page(t, { state: { effort: 'high' } });
  $('#effort-btn').click();
  assert.equal($('#popover').hidden, true);
  assert.deepEqual(commands(), [{ command: 'effort', args: [] }]);
});

test('`/` opens the palette, typing filters it, enter runs the command', (t) => {
  const { $, doc, type, key, commands } = page(t);
  type('/');
  assert.equal(rows(doc).length, 4);
  type('/co');
  assert.deepEqual(rows(doc), ['/compact', '/context']);
  key('ArrowDown');
  key('Enter');
  assert.deepEqual(commands(), [{ command: 'context', args: [] }]);
  assert.equal($('#command-input').value, '');
});

test('a prefix outranks a match inside the name', (t) => {
  const { doc, type } = page(t);
  type('/e');
  assert.equal(rows(doc)[0], '/effort');
});

test('/chat waits for its link instead of running empty', (t) => {
  const { $, type, key, commands } = page(t);
  type('/cha');
  key('Enter');
  assert.deepEqual(commands(), []);
  assert.equal($('#command-input').value, '/chat ');
});

test('a space ends the palette, and a sentence never opens it', (t) => {
  const { $, type } = page(t);
  type('/compact');
  assert.equal($('#popover').hidden, false);
  type('/compact now');
  assert.equal($('#popover').hidden, true);
  type('see /compact');
  assert.equal($('#popover').hidden, true);
});

test('a click outside closes a menu', (t) => {
  const { $, win, doc } = page(t);
  $('#mode-toggle').click();
  doc.querySelector('#message-stream').dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
  assert.equal($('#popover').hidden, true);
});

test('a command\'s answer updates the controls at once', (t) => {
  const { $, deliver } = page(t);
  deliver('command_result', { message: 'x', state: { ...STATE, effort: 'low', model: '3.1 Flash-Lite', contextPct: 61 } });
  assert.equal($('#effort-text').textContent, 'low');
  assert.match($('#panel-state').textContent, /61%/);
  assert.equal($('#panel-state').classList.contains('warn'), true);
});

test('a tab on another model is the footer\'s ⚠ and nothing else', (t) => {
  const { $, deliver } = page(t);
  assert.equal($('.tab-differs'), null, 'control: the tab matches');
  deliver('command_result', { state: { ...STATE, model: '3.8 Flash' } });
  assert.match($('.tab-differs').textContent, /⚠ 3\.8 Flash/);
});

test('the footer follows the tab after a switch, with no command to carry it', (t) => {
  const { $, deliver } = page(t);
  // What the screenshots showed: the setting moved, the tab had not answered yet.
  deliver('command_result', { state: { ...STATE, effort: 'low', model: '3.1 Pro', switching: true } });
  assert.equal($('.tab-differs'), null, 'mid-switch is not a mismatch');
  deliver('panel_state', { state: { ...STATE, effort: 'low', model: '3.1 Flash-Lite' } });
  assert.equal($('.tab-differs'), null, 'the tab landed on the rung\'s model');
  deliver('panel_state', { state: { ...STATE, effort: 'low', model: '3.1 Pro' } });
  assert.match($('.tab-differs').textContent, /⚠ 3\.1 Pro/, 'control: a standing difference still shows');
});

test('the terminal\'s amoled theme turns the panel black, and any other lets go', (t) => {
  const { doc, deliver } = page(t);
  const root = doc.documentElement;
  assert.equal(root.dataset.theme, undefined, 'control: no theme until the agent names one');
  deliver('panel_state', { state: { ...STATE, theme: 'amoled' } });
  assert.equal(root.dataset.theme, 'amoled');
  deliver('panel_state', { state: { ...STATE } });
  assert.equal(root.dataset.theme, 'amoled', 'an agent older than v9.9.1 sends no theme: keep what is set');
  deliver('panel_state', { state: { ...STATE, theme: 'dark' } });
  assert.equal(root.dataset.theme, undefined, 'dark follows the system or the editor, as before');
  deliver('panel_state', { state: { ...STATE, theme: null } });
  assert.equal(root.dataset.theme, undefined);
});

test('amoled\'s block outranks both :root blocks and the editor\'s bridge', () => {
  const block = CSS.match(/:root\[data-theme="amoled"\]\s*\{([^}]*)\}/);
  assert.ok(block, 'no amoled block in panel.css');
  assert.match(block[1], /--bg:\s*#000000;/);
  // Colours only: a font here would override the editor's in VS Code.
  assert.doesNotMatch(block[1], /--font-/);
  // Every role the base block sets, amoled sets too, or it would show dark's surface.
  const base = CSS.match(/^:root\s*\{([^}]*)\}/m)[1];
  const colours = (src) => [...src.matchAll(/(--[a-z-]+):\s*#/g)].map((m) => m[1]);
  for (const name of colours(base)) assert.match(block[1], new RegExp(`${name}:`), `${name} missing`);
  const bridge = readFileSync(resolve(DIR, '../../vscode-companion/chat-panel-html.js'), 'utf8');
  assert.doesNotMatch(bridge, /data-theme/, 'the bridge must stay a plain :root, below the attribute');
});

test('the header says what the project calls itself', (t) => {
  const { $, deliver } = page(t);
  assert.equal($('#workspace-name').textContent, 'repo', 'an older agent: the folder');
  deliver('status', { status: 'connected', workspace: '/w/Gemini-Agent', workspaceName: 'agent-cli', state: STATE });
  assert.equal($('#workspace-name').textContent, 'agent-cli');
  assert.equal($('#workspace-name').title, '/w/Gemini-Agent');
});

test('files from the editor\'s dialog: an image shows, the rest go by path', (t) => {
  const { win, $, input, sent } = page(t);
  win.__agentAddFiles([
    { path: '/elsewhere/shot.png', mime: 'image/png', sizeKB: 3, dataUrl: 'data:image/png;base64,AAAA' },
    { path: '/elsewhere/report.pdf' },
  ]);
  assert.match(input.value, /\[Image #1\]/);
  assert.match(input.value, /\[File #1: report\.pdf\]/);
  assert.equal($('#attachments img').getAttribute('src'), 'data:image/png;base64,AAAA');
  $('#send-btn').click();
  const message = sent.find((m) => m.type === 'user_message');
  assert.ok(message, 'the message goes');
  const text = JSON.stringify(message.payload);
  assert.match(text, /\[File #1: \/elsewhere\/report\.pdf\].*read it with read_file/, 'the whole path, for read_file');
  assert.match(text, /image_data/);
});

test('the input draws no scrollbar until it reaches its cap', (t) => {
  const { input, type } = page(t);
  assert.match(CSS, /#command-input\s*\{[^}]*overflow-y:\s*hidden/);
  type('hello');
  assert.equal(input.style.overflowY, 'hidden');
  Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 900 });
  type('a long one');
  assert.equal(input.style.overflowY, 'auto');
  assert.equal(input.style.height, '170px');
});

test('a pasted image shows while its tag is in the text, and goes with the message', (t) => {
  const { $, win, doc, type, key, sent } = page(t);
  win.eval(`pastedImages.push({ n: 1, dataUrl: 'data:image/png;base64,AAAA', mime: 'image/png', sizeKB: 1 })`);
  type('look [Image #1] ');
  assert.equal(doc.querySelectorAll('#attachments img').length, 1);
  assert.equal($('#attachments').hidden, false);

  type('look');
  assert.equal($('#attachments').hidden, true, 'its tag is gone, so the image is not going');

  type('look [Image #1] ');
  key('Enter');
  assert.equal($('#attachments').hidden, true);
  assert.equal(doc.querySelectorAll('.message-user img').length, 1, 'the sent message shows no image');
  assert.match(sent.find((m) => m.type === 'user_message').payload.content, /<image_data>/);
});

test('the thumbnail\'s × takes the tag out of the text', (t) => {
  const { $, win, input, type } = page(t);
  win.eval(`pastedImages.push({ n: 3, dataUrl: 'data:image/png;base64,AAAA', mime: 'image/png', sizeKB: 1 })`);
  type('before [Image #3] after');
  $('.attachment-remove').click();
  assert.equal(input.value, 'before after');
  assert.equal($('#attachments').hidden, true);
});

test('calls that finish out of order land on their own rows', (t) => {
  const { doc, deliver } = page(t);
  deliver('tool_call', { name: 'read_file', args: { path: 'a.js' }, verb: 'Read' });
  deliver('tool_call', { name: 'run_command', args: { command: 'ls' }, verb: 'Run' });
  deliver('tool_result', { name: 'read_file', success: false, error: 'ENOENT\nmore' });
  deliver('tool_result', { name: 'run_command', success: true, result: '\n  12 total\n' });
  const [read, run] = doc.querySelectorAll('.message-tool');
  assert.ok(read.classList.contains('tool-result-error'));
  assert.equal(read.querySelector('.tool-summary').textContent, 'ENOENT');
  assert.ok(run.classList.contains('tool-result-success'));
  assert.equal(run.querySelector('.tool-summary').textContent, '12 total');
});

test('a diff starts at its first hunk and counts what it changes', (t) => {
  const { $, deliver } = page(t);
  deliver('diff_request', {
    diffId: 'd', filePath: 'a.rb',
    patch: 'Index: a.rb\n===\n--- a.rb\n+++ a.rb\n@@ -1 +1,2 @@\n-old\n+new\n+more',
  });
  const text = $('.diff-content').textContent;
  assert.doesNotMatch(text, /Index:|\+\+\+|---/);
  assert.match(text, /@@ -1 \+1,2 @@/);
  assert.equal($('.diff-stat').textContent, '+2 −1');
});

test('a reply carries the terminal\'s dot and no emoji is left on the turn path', (t) => {
  const { $, deliver } = page(t);
  deliver('agent_response', { content: 'hello' });
  assert.equal($('.message-agent .msg-dot').textContent, '●');
  assert.doesNotMatch(JS, /[❌✅📄]/u);
});

test('the working row counts, and stops counting when it goes', (t) => {
  const { win, $ } = page(t);
  win.eval('showThinking()');
  assert.ok($('#thinking-indicator .think-meta'));
  win.eval('removeThinking()');
  assert.equal($('#thinking-indicator'), null);
});
