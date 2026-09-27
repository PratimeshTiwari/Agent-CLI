/**
 * A stalled turn has to reach the screen, or the spinner outlives it.
 *
 * `_onExtensionStall` fires seven minutes after a prompt the extension never
 * answers. It clears `isProcessing` **on the loop** and reports why by sending
 * `type: 'error'` through the callbacks — and the CLI's `sendToPanel` had no
 * `error` arm, so that message was delivered to a handler that ignored it.
 *
 * React's `isProcessing` is a separate piece of state, set by the function that
 * submits, so nothing cleared it. The spinner ran on with no turn behind it:
 * reported from use at **25,742 seconds** — seven hours — with `esc` the only
 * way out.
 *
 * CLAUDE.md states the rule about the side panel, and it was true of the CLI:
 * *a surface that ignores an unknown message type is not equally harmless for
 * every type. Dropping a notification costs a missing line; dropping a request
 * deadlocks whatever is waiting on the answer.* This one is worse than a
 * notification — it is the end of the turn.
 *
 * Asserted against the source because reproducing it needs a seven-minute wait
 * inside a live React tree, and because the failure is an **absence**: an arm
 * that is not there cannot be observed by calling the thing that has it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const callbacks = readFileSync(
  new URL('../../src/ui/hooks/use-agent-callbacks.js', import.meta.url), 'utf8',
);
const app = readFileSync(new URL('../../src/ui/App.jsx', import.meta.url), 'utf8');
const bar = readFileSync(
  new URL('../../src/ui/components/InputBar.jsx', import.meta.url), 'utf8',
);
const loop = readFileSync(
  new URL('../../src/core/agent-loop.js', import.meta.url), 'utf8',
);

/** The body of the `error` arm in the CLI's `sendToPanel`. */
const errorArm = (() => {
  const start = callbacks.indexOf("msg.type === 'error'");
  assert.ok(start > -1, 'the CLI ignores `error`, so a stalled turn never ends on screen');
  return callbacks.slice(start, callbacks.indexOf('} else if', start));
})();

test('the CLI handles the message that ends a stalled turn', () => {
  assert.match(errorArm, /setIsProcessing\(false\)/,
    'the spinner keeps running after the loop has given up on the turn');
});

test('and clears the tool rows with it', () => {
  // Left behind, they describe a turn that is over as though it were live.
  assert.match(errorArm, /setActiveToolCalls\(\[\]\)/);
  assert.match(errorArm, /isToolRunningRef\.current = false/);
});

test('and says what happened, rather than going quiet', () => {
  assert.match(errorArm, /setHistory/,
    'the turn ends with no explanation, which reads as the agent giving up silently');
  assert.match(errorArm, /msg\.payload\?\.message/,
    'it discards the reason the loop went to the trouble of sending');
});

/*
 * The backstop this depends on. If it stops being armed, the arm above is
 * never reached and the hang returns — with the `error` handler making it look
 * covered.
 */
test('the loop still reports a stall, and still ends the turn itself', () => {
  // The method, not the `onStall:` line that wires it — that one comes first
  // in the file and matched, which is how the first draft of this test failed
  // against perfectly correct code.
  const stall = loop.slice(loop.indexOf('\n  _onExtensionStall(lane, model) {'));
  const body = stall.slice(0, stall.indexOf('\n  }'));
  assert.match(body, /this\.isProcessing = false/);
  assert.match(body, /type: 'error'/,
    'the stall no longer sends the message the UI now listens for');
});

/**
 * And the row that tells you how to get out.
 *
 * Asked for directly: *"if the load is longer than 5 minutes and it does not
 * stop, show the message with the stop command."*
 */
test('the waiting hint escalates before the backstop would fire', () => {
  const ms = Number(/setIsThinkingStuck\(true\), (\d+) \* 60_000\)/.exec(app)[1]) * 60_000;
  assert.ok(ms >= 60_000, `${ms}ms — it would fire during ordinary turns`);
  assert.ok(ms < 7 * 60_000,
    `${ms}ms — the seven-minute backstop ends the turn first, so this would never show`);
});

test('and the escalated row names a way out', () => {
  const row = bar.slice(bar.indexOf('isThinkingStuck ?'), bar.indexOf('isThinkingTooLong &&'));
  assert.match(row, /esc/, 'it does not say how to take the turn back');
  assert.match(row, /:stop/);
});

/*
 * One row, not two. The live frame budgets this line, and CLAUDE.md is blunt
 * about what an extra row costs: a frame taller than the viewport is the
 * clear-and-repaint path, which is the flicker bug entire.
 */
test('the two hints never draw at once', () => {
  const row = bar.slice(bar.indexOf('isThinkingStuck ?'), bar.indexOf('</Box>', bar.indexOf('isThinkingStuck ?')));
  assert.ok(!/isThinkingTooLong &&[\s\S]*isThinkingStuck &&/.test(row),
    'both hints can render together, which costs a row the frame did not budget');
  assert.match(app, /isThinkingTooLong \|\| isThinkingStuck \? 1 : 0/,
    'the reserved-row count does not know about the second hint');
});
