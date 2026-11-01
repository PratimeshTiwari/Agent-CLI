/**
 * Exit erases back to the shell line that launched the agent — only when it
 * knows exactly where that is.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScreenSpan, rewindSequence, CURSOR_REPORT, enterSequence } from '../../../src/frontend/screen/screen-span.js';
import { exitText, exitWithFarewell, registerInk, registerScreen, _resetFarewell, CLEAR_SCREEN } from '../../../src/frontend/screen/farewell.js';
import { SessionStore } from '../../../src/backend/storage/session-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));

test('a session that fits rewinds to the row it began on', () => {
  const span = createScreenSpan({ rows: 24 });
  span.feed('header\r\nline\r\n'); // written before the terminal answered: buffered
  span.start(5);
  span.feed('more\r\nlive frame\r\nrow\r\n');
  span.feed('\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G'); // Ink erasing two rows of live frame
  assert.deepEqual(span.peek(), { row: 8, top: 5, lost: false, height: 24 });
  assert.equal(span.rewindTo(8), 5);
});

test('scrolling moves the start up, and past the top it is gone', () => {
  const span = createScreenSpan({ rows: 10 });
  span.start(8);
  span.feed('a\nb\nc\n'); // rows 8→10, then one scroll
  assert.equal(span.peek().top, 7);
  assert.equal(span.rewindTo(10), 7);
  span.feed('\n'.repeat(7));
  assert.equal(span.rewindTo(10), null, 'the launch line is in the scrollback by now');
});

test('a clear of our own, or a terminal that disagrees, means clear instead', () => {
  const cleared = createScreenSpan({ rows: 24 });
  cleared.start(3);
  cleared.feed('\x1b[2J\x1b[3J\x1b[H');
  assert.equal(cleared.rewindTo(1), null, 'ctrl+e reprinted the transcript over the shell line');

  const off = createScreenSpan({ rows: 24 });
  off.start(3);
  off.feed('x\r\n');
  assert.equal(off.rewindTo(5), null, 'a wrap we could not see — never erase what we did not write');
  assert.equal(off.rewindTo(null), null, 'no answer from the terminal');
  assert.equal(createScreenSpan({ rows: 24 }).rewindTo(1), null, 'never answered at startup');
});

test('colours, private modes and OSC do not move rows', () => {
  const span = createScreenSpan({ rows: 24 });
  span.start(2);
  span.feed('\x1b[?2026h\x1b[38;2;1;2;3mhi\x1b[39m\x1b]0;title\x07\x1b[?25l\x1b[?2026l');
  assert.equal(span.peek().row, 2);
});

test('the report is recognised and the rewind is an absolute move plus erase-down', () => {
  assert.equal('\x1b[12;1R'.match(CURSOR_REPORT)[1], '12');
  assert.equal(rewindSequence(7), '\x1b[7;1H\x1b[J');
});

test('exit: back to the launch line, a blank row, the footer — or nothing at all', () => {
  const store = new SessionStore(mkdtempSync(join(tmpdir(), 'span-')));
  store.appendTurn({ role: 'user', content: 'hi', timestamp: Date.now() });
  const text = exitText({ sessionStore: store }, { isTTY: true }, { rewindTo: 4 });
  assert.match(text, /^\x1b\[4;1H\x1b\[J\n\x1b\[2mResume this session with:/);
  assert.equal(exitText({ sessionStore: new SessionStore(mkdtempSync(join(tmpdir(), 'span-'))) }, { isTTY: true }, { rewindTo: 4 }),
    '\x1b[4;1H\x1b[J');
  assert.ok(exitText({ sessionStore: store }, { isTTY: true }).startsWith(CLEAR_SCREEN), 'unknown: clear');
});

test('exit asks the row before unmounting, while raw mode still hides the answer', async () => {
  _resetFarewell();
  const order = [];
  registerInk({ clear: () => order.push('clear'), unmount: () => order.push('unmount') });
  const span = createScreenSpan({ rows: 24 });
  span.start(3);
  registerScreen({ span, askRow: async () => { order.push('ask'); return 3; } });
  const written = [];
  await exitWithFarewell({ agentLoop: {}, out: { isTTY: true, write: (s) => written.push(s) }, exit: () => {} });
  assert.deepEqual(order, ['clear', 'ask', 'unmount']);
  assert.deepEqual(written, ['\x1b[3;1H\x1b[J']);
  _resetFarewell();
});

test('startup no longer clears the screen — the launch line is what exit returns to', () => {
  const src = readFileSync(join(here, '../../../src/frontend/cli-ui.jsx'), 'utf8');
  assert.doesNotMatch(src, /console\.clear\(\)\s*;/);
});

test('enterSequence', async (t) => {
  await t.test('scrolls the screen into the scrollback, one newline per row', () => {
    assert.equal(enterSequence({ rows: 5, env: {} }), '\n\n\n\n\n\x1b[H');
  });
  await t.test('erases in place in VS Code, where a scrolled-off command line is pinned over the header', () => {
    const seq = enterSequence({ rows: 30, env: { TERM_PROGRAM: 'vscode' } });
    assert.equal(seq, '\x1b[H\x1b[J');
    assert.ok(!seq.includes('\n'), 'any newline here can scroll the command line off screen');
  });
});
