import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../src/frontend/transcript/markdown.js';

const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;[^\x07]*\x07/g, '');

test('an email stays text, bold or not, and the row keeps its end', () => {
  assert.equal(plain(renderMarkdown('write to a.b@example.com today', 80)), 'write to a.b@example.com today');
  const row = plain(renderMarkdown('⚙ Chrome profile  **any** → **a.b@example.com** · nothing else gets prompts', 100));
  assert.equal(row, '⚙ Chrome profile  any → a.b@example.com · nothing else gets prompts');
  assert.ok(!row.includes('mailto'));
});

test('control: a web address is still a link to marked', () => {
  assert.match(plain(renderMarkdown('see https://example.com/a now', 80)), /https:\/\/example\.com\/a/);
  assert.equal(plain(renderMarkdown('user@ is not an address', 80)), 'user@ is not an address');
});
