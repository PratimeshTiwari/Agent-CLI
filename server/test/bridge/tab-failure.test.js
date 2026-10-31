import test from 'node:test';
import assert from 'node:assert/strict';
import { tabUnreachableMessage } from '../../src/bridge/tab-failure.js';

test('one line, and the chat on a line of its own', () => {
  assert.equal(tabUnreachableMessage('https://gemini.google.com/app/abc'),
    'Communication with the Gemini tab failed · check the browser\nhttps://gemini.google.com/app/abc');
  assert.equal(tabUnreachableMessage(null), 'Communication with the Gemini tab failed · check the browser');
  assert.doesNotMatch(tabUnreachableMessage('x'), /Cmd\+Shift\+R|Hard-refresh/);
});
