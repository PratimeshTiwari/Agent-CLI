/** Ask, auto or block (v9.1). Every row of the owner's table. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpDecision, nextSwitch, setSwitch, switchFor } from '../../../../src/backend/mcp/client/switches.js';

test('the table', () => {
  const table = {
    ask: { plan: 'ask', auto: 'ask', strict: 'ask' },
    auto: { plan: 'run', auto: 'run', strict: 'ask' },
    block: { plan: 'refuse', auto: 'refuse', strict: 'refuse' },
  };
  for (const [value, row] of Object.entries(table)) {
    for (const [mode, want] of Object.entries(row)) assert.equal(mcpDecision(value, mode), want, `${value} in ${mode}`);
  }
});

test('anything unknown asks', () => {
  assert.equal(mcpDecision('auto', undefined), 'ask', 'no mode');
  assert.equal(mcpDecision('auto', 'yolo'), 'ask', 'a mode from elsewhere');
  assert.equal(mcpDecision(undefined, 'auto'), 'ask');
  assert.equal(switchFor('s', 't', {}), 'ask', 'a new tool starts on ask');
  assert.equal(switchFor('s', 't', { mcpSwitches: { s: { default: 'yes', tools: { t: 'always' } } } }), 'ask', 'a hand-edited value');
});

test('alwaysAsk beats auto, and block still refuses', () => {
  assert.equal(mcpDecision('auto', 'auto', { alwaysAsk: true }), 'ask');
  assert.equal(mcpDecision('block', 'auto', { alwaysAsk: true }), 'refuse');
});

test('a tool overrides its server', () => {
  const settings = { mcpSwitches: { s: { default: 'auto', tools: { danger: 'block' } } } };
  assert.equal(switchFor('s', 'danger', settings), 'block');
  assert.equal(switchFor('s', 'other', settings), 'auto');
  assert.equal(switchFor('elsewhere', 'other', settings), 'ask', 'control: only that server');
});

test('saved per person, one tool at a time', () => {
  assert.equal(setSwitch('saved', 'one', 'auto'), true);
  setSwitch('saved', 'two', 'block');
  setSwitch('saved', null, 'block');
  assert.equal(switchFor('saved', 'one'), 'auto');
  assert.equal(switchFor('saved', 'two'), 'block');
  assert.equal(switchFor('saved', 'three'), 'block');
  assert.equal(setSwitch('saved', 'one', 'sometimes'), false, 'nothing but the three');
});

test('enter cycles, and a server that always asks has no auto', () => {
  assert.deepEqual(['ask', 'auto', 'block'].map((v) => nextSwitch(v)), ['auto', 'block', 'ask']);
  assert.deepEqual(['ask', 'block'].map((v) => nextSwitch(v, { alwaysAsk: true })), ['block', 'ask']);
});
