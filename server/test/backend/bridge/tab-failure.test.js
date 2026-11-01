import test from 'node:test';
import assert from 'node:assert/strict';
import { tabUnreachableMessage, subagentTabFailure } from '../../../src/backend/bridge/tab-failure.js';

test('one line, and the chat on a line of its own', () => {
  assert.equal(tabUnreachableMessage('https://gemini.google.com/app/abc'),
    'Communication with the Gemini tab failed · check the browser\nhttps://gemini.google.com/app/abc');
  assert.equal(tabUnreachableMessage(null), 'Communication with the Gemini tab failed · check the browser');
  assert.doesNotMatch(tabUnreachableMessage('x'), /Cmd\+Shift\+R|Hard-refresh/);
});

test("a subagent's failure names its tab and keeps the page's reason (v8.4)", () => {
  assert.equal(subagentTabFailure('No tab with id: 5.'), 'its Gemini tab failed (No tab with id: 5)');
  assert.equal(subagentTabFailure(undefined), 'its Gemini tab failed');
});
