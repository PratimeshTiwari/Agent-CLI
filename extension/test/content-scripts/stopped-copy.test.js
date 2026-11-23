/**
 * A stopped copy of the bridge answers nothing (1.72.0).
 *
 * Found in tabrig on 2026-11-23: one prompt was typed and sent **twice** into
 * a tab that had two copies of this script — the one Chrome loads with the page
 * and the one the worker injects into every Gemini tab when it starts
 * (`reinjectModelTabs`). The new copy stops the old one (`__agentBridgeStop`),
 * which stopped its timers and observers but not its message listener: with
 * the extension still alive (a worker restart, not a reload), both answered
 * every message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(new URL('../../content-scripts/gemini-bridge.js', import.meta.url), 'utf8');

function page() {
  const dom = new JSDOM('<!doctype html><body><rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea></body>',
    { url: 'https://gemini.google.com/app', runScripts: 'outside-only', pretendToBeVisual: true });
  const listeners = [];
  dom.window.chrome = {
    runtime: {
      id: 'ext',
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: () => Promise.resolve(undefined),
      getURL: (p) => p,
    },
    storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } },
  };
  return { dom, listeners };
}

function answers(listener) {
  let said = null;
  listener({ type: 'ping' }, {}, (r) => { said = r; });
  return said;
}

test('two copies in one tab: only the newer one answers', (t) => {
  const { dom, listeners } = page();
  t.after(() => dom.window.close()); // its timers would hold the run open
  dom.window.eval(SRC);
  dom.window.eval(SRC);
  assert.equal(listeners.length, 2, 'both copies loaded');
  assert.equal(answers(listeners[0]), null, 'the stopped copy still answers, so a prompt is typed twice');
  assert.ok(answers(listeners[1])?.ready !== undefined, 'the live copy is silent');
});
