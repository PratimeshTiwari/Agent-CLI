/**
 * The panel's buttons work under an extension page's CSP.
 *
 * MV3's default CSP for extension pages is `script-src 'self'`, which refuses
 * inline handlers. `appendDiff` wrote `onclick="respondToDiff(…)"`, so Accept
 * and Reject did nothing and a turn parked on a diff could not be answered
 * from the panel. jsdom does not run inline handlers either (no `runScripts`),
 * which makes it an honest model of the CSP here: the old markup fails these.
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

function panel() {
  const dom = new JSDOM('<body><div id="stream"></div></body>');
  const calls = [];
  const window = { respondToDiff: (id, action) => calls.push([id, action]) };
  const sandbox = {
    document: dom.window.document,
    messageStream: dom.window.document.getElementById('stream'),
    scrollToBottom() {},
    window,
  };
  const body = `${['escapeHtml', 'appendDiff', 'appendToolCall'].map(take).join('\n')}
    return { appendDiff, appendToolCall };`;
  const api = new Function(...Object.keys(sandbox), body)(...Object.values(sandbox));
  return { api, dom, calls };
}

test('Accept and Reject answer the diff', () => {
  const { api, dom, calls } = panel();
  api.appendDiff({ diffId: 'd1', filePath: 'a.js', patch: '+x' });
  dom.window.document.querySelector('.diff-btn.accept').click();
  dom.window.document.querySelector('.diff-btn.reject').click();
  assert.deepEqual(calls, [['d1', 'accept'], ['d1', 'reject']]);
});

test('a tool row expands on click', () => {
  const { api, dom } = panel();
  api.appendToolCall('read_file', { path: 'a.js' });
  const details = dom.window.document.querySelector('.tool-details');
  assert.equal(details.classList.contains('expanded'), false);
  dom.window.document.querySelector('.tool-header').click();
  assert.equal(details.classList.contains('expanded'), true);
});

test('no inline handler attributes are written anywhere in the panel', () => {
  // Comments may mention them; markup may not.
  const markup = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.doesNotMatch(markup, /\son(click|change|input|keydown)\s*=\s*["']/);
});
