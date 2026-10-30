/*
 * The tab's half of #104 (v6.6): the inject carries `sentAt` and the server's
 * `gap`; the trace gains `deliver`, `round_work`, `round_wait` and the prompt
 * length. The function is lifted out of the bridge and run as written.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../content-scripts/gemini-bridge.js', import.meta.url), 'utf8');

function lift() {
  const at = src.indexOf('const foldDeliveryIntoTrace = ');
  const end = src.indexOf('\n};', at) + 3;
  const state = { turnTrace: { stages: {} } };
  const fn = new Function('state', `let turnTrace = state.turnTrace;\n${src.slice(at, end)}\nreturn foldDeliveryIntoTrace;`)(state);
  return { fold: fn, trace: state.turnTrace };
}

test('deliver is send → received; the server\'s split is copied; the length is kept', () => {
  const { fold, trace } = lift();
  fold({ sentAt: 1_000, receivedAt: 1_840, gap: { work: 120, wait: 9_000 } }, 'x'.repeat(42));
  assert.deepEqual(trace.stages, { deliver: 840, round_work: 120, round_wait: 9_000 });
  assert.equal(trace.chars, 42);
});

test('a first send has no gap, and a clock jump is not a measurement', () => {
  const { fold, trace } = lift();
  fold({ sentAt: 5_000, receivedAt: 1_000 }, 'hi');
  assert.deepEqual(trace.stages, {}, 'negative deliver dropped, no gap given');
  fold({ sentAt: 0, receivedAt: 900_000 }, 'hi');
  assert.deepEqual(trace.stages, {}, 'fifteen minutes is a clock, not a delivery');
});

test('the inject handler records the stamps, and the trace sends the length', () => {
  assert.match(src, /sentAt: payload\.sentAt,\s*receivedAt: Date\.now\(\),\s*gap: payload\.gap,/);
  assert.match(src, /foldDeliveryIntoTrace\(currentRequestData, text\);/);
  assert.match(src, /stages: turnTrace\.stages, chars: turnTrace\.chars/);
});
