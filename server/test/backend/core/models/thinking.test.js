/**
 * Thinking level (v9.9.3). Shapes from the live picker, 2026-11-08: Low,
 * Medium, High on every model; `level: true` from extension 1.65.0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  thinkingLevels, currentThinking, wantedThinking, thinkingStops, normaliseThinkingSetting,
} from '../../../../src/backend/core/models/thinking.js';

const model = (label, extra = {}) => ({ label, isMode: false, ...extra });
const level = (label, extra = {}) => ({ label, isMode: true, level: true, ...extra });
const MAIN = [
  model('3.5 Flash-Lite', { selected: true }), model('3.8 Flash'), model('3.1 Pro'), model('4 Argon'),
  { label: 'Thinking level', isMode: true, submenu: true },
  level('Low', { selected: true }), level('Medium'), level('High'),
];

test('same as effort: low → the lightest, medium → the middle, high and max → the heaviest', () => {
  const want = (rung) => wantedThinking({ rung, setting: 'same', options: MAIN }).level;
  assert.deepEqual(['low', 'medium', 'high', 'max'].map(want), ['Low', 'Medium', 'High', 'High']);
  assert.equal(wantedThinking({ rung: 'high', setting: undefined, options: MAIN }).level, 'High', 'unset is same');
});

test('a pinned level holds whatever the effort', () => {
  for (const rung of ['low', 'high', 'max']) {
    assert.equal(wantedThinking({ rung, setting: 'medium', options: MAIN }).level, 'Medium');
  }
});

test('no levels on the account: nothing is asked and the row has no stops', () => {
  const noLevels = MAIN.filter((m) => !m.isMode);
  assert.deepEqual(wantedThinking({ rung: 'high', setting: 'same', options: noLevels }), { level: null, reason: 'none' });
  assert.deepEqual(thinkingStops(noLevels), [], 'the Thinking row is not drawn at all');
  // An extension older than 1.65.0 reports levels as modes without `level`: treated as none.
  const old = MAIN.map(({ level: _l, ...m }) => m);
  assert.deepEqual(thinkingStops(old), []);
});

test('a locked level is never asked for, and same steps down past it', () => {
  const locked = MAIN.map((m) => (m.label === 'High' ? { ...m, locked: true } : m));
  assert.equal(wantedThinking({ rung: 'max', setting: 'same', options: locked }).level, 'Medium');
  assert.deepEqual(wantedThinking({ rung: 'low', setting: 'high', options: locked }), { level: null, reason: 'locked' });
  assert.equal(thinkingStops(locked).find((s) => s.id === 'high').locked, true);
});

test('the stops, the current level, and the words a setting may be', () => {
  assert.deepEqual(thinkingStops(MAIN).map((s) => s.id), ['same', 'low', 'medium', 'high']);
  assert.equal(currentThinking(MAIN), 'Low');
  assert.deepEqual(thinkingLevels(MAIN).map((l) => l.label), ['Low', 'Medium', 'High'], 'the row itself is not a level');
  for (const w of ['', 'same', 'Same as effort', 'auto']) assert.equal(normaliseThinkingSetting(w), 'same');
  assert.equal(normaliseThinkingSetting(' High '), 'high');
});
