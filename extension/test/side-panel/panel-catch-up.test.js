/**
 * The panels catch up with the terminal (1.59.0): a message typed during a
 * turn queues, a stop stops, the footer says what the status bar says, and a
 * reply's tables, lists and headings render as such.
 *
 * The queue had a fault the first draft shipped with: `sendMessage` still
 * returned early while a turn ran, so the queue below that line was never
 * reached and the message vanished from the box. The first test is that case.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const PANEL = resolve(dirname(fileURLToPath(import.meta.url)), '../../side-panel/panel.js');
const src = readFileSync(PANEL, 'utf8');

function take(name) {
  const from = src.indexOf(`function ${name}(`);
  if (from === -1) throw new Error(`${name} not found`);
  let depth = 0;
  for (let i = src.indexOf('{', from); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error(`${name} never closed`);
}

/** sendMessage, dispatchMessage, drainQueue and stopTurn over a fake page. */
function panel() {
  const dom = new JSDOM('<body><div id="stream"></div><textarea id="in"></textarea><button id="send"></button></body>');
  const doc = dom.window.document;
  const sent = [];
  const statuses = [];
  const env = {
    document: doc,
    messageStream: doc.getElementById('stream'),
    commandInput: doc.getElementById('in'),
    sendBtn: doc.getElementById('send'),
    chrome: { runtime: { sendMessage: (m) => sent.push(m) } },
    appendMessage: (role, text) => {
      const d = doc.createElement('div');
      d.className = `message message-${role}`;
      d.textContent = text;
      doc.getElementById('stream').appendChild(d);
    },
    appendStatus: (t) => statuses.push(t),
    imageBlock: () => ({ used: [], block: '' }),
    fileBlock: () => ({ used: [], block: '' }),
    showThinking() {}, removeThinking() {}, clearStreamPartial() {}, scrollToBottom() {},
    markOrphaned() {}, explainDisconnected() {}, handleSlashCommand() {},
  };
  const body = `
    let isWaitingForResponse = false, orphaned = false, isConnected = true, welcomeMessage = null;
    let pastedImages = [], droppedFiles = [], ownSends = [], queuedSends = [];
    ${['reflectSendState', 'sendMessage', 'dispatchMessage', 'drainQueue', 'stopTurn'].map(take).join('\n')}
    return {
      reflectSendState, sendMessage, drainQueue, stopTurn,
      busy: () => isWaitingForResponse, setBusy: (b) => { isWaitingForResponse = b; },
      queued: () => queuedSends.length,
    };`;
  const api = new Function(...Object.keys(env), body)(...Object.values(env));
  const type = (t) => { env.commandInput.value = t; api.sendMessage(); };
  return { api, env, sent, statuses, type, doc };
}

test('a message typed during a turn queues, then goes when the turn ends', () => {
  const { api, sent, type, doc } = panel();
  type('first');
  assert.deepEqual(sent.map((m) => m.payload?.content), ['first']);
  assert.equal(api.busy(), true);

  type('second');
  assert.equal(sent.length, 1, 'sent into a running turn');
  assert.equal(api.queued(), 1, 'the message was dropped, not queued');
  assert.equal(doc.querySelectorAll('.message-user.queued').length, 1);

  api.setBusy(false);
  api.drainQueue();
  assert.deepEqual(sent.map((m) => m.payload?.content), ['first', 'second']);
  assert.equal(doc.querySelectorAll('.queued').length, 0);
});

test('stop sends stop_turn and drops the queue', () => {
  const { api, sent, type, statuses, doc } = panel();
  type('first');
  type('second');
  api.stopTurn();
  assert.equal(sent.at(-1).type, 'stop_turn');
  assert.equal(api.queued(), 0);
  assert.equal(api.busy(), false);
  assert.equal(doc.querySelectorAll('.message-user').length, 1, 'the queued bubble outlived the stop');
  assert.ok(statuses.includes('Interrupted'));
  // Control: nothing is left to drain after a stop.
  api.drainQueue();
  assert.equal(sent.filter((m) => m.type === 'user_message').length, 1);
});

test('the send button is a stop only while a turn runs with nothing typed', () => {
  const { api, env, type } = panel();
  api.reflectSendState();
  assert.equal(env.sendBtn.classList.contains('stop'), false);
  type('go');
  assert.equal(env.sendBtn.classList.contains('stop'), true);
  env.commandInput.value = 'more';
  api.reflectSendState();
  assert.equal(env.sendBtn.classList.contains('stop'), false, 'typed text queues, so it is a send');
});

test('the footer line names effort, model and fill, and skips what is unknown', () => {
  const panelStateLine = new Function(`${take('panelStateLine')}; return panelStateLine;`)();
  assert.equal(panelStateLine({ effort: 'high', model: '3.1 Pro', contextPct: 14 }), 'high · 3.1 Pro · 14% context');
  assert.equal(panelStateLine({ effort: 'low', model: null, contextPct: null }), 'low');
  assert.equal(panelStateLine(null), '');
});

test('a reply renders tables, lists, headings and links', () => {
  const dom = new JSDOM('');
  const render = new Function('document', `${take('escapeHtml')}\n${take('renderMarkdownish')}; return renderMarkdownish;`)(dom.window.document);
  const html = render([
    '## Plan',
    '',
    '- one **bold**',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    'See [the docs](https://example.com) and `x < y`.',
  ].join('\n'));
  const div = dom.window.document.createElement('div');
  div.innerHTML = html;
  assert.ok(div.querySelector('h2, .md-h2'), html);
  assert.equal(div.querySelectorAll('ul li').length, 2);
  assert.equal(div.querySelectorAll('ol li').length, 2);
  assert.equal(div.querySelectorAll('table td').length, 2);
  assert.equal(div.querySelector('a').getAttribute('href'), 'https://example.com');
  assert.ok(div.querySelector('strong'));
  assert.equal(div.querySelector('code').textContent, 'x < y');
});

test('a reply cannot inject markup', () => {
  const dom = new JSDOM('');
  const render = new Function('document', `${take('escapeHtml')}\n${take('renderMarkdownish')}; return renderMarkdownish;`)(dom.window.document);
  const div = dom.window.document.createElement('div');
  div.innerHTML = render('<img src=x onerror=alert(1)> [x](javascript:alert(1)) | <b> | c |\n| - | - |\n| <i> | d |');
  assert.equal(div.querySelector('img'), null);
  assert.equal(div.querySelector('i'), null);
  for (const a of div.querySelectorAll('a')) assert.match(a.getAttribute('href'), /^https?:/);
});
