/**
 * Ink 7.1.1's kitty probe re-delivers keys typed in its first 200 ms; the
 * hold delivers them once, after it. See `src/ui/ink-probe-hold.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProbeHold } from '../../src/ui/ink-probe-hold.js';

const clock = () => {
  let t = 1000;
  const timers = [];
  return {
    now: () => t,
    later: (fn, ms) => { timers.push({ at: t + ms, fn }); return {}; },
    advance(ms) { t += ms; for (const x of timers.splice(0)) if (x.at <= t) x.fn(); else timers.push(x); },
  };
};

test('a key in the window is held and delivered once, in order, after it', () => {
  const c = clock();
  const got = [];
  const hold = createProbeHold({ deliver: (x) => got.push(x), now: c.now, later: c.later, windowMs: 300 });
  hold.start();
  hold.accept('\x1b[1;1R/');
  hold.accept('he');
  assert.deepEqual(got, [], 'nothing reaches Ink while its probe is listening');
  c.advance(300);
  assert.deepEqual(got, ['\x1b[1;1R/', 'he']);
  hold.accept('lp');
  assert.deepEqual(got, ['\x1b[1;1R/', 'he', 'lp'], 'after the window, straight through');
});

test('the terminal\'s reply to the probe is never held, or the protocol never turns on', () => {
  const c = clock();
  const got = [];
  const hold = createProbeHold({ deliver: (x) => got.push(x), now: c.now, later: c.later });
  hold.start();
  hold.accept('\x1b[?0ux');
  assert.deepEqual(got, ['\x1b[?0u']);
  c.advance(400);
  assert.deepEqual(got, ['\x1b[?0u', 'x']);
});

test('before start, and long after, nothing is held', () => {
  const got = [];
  const hold = createProbeHold({ deliver: (x) => got.push(x), now: () => 0, later: () => assert.fail('no timer') });
  hold.accept('a');
  assert.deepEqual(got, ['a']);
});

test('cli-ui opens the window right before render, and stdin goes through it', () => {
  const src = readFileSync(new URL('../../src/ui/cli-ui.jsx', import.meta.url), 'utf8');
  // Through the drop joiner (v6.25), which delivers to the hold.
  assert.match(src, /createDropJoiner\(\{ deliver: \(raw\) => probeHold\.accept\(raw\) \}\)/);
  assert.match(src, /process\.stdin\.on\('data', \(raw\) => dropJoiner\.accept\(raw\)\)/);
  assert.match(src, /probeHold\.start\(\);\n\s*const instance = render\(/);
  assert.match(src, /kittyKeyboard: \{ mode: 'auto'/, 'without the probe the hold is a 300 ms delay for nothing');
});
