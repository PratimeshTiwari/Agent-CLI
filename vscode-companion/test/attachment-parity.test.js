/**
 * The companion's attachment format is a copy of the CLI's (it cannot import
 * from the server). This fails if the two drift, so an @ attachment from the
 * panel reads exactly like "Add to Agent Chat" from the terminal.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mine = require('../chat-panel-html.js');

test('marker and body match server/src/ui/chat-queue.js', async () => {
  const theirs = await import('../../server/src/frontend/chat-queue.js');
  for (const entry of [
    { file: 'src/app.js', startLine: 12, endLine: 30, text: 'a\nb', language: 'javascript' },
    { file: 'README.md', startLine: 4, endLine: 4, text: 'one line', language: '' },
  ]) {
    assert.equal(mine.selectionMarker(entry), theirs.selectionMarker(entry));
    assert.equal(mine.selectionBody(entry), theirs.selectionBody(entry));
  }
});
