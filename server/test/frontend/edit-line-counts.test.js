/**
 * An edit row says how big the edit is: `edit_file big.rb · +3 −1`, like Claude Code's
 * "3 additions and 1 removal". It said `1 hunk in big.rb`, which is the same
 * row for a one-character fix and a rewritten function.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeResult, lineDelta } from '../../src/frontend/transcript/tool-rows.js';

const PATCH = [
  'Index: app/big.rb', '===', '--- app/big.rb\toriginal', '+++ app/big.rb\tmodified',
  '@@ -1,3 +1,5 @@', ' keep', '-old line', '+new line', '+another', '+third', ' keep',
].join('\n');

test('added and removed lines are counted, file headers are not', () => {
  assert.deepEqual(lineDelta(PATCH), { added: 3, removed: 1 });
});

test('the row carries them', () => {
  // Counts only — the row's subject already names the file.
  assert.equal(summarizeResult('edit_file', { filePath: 'app/big.rb', hunkCount: 1, patch: PATCH }), '+3 −1');
  assert.equal(summarizeResult('create_file', { filePath: 'doc.md', hunkCount: 1, patch: PATCH }), '+3 −1');
});

test('control: no patch, the old wording; a decision still reads as the decision', () => {
  assert.equal(summarizeResult('edit_file', { filePath: 'app/big.rb', hunkCount: 2 }), '2 hunks in big.rb');
  assert.equal(summarizeResult('edit_file', 'User REJECTED the edit to x'), 'rejected — nothing written');
});
