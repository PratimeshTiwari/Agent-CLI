import test from 'node:test';
import assert from 'node:assert/strict';
import { easeCount, streamTokens, formatTokens } from '../../../src/frontend/transcript/token-count.js';

test('the count climbs toward its target over ticks, never past it', () => {
  let shown = 1000;
  const seen = [];
  for (let i = 0; i < 25; i += 1) { shown = easeCount(shown, 3000); seen.push(shown); }
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'never goes back');
  assert.ok(seen[0] < 1200, `the first tick is a small step, got ${seen[0]}`);
  assert.ok(shown > 2700 && shown <= 3000, `most of the way in 2 s, got ${shown}`);
  for (let i = 0; i < 200; i += 1) shown = easeCount(shown, 3000);
  assert.equal(shown, 3000, 'and lands exactly');
});

test('a fall is drawn at once, and a first draw starts at the target', () => {
  assert.equal(easeCount(5000, 1200), 1200);
  assert.equal(easeCount(undefined, 800), 800);
  assert.equal(easeCount(799, 800), 800);
});

test('a streamed reply counts only until the loop has added it', () => {
  assert.equal(streamTokens({ chars: 400, base: 1000 }, 1000), 100);
  assert.equal(streamTokens({ chars: 400, base: 1000 }, 1400), 0, 'the reply landed: counted by the loop');
  assert.equal(streamTokens(null, 1000), 0);
});

test('formatted as the spinner always wrote it', () => {
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(29_400), '29.4k');
});
