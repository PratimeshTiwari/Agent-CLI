/**
 * Large files: reads that say what they left out, edits that survive a copied
 * line number, and documents built by appending (v5.10).
 *
 * Reported from the work laptop: simple edits in 1,000–2,000-line files went
 * badly, and writing a Confluence document from several files struggled even
 * at the highest effort. Measured on this repo's own large files: two 800-line
 * reads in one reply were cut by characters in the middle — App.jsx lost lines
 * 289–641 while its result still claimed `range: 1–800` — inside minified JSON
 * where every line break was a `\n` escape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiffEngine, stripLineNumbers, nearestMatchNote } from '../../src/core/diff-engine.js';
import { formatReadResult, fitReadResult } from '../../src/core/result-budget.js';
import { PromptBuilder } from '../../src/core/prompt-builder.js';
import { readFile } from '../../src/mcp/tools/read-file.js';
import { editFile } from '../../src/mcp/tools/edit-file.js';

/** A 1,500-line Ruby-ish file, each line unique. */
function bigFile() {
  const ws = mkdtempSync(join(tmpdir(), 'large-'));
  const lines = Array.from({ length: 1500 }, (_, i) => `  def method_${i + 1}(arg) = compute_${i + 1}(arg, "value ${i + 1}")`);
  writeFileSync(join(ws, 'big.rb'), `${lines.join('\n')}\n`);
  return ws;
}

test('a read reaches the model as numbered text, not escaped JSON', async () => {
  const ws = bigFile();
  const r = await readFile({ path: 'big.rb', startLine: 1, endLine: 3 }, { workspace: ws });
  const text = formatReadResult(r);
  assert.match(text, /^big\.rb · lines 1–3 of 1501/);
  assert.match(text, /\n {3}1: {3}def method_1\(arg\)/);
  assert.ok(!text.includes('\\n') && !text.includes('\\"'), 'escapes are what the model had to undo');
});

test('two big reads in one reply: each is whole lines, and names exactly what it left out', async () => {
  const ws = bigFile();
  const a = await readFile({ path: 'big.rb' }, { workspace: ws });
  const b = await readFile({ path: 'big.rb', startLine: 801 }, { workspace: ws });
  const pb = Object.create(PromptBuilder.prototype);
  pb.workspace = ws;
  const out = pb.buildToolResultBatch([{ name: 'read_file', result: a }, { name: 'read_file', result: b }]);

  for (const part of out.split('<result tool="read_file">').slice(1)) {
    const nums = [...part.matchAll(/^\s*(\d+): /gm)].map((m) => Number(m[1]));
    for (let i = 1; i < nums.length; i++) assert.equal(nums[i], nums[i - 1] + 1, 'a gap inside what was shown');
    const note = part.match(/lines (\d+)–(\d+) were not shown[\s\S]*?startLine (\d+), endLine (\d+)/);
    assert.ok(note, 'it was cut and did not say where');
    assert.equal(Number(note[1]), nums.at(-1) + 1, 'the named gap starts right after the last line shown');
    assert.equal(note[1], note[3]);
  }
});

test('control: a read that fits is passed through whole, with no note', async () => {
  const ws = bigFile();
  const r = await readFile({ path: 'big.rb', startLine: 10, endLine: 20 }, { workspace: ws });
  assert.equal(fitReadResult(r, 100_000), formatReadResult(r));
});

test('an edit with read_file line numbers copied into it still applies', () => {
  const ws = bigFile();
  const engine = new DiffEngine(ws);
  const diff = engine.generateDiff('big.rb', [{
    oldText: ' 700:   def method_700(arg) = compute_700(arg, "value 700")',
    newText: ' 700:   def method_700(arg) = compute_700(arg, "CHANGED")',
  }]);
  assert.match(diff.patch, /^\+ {2}def method_700\(arg\) = compute_700\(arg, "CHANGED"\)$/m);
  assert.doesNotMatch(diff.patch, /^\+.*700: /m, 'the line number went into the file');
});

test('control: a lone "12: " in real text is not treated as a line number', () => {
  assert.equal(stripLineNumbers('steps:\n12: first\nnot numbered'), null);
  assert.equal(stripLineNumbers('  12: a\n  13: b'), 'a\nb');
});

test('a miss points at the nearest line, with numbers, instead of only "not found"', () => {
  const ws = bigFile();
  const engine = new DiffEngine(ws);
  assert.throws(
    () => engine.generateDiff('big.rb', [{ oldText: '  def method_912(arg) = compute_912(arg, "value 9l2")', newText: 'x' }]),
    (err) => /Closest match, at line 912/.test(err.message) && /Read lines 902–922/.test(err.message),
  );
});

test('control: nothing close means no misleading pointer', () => {
  assert.equal(nearestMatchNote('alpha\nbeta\ngamma', 'completely unrelated words here'), '');
});

test('append adds to the end without matching anything', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'append-'));
  writeFileSync(join(ws, 'doc.md'), '# Design\n\n## Overview\nIntro.');
  const engine = new DiffEngine(ws);
  const out = await editFile({ path: 'doc.md', append: '## Parser\nReads fenced blocks.\n' }, { workspace: ws, diffEngine: engine });
  engine.acceptDiff(out.diffId);
  assert.equal(readFileSync(join(ws, 'doc.md'), 'utf8'), '# Design\n\n## Overview\nIntro.\n## Parser\nReads fenced blocks.\n');
});

test('edit_file with neither edits nor append says what it needs', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'append2-'));
  writeFileSync(join(ws, 'doc.md'), 'x');
  await assert.rejects(editFile({ path: 'doc.md' }, { workspace: ws, diffEngine: new DiffEngine(ws) }), /`edits`.*or `append`/);
});

test('the prompt tells the model to append rather than rewrite a document', () => {
  const catalog = readFileSync(new URL('../../src/core/tool-catalog.js', import.meta.url), 'utf8');
  assert.match(catalog, /add each section with \\`append\\`/);
  assert.match(catalog, /without read_file's line numbers/);
});

test('in auto mode an append is a safe, addition-only edit — not "could not determine"', async () => {
  const { RiskClassifier } = await import('../../src/core/risk-classifier.js');
  const rc = new RiskClassifier(mkdtempSync(join(tmpdir(), 'rc-')));
  const v = rc.classify('edit_file', { path: 'doc.md', append: '## Section\nText.\n' });
  assert.equal(v.level, 'safe');
  assert.match(v.reason, /Addition-only/);
  // Control: an append alongside a large rewrite is still judged by the rewrite.
  const big = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(rc.classify('edit_file', { path: 'doc.md', edits: [{ oldText: big, newText: 'x' }], append: 'y' }).level, 'risky');
});
