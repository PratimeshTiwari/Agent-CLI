/**
 * A reply's own finished row ends the wait (#104). Read live 2026-11-08: the
 * copy and feedback row under a reply lands ~0.6 s after its last text and
 * ~1.2 s after the Stop button goes; the quiet rule waited ~2 s past the text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadFunction } from '../load-content-script.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../content-scripts/gemini-bridge.js');
const reply = (text, done) => `<model-response><message-content>${text}</message-content>${
  done ? '<message-actions><copy-button><button aria-label="Copy response"></button></copy-button></message-actions>' : ''}</model-response>`;

function on(html, { before = 'first' } = {}) {
  const { document } = new JSDOM(`<body>${html}</body>`).window;
  const lastModelResponse = loadFunction(SCRIPT, 'lastModelResponse', { document });
  const all = document.querySelectorAll('model-response');
  const initialLastReply = before === 'first' ? all[0] : null;
  return loadFunction(SCRIPT, 'replyMarkedFinished', { lastModelResponse, initialLastReply });
}

test('the new reply with its row is finished; without it, not yet', () => {
  assert.equal(on(reply('old', true) + reply('new', true))(), true);
  assert.equal(on(reply('old', true) + reply('still writing', false))(), false);
});

test('negative control: the previous reply\'s row never ends this turn', () => {
  // Before the new block exists, the newest block is the old one, row and all.
  assert.equal(on(reply('old', true))(), false, 'the last turn\'s footer would end this turn at once');
});

test('the check takes the row only after the text has been still, and the observer wakes it (source)', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /silenceDuration >= FINISHED_ROW_QUIET_MS && replyMarkedFinished\(\)/);
  assert.match(src, /initialLastReply = lastModelResponse\(\);/);
  assert.match(src, /replyMarkedFinished\(\)\) \{\s*queueMicrotask\(\(\) => completionCheck\?\.\(\)\);/);
});
