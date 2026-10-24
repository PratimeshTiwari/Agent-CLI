/**
 * The disconnected row names the fix that applies.
 *
 * It said "Open a Gemini tab in Chrome" for every cause. An agent on a
 * non-default port can never be reached — the extension only dials 7777 — and
 * one that dropped needs Chrome back, not first-time setup.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { disconnectedHint, EXTENSION_PORT } from '../../src/ui/format.js';

test('a different port says so, whatever else is true', () => {
  assert.match(disconnectedHint({ port: 7801, everConnected: true }), /7801.*--port/);
});

test('a dropped connection is not first-time setup', () => {
  assert.match(disconnectedHint({ port: EXTENSION_PORT, everConnected: true }), /disconnected/);
});

test('never connected: open the tab', () => {
  assert.match(disconnectedHint({ port: EXTENSION_PORT }), /gemini\.google\.com/);
});

test('every variant fits 72 columns, so truncation never eats the fix', () => {
  for (const o of [{ port: 65535 }, { everConnected: true }, {}]) {
    assert.ok(disconnectedHint(o).length <= 72, disconnectedHint(o));
  }
});

test('the extension really does dial only this port', async () => {
  const { DEFAULT_PORT } = await import('../../../extension/src/background/policy.js');
  assert.equal(DEFAULT_PORT, EXTENSION_PORT);
});

test('taskProgress counts the checklist, and nothing else', async () => {
  const { taskProgress } = await import('../../src/ui/format.js');
  assert.deepEqual(taskProgress('# Tasks\n- [x] a\n- [ ] b\n  * [X] c\nnot - [x] inline'), { done: 2, total: 3 });
  assert.equal(taskProgress('# Plan\nno boxes'), null);
  assert.equal(taskProgress(null), null);
});
