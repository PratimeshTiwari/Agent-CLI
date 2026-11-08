/**
 * A rewrite that only adds to the end runs as an append (v9.9.4). Seen from
 * use: Flash built a document by sending the whole file back as `oldText` and
 * the whole file plus a section as `newText`, a "large deletion" auto mode
 * stopped on every round.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editFile, appendHiddenInEdit } from '../../../../src/backend/mcp/tools/edit-file.js';
import { DiffEngine } from '../../../../src/backend/core/edits/diff-engine.js';
import { RiskClassifier } from '../../../../src/backend/core/commands/risk-classifier.js';

const DOC = '# Design\n\n## One\n\nThe first section, long enough to be a real one.\nAnd a second line.\n';
const SECTION = '\n## Two\n\nThe second section.\n';

function ws() {
  const dir = mkdtempSync(join(tmpdir(), 'edit-append-'));
  writeFileSync(join(dir, 'doc.md'), DOC);
  return { dir, diffEngine: new DiffEngine(dir) };
}

test('the whole file plus a section becomes an append of the section', async () => {
  const { dir, diffEngine } = ws();
  const out = await editFile({ path: 'doc.md', edits: [{ oldText: DOC, newText: DOC + SECTION }] }, { workspace: dir, diffEngine });
  assert.match(out.message, /an append/);
  assert.match(out.message, /Next time send `append`/);
  await diffEngine.acceptDiff(out.diffId);
  assert.equal(readFileSync(join(dir, 'doc.md'), 'utf8'), DOC + SECTION.slice(1), 'one blank line between, not two');
});

test('the tail of the file works too; anything else stays an edit', () => {
  const tail = 'The first section, long enough to be a real one.\nAnd a second line.\n';
  assert.equal(appendHiddenInEdit(DOC, [{ oldText: tail, newText: tail + SECTION }]), SECTION.slice(1));
  // Not at the end: an insertion in the middle is an edit.
  assert.equal(appendHiddenInEdit(DOC, [{ oldText: '# Design\n\n## One\n\nThe first section, long', newText: '# Design\n\n## One\n\nThe first section, long X' }]), null);
  // Changed text: an edit.
  assert.equal(appendHiddenInEdit(DOC, [{ oldText: DOC, newText: DOC.replace('first', 'opening') + SECTION }]), null);
  // Two edits, or a short oldText: left alone.
  assert.equal(appendHiddenInEdit(DOC, [{ oldText: DOC, newText: DOC + SECTION }, { oldText: 'a', newText: 'b' }]), null);
  assert.equal(appendHiddenInEdit(DOC, [{ oldText: 'line.\n', newText: 'line.\nmore\n' }]), null);
});

test('auto mode reads a text-keeping edit as an addition, and a real rewrite as before', () => {
  const rc = new RiskClassifier(mkdtempSync(join(tmpdir(), 'rc-')));
  const big = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(rc.classify('edit_file', { path: 'doc.md', edits: [{ oldText: big, newText: `${big}\n## More\ntext` }] }).level, 'safe');
  assert.equal(rc.classify('edit_file', { path: 'doc.md', edits: [{ oldText: big, newText: `## Intro\n${big}` }] }).level, 'safe');
  assert.equal(rc.classify('edit_file', { path: 'doc.md', edits: [{ oldText: big, newText: big.replace('line 3', 'LINE 3') }] }).level, 'risky',
    'negative control: a real rewrite still asks');
});
