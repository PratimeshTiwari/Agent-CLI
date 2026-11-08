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

test('bold is drawn by marked-terminal, never left as a bare `[1m` (v9.9.6, marked-terminal 8)', () => {
  const was = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = '1';
  try {
    for (const md of ['plain **bold** text', '- item with **bold**', '| a |\n|---|\n| **x** |']) {
      const out = renderMarkdown(md, 80);
      assert.match(out, /\x1b\[1m(bold|x)\x1b\[22m/, md);
      // Control: the bytes v8 left behind when the escape was written into the text.
      assert.doesNotMatch(out.replace(/\x1b\[[0-9;]*m/g, ''), /\[1m|\[22m/, md);
    }
  } finally {
    if (was === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = was;
  }
});
