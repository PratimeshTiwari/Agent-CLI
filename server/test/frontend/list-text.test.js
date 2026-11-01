/*
 * #103, "Text color in output": every list item in a reply was drawn dim grey,
 * and a URL in backticks inside one lost its colon to `*#COLON|*`.
 *
 * List-item text went to marked-terminal as an `html` token, which it draws with
 * `chalk.gray` and without the step that puts the colon back. Colour is forced
 * on before the renderer loads — chalk decides at import, and with no TTY it
 * draws nothing, which would let the grey through unseen. Each test file is its
 * own process, so this reaches no other test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FORCE_COLOR = '1';
const { renderMarkdown, finishInline } = await import('../../src/frontend/format.js');

const GREY = '\x1b[90m';
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const REPLY = `1. **Repository Check (Lines 53-141):**
   - Checks if it is already executed.
   - Clones \`https://github.com/x/y.git\` into \`~/Agent-CLI\`.
   - Uses &amp; and \`a: b\`.
`;

test('list text is not grey', () => {
  const out = renderMarkdown(REPLY);
  assert.ok(out.includes('\x1b['), 'colour is on, or this test proves nothing');
  assert.ok(!out.includes(GREY), `grey list text: ${JSON.stringify(out)}`);
});

test('a URL in backticks inside a list item keeps its colon', () => {
  const out = strip(renderMarkdown(REPLY));
  assert.match(out, /https:\/\/github\.com\/x\/y\.git/);
  assert.match(out, /a: b/);
  assert.doesNotMatch(out, /COLON/);
});

test('entities in a list item are decoded', () => {
  assert.match(strip(renderMarkdown(REPLY)), /Uses & and/);
});

test('a table cell keeps its colon too', () => {
  const out = strip(renderMarkdown('| url | note |\n| --- | --- |\n| `http://x.io` | a: b |\n'));
  assert.match(out, /http:\/\/x\.io/);
  assert.doesNotMatch(out, /COLON/);
});

test('a paragraph, which was always right, is unchanged', () => {
  const out = strip(renderMarkdown('See `https://a.com` & more.'));
  assert.match(out, /See https:\/\/a\.com & more\./);
});

test('real HTML in a reply still goes to marked-terminal', () => {
  // The `html` override passes only list text through; anything else returns
  // false and falls back, so this is drawn the way it always was.
  assert.match(strip(renderMarkdown('<div>hi</div>\n')), /<div>hi<\/div>/);
});

test('finishInline', () => {
  assert.equal(finishInline('https*#COLON|*//a'), 'https://a');
  assert.equal(finishInline('a &lt;b&gt; &quot;c&quot; &#39;d&#39; &amp;'), 'a <b> "c" \'d\' &');
  assert.equal(finishInline(undefined), '');
});
