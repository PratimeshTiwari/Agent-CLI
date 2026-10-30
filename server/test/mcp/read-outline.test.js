/**
 * A partial read of a Markdown file names the headings it did not show
 * (v6.14). Asked about the architecture, the model read README lines 1–100
 * and 90–150; the pointer to CLAUDE.md was under `## More` at line 258, and
 * nothing in either read said that section existed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, unreadOutline } from '../../src/mcp/tools/read-file.js';
import { fitReadResult } from '../../src/core/result-budget.js';

const doc = [
  '# Title', 'intro', '## Install', 'steps',
  '```bash', '# not a heading', '```',
  '## How it works', 'body', '### Detail', 'more', '## More', 'See CLAUDE.md for the architecture.',
];

test('a read of the top lists the headings below it, and skips fenced code', () => {
  const outline = unreadOutline(doc, 1, 4);
  assert.match(outline, /Headings outside lines 1–4:/);
  assert.match(outline, /- ## How it works \(line 8\)/);
  assert.match(outline, /- ### Detail \(line 10\)/);
  assert.match(outline, /- ## More \(line 12\)/);
  assert.doesNotMatch(outline, /not a heading/);
  assert.doesNotMatch(outline, /Install/, 'a heading that was shown is not repeated');
});

test('a read of the middle lists both sides; a whole read adds nothing', () => {
  const outline = unreadOutline(doc, 8, 10);
  assert.match(outline, /# Title \(line 1\)/);
  assert.match(outline, /## More \(line 12\)/);
  assert.equal(unreadOutline(doc, 1, doc.length), '');
});

test('capped, and says how many it left out', () => {
  const many = Array.from({ length: 60 }, (_, i) => `## Section ${i}`);
  const outline = unreadOutline(['top', ...many], 1, 1);
  assert.equal(outline.split('\n').filter((l) => l.startsWith('- ##')).length, 40);
  assert.match(outline, /- … 20 more$/);
});

test('through the tool: Markdown gets the outline, code does not', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'outline-'));
  try {
    writeFileSync(join(ws, 'README.md'), doc.join('\n'));
    writeFileSync(join(ws, 'a.js'), '// # not markdown\n'.repeat(5) + '## x\n');
    const md = await readFile({ path: 'README.md', startLine: 1, endLine: 4 }, { workspace: ws });
    assert.match(md.content, /## More \(line 12\)/);
    const js = await readFile({ path: 'a.js', startLine: 1, endLine: 2 }, { workspace: ws });
    assert.doesNotMatch(js.content, /Headings outside/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('the outline is not mistaken for shown lines when a read is cut to fit', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'outline-'));
  try {
    writeFileSync(join(ws, 'big.md'), ['# Top', ...Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(60)}`), '## Far (end)'].join('\n'));
    const r = await readFile({ path: 'big.md', startLine: 1, endLine: 200 }, { workspace: ws });
    const fitted = fitReadResult(r, 4000);
    // Cut by the budget: the note must name a line that was really not shown.
    const m = /lines (\d+)–200 were not shown/.exec(fitted);
    assert.ok(m, fitted.slice(-300));
    assert.ok(Number(m[1]) < 200);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
