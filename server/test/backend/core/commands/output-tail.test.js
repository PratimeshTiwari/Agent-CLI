import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutputTail, cleanLine } from '../../../../src/backend/core/commands/output-tail.js';

/** A clock and a timer queue the test advances by hand. */
function fakeClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; },
    clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    advance(ms) {
      t += ms;
      for (const h of timers.filter((x) => x.at <= t)) { timers.splice(timers.indexOf(h), 1); h.fn(); }
    },
    pending: () => timers.length,
  };
}

test('chunks are not lines: a partial line is shown and replaced when it completes', () => {
  const tail = createOutputTail({ emit: () => {}, keep: 5 });
  tail.push('one\ntw');
  assert.deepEqual(tail.peek(), { lines: ['one', 'tw'], total: 2 });
  tail.push('o\nthree\n');
  assert.deepEqual(tail.peek(), { lines: ['one', 'two', 'three'], total: 3 });
});

test('only the last `keep` lines are kept, and total counts every one', () => {
  const tail = createOutputTail({ emit: () => {}, keep: 3 });
  tail.push(Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n');
  assert.deepEqual(tail.peek(), { lines: ['line 37', 'line 38', 'line 39'], total: 40 });
});

test('a progress bar redrawn with \\r shows only what a terminal would', () => {
  const tail = createOutputTail({ emit: () => {} });
  tail.push('installing\n[#   ] 10%\r[##  ] 50%\r[####] 100%');
  assert.deepEqual(tail.peek().lines, ['installing', '[####] 100%']);
  // CRLF output is not a rewrite to an empty line.
  assert.equal(cleanLine('done\r'), 'done');
  const crlf = createOutputTail({ emit: () => {} });
  crlf.push('a\r\nb\r\n');
  assert.deepEqual(crlf.peek().lines, ['a', 'b']);
});

test('escapes, tabs and control bytes never reach the screen', () => {
  assert.equal(cleanLine('\x1b[1;32mPASS\x1b[0m\tsrc/a.test.js\x07  '), 'PASS  src/a.test.js');
});

test('throttled: leading edge at once, trailing edge for the rest, nothing after stop', () => {
  const clock = fakeClock();
  const seen = [];
  const tail = createOutputTail({ emit: (v) => seen.push(v.lines.at(-1)), everyMs: 250, ...clock });

  tail.push('a\n');
  assert.deepEqual(seen, ['a'], 'the first line appears immediately');
  tail.push('b\n'); tail.push('c\n');
  assert.deepEqual(seen, ['a'], 'a burst inside the window waits');
  clock.advance(250);
  assert.deepEqual(seen, ['a', 'c'], 'and the last of it is shown when the window closes');

  tail.push('d\n');
  assert.equal(clock.pending(), 1);
  tail.stop();
  assert.equal(clock.pending(), 0, 'stop cancels the pending emit');
  tail.push('e\n');
  clock.advance(1000);
  assert.deepEqual(seen, ['a', 'c'], 'and nothing is emitted after the command ends');
});

test('an emit that throws does not break the stream', () => {
  const tail = createOutputTail({ emit: () => { throw new Error('render'); } });
  assert.doesNotThrow(() => tail.push('x\n'));
});
