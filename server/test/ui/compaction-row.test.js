/**
 * A compaction is one dim row in the transcript, with the summary behind ctrl+e.
 *
 * It was a paragraph drawn as a reply (`● 🗜 Context compacted — ✓ Compacted
 * 14 turns, summarised by this chat; continuing in a fresh chat…`), and after
 * `/compact` the summary turn itself was drawn as a wall of system text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTurnActions } from '../../src/ui/transcript.js';
import { compactionRow } from '../../src/ui/format.js';

const turn = (steps) => ({ id: 't', steps });

test('the note is a compaction item, not prose and not work', () => {
  const { items, actions } = parseTurnActions(turn([
    { role: 'assistant', type: 'compaction_note', turns: 14, summary: 'We fixed X.', content: '🗜 Context compacted — long text' },
  ]));
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'compaction');
  assert.equal(items[0].summary, 'We fixed X.');
  assert.equal(actions.length, 0, 'a compaction counted as an action draws "Worked for"');
});

test('the summary turn at the head of history is not drawn', () => {
  const { items } = parseTurnActions(turn([
    { role: 'system', type: 'compaction_summary', content: '[Context Summary of older turns]\n…' },
    { role: 'assistant', content: 'carry on' },
  ]));
  assert.deepEqual(items.map((i) => i.type), ['text']);
});

test('control: an ordinary assistant reply is still prose', () => {
  const { items } = parseTurnActions(turn([{ role: 'assistant', content: '🗜 not a note' }]));
  assert.equal(items[0].type, 'text');
});

test('the row', () => {
  assert.equal(compactionRow(14), '✻ Conversation compacted · 14 turns summarised · ctrl+e for the summary');
  assert.equal(compactionRow(1, true), '✻ Conversation compacted · 1 turn summarised');
  assert.equal(compactionRow(undefined), '✻ Conversation compacted · ctrl+e for the summary');
});

test('an unparseable tool call is its prose and one row, not the JSON and a paragraph', () => {
  const { items, actions } = parseTurnActions(turn([
    { role: 'agent', content: 'Reading the builder.\n```json\n{"name": "read_file", "args": {"path": "a```json\n```', parseError: 'Expected , or }', attempt: 1, maxAttempts: 2 },
    { role: 'system', type: 'parse_error', content: 'ERROR PARSING TOOL CALLS:\nExpected , or }' },
  ]));
  assert.deepEqual(items.map((i) => i.type), ['text', 'parse_error']);
  assert.equal(items[0].content, 'Reading the builder.');
  assert.equal(items[1].attempt, 1);
  assert.equal(actions.length, 0, 'a failed parse is not work the agent did');
});

test('the parse-error row', async () => {
  const { parseErrorRow } = await import('../../src/ui/format.js');
  assert.equal(parseErrorRow(1, 2), '✗ Could not read its tool call — asked it to resend (1/2) · ctrl+e for details');
  assert.equal(parseErrorRow(undefined, undefined, true), '✗ Could not read its tool call — asked it to resend');
});
