import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHotkeys, HOTKEYS } from '../../src/ui/hotkeys.js';

const CTRL_E = '\x05';
const CTRL_O = '\x0f';
const CTRL_T = '\x14';

test('extractHotkeys', async (t) => {
  await t.test('passes ordinary typing straight through', () => {
    const r = extractHotkeys('hello');
    assert.equal(r.text, 'hello');
    assert.deepEqual(r.hotkeys, []);
  });

  await t.test('removes a chord so the text field never sees it', () => {
    // This is the bug: ink-text-input types any key it does not recognise, so
    // a ctrl+e that reaches Ink leaves a stray "e" in the prompt.
    const r = extractHotkeys(CTRL_E);
    assert.equal(r.text, '');
    assert.deepEqual(r.hotkeys, ['expand']);
  });

  await t.test('removes a chord that arrived glued to typed text', () => {
    const r = extractHotkeys(`ab${CTRL_T}cd`);
    assert.equal(r.text, 'abcd');
    assert.deepEqual(r.hotkeys, ['terminal']);
  });

  await t.test('reports several chords in order', () => {
    // ctrl+o was the agent/GitHub tab switch and went with the GitHub agent.
    // ctrl+t is the other two-chord case and exercises the same ordering.
    const r = extractHotkeys(`\x14x${CTRL_E}`);
    assert.equal(r.text, 'x');
    assert.deepEqual(r.hotkeys, ['terminal', 'expand']);
  });

  // v5.4: ctrl+c is ours. Ink's handler unmounted the app and left the
  // process alive behind a frozen prompt (measured under the pty).
  await t.test('takes ctrl+c as interrupt, so Ink never sees it', () => {
    const r = extractHotkeys('\x03');
    assert.equal(r.text, '');
    assert.deepEqual(r.hotkeys, ['interrupt']);
  });

  await t.test('but a pasted 0x03 is text, not an exit', () => {
    const r = extractHotkeys('\x1b[200~a\x03b\x1b[201~');
    assert.deepEqual(r.hotkeys, []);
  });

  await t.test('never strips inside a bracketed paste', () => {
    // A pasted file can legitimately contain 0x05; removing it would corrupt
    // the paste and fire a phantom shortcut.
    const paste = `\x1b[200~before${CTRL_E}after\x1b[201~`;
    const r = extractHotkeys(paste);
    assert.equal(r.text, paste);
    assert.deepEqual(r.hotkeys, []);
  });

  await t.test('keeps paste state across chunks', () => {
    const a = extractHotkeys(`\x1b[200~line one${CTRL_E}`);
    assert.equal(a.state.inPaste, true);
    assert.deepEqual(a.hotkeys, []);
    assert.equal(a.text, `\x1b[200~line one${CTRL_E}`);

    const b = extractHotkeys(`still pasting${CTRL_O}\x1b[201~${CTRL_T}`, a.state);
    assert.equal(b.state.inPaste, false);
    assert.deepEqual(b.hotkeys, ['terminal']);
    assert.equal(b.text, `still pasting${CTRL_O}\x1b[201~`);
  });

  await t.test('every mapped chord is a single control byte', () => {
    for (const key of Object.keys(HOTKEYS)) {
      assert.equal(key.length, 1);
      assert.ok(key.charCodeAt(0) < 32, `${JSON.stringify(key)} is not a control byte`);
    }
  });
});

/*
 * ctrl+b brings the Gemini tab to the front.
 *
 * Three moments need that tab and all three meant hunting through windows: the
 * model picker after `/effort`, a stalled turn, and the "make sure the Chrome
 * tab is not minimised" case. A chord is the cheapest possible answer.
 */
test('ctrl+b is a hotkey and does not reach the prompt', () => {
  const r = extractHotkeys('\x02');
  assert.deepEqual(r.hotkeys, ['focus-browser']);
  assert.equal(r.text, '', 'the chord would have been typed into the input');
});

// Every chord must be distinct, or one of them silently shadows another —
// `ink-text-input` types anything this does not claim.
test('no two hotkeys share a byte', () => {
  const bytes = Object.keys(HOTKEYS);
  assert.equal(new Set(bytes).size, bytes.length);
});

test('interruptGate: two presses inside the window exit, one does not', async () => {
  const { interruptGate, EXIT_WINDOW_MS } = await import('../../src/ui/hotkeys.js');
  const gate = interruptGate();
  assert.equal(gate(1000), 'first');
  assert.equal(gate(1000 + EXIT_WINDOW_MS - 1), 'exit');

  const slow = interruptGate();
  assert.equal(slow(1000), 'first');
  assert.equal(slow(1000 + EXIT_WINDOW_MS), 'first', 'a press after the window starts over');
  assert.equal(slow(1000 + EXIT_WINDOW_MS + 10), 'exit');
});

/*
 * Reported from use: ctrl+g opened Chrome's Gemini panel instead of the task
 * list. Chrome registers Ctrl+G system-wide on macOS, so the terminal never
 * saw it. A chord another app owns globally is not ours to bind.
 */
test('the task list is on ctrl+o, and nothing is bound to ctrl+g', async () => {
  const { HOTKEYS } = await import('../../src/ui/hotkeys.js');
  assert.equal(HOTKEYS['\x0f'], 'artifacts');
  assert.equal(HOTKEYS['\x07'], undefined);
});
