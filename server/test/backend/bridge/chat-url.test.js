/**
 * What a Gemini tab's URL says (extension `src/background/chat-url.js`).
 *
 * The account prefix is the case worth pinning: a new chat opened at the bare
 * `/app` from `/u/1/app/<id>` lands on a different Google account.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chatPath, isFreshChat, freshChatUrl } from '../../../../extension/src/background/chat-url.js';

test('a conversation and a new chat', () => {
  assert.deepEqual(chatPath('https://gemini.google.com/app/17d6b14b8a5d1ff2'), { account: '', thread: '17d6b14b8a5d1ff2' });
  assert.deepEqual(chatPath('https://gemini.google.com/app'), { account: '', thread: null });
  assert.deepEqual(chatPath('https://gemini.google.com/app/'), { account: '', thread: null });
  assert.deepEqual(chatPath('https://gemini.google.com/app?hl=en'), { account: '', thread: null });
  assert.equal(isFreshChat('https://gemini.google.com/app'), true);
  assert.equal(isFreshChat('https://gemini.google.com/app/17d6b14b8a5d1ff2'), false);
});

test('the account survives', () => {
  assert.deepEqual(chatPath('https://gemini.google.com/u/1/app/abc123'), { account: '/u/1', thread: 'abc123' });
  assert.equal(freshChatUrl('https://gemini.google.com/u/1/app/abc123'), 'https://gemini.google.com/u/1/app');
  assert.equal(freshChatUrl('https://gemini.google.com/app/abc123'), 'https://gemini.google.com/app');
});

test('not a chat page is not a fresh chat', () => {
  for (const url of ['https://gemini.google.com/gems/view', 'https://example.com/app', 'not a url', '']) {
    assert.equal(isFreshChat(url), false, url);
  }
  assert.equal(freshChatUrl('garbage'), 'https://gemini.google.com/app');
});
