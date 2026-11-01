/**
 * read_file on documents (v5.29): PDF, Word and PowerPoint come back as
 * Markdown, a binary file is refused, and text is read exactly as before.
 *
 * Fixtures are in `test/fixtures/docs/`, written by hand so the expected text
 * is known: the PDFs by a tiny generator (one with text on two pages, one with
 * no text layer), the .docx and .pptx as zips of the XML Word and PowerPoint
 * write, `sample.doc` by macOS `textutil`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync, copyFileSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from '../../../src/backend/mcp/tools/read-file.js';
import { formatReadResult } from '../../../src/backend/core/turn/result-budget.js';
import {
  textutilToText, readZipEntries, clearDocumentCache, extractDocument, looksBinary,
} from '../../../src/backend/mcp/tools/documents.js';

const FIXTURES = new URL('../../fixtures/docs/', import.meta.url).pathname;
const read = (name, extra = {}) => readFile({ path: name, ...extra }, { workspace: FIXTURES });
const body = (result) => result.content.split('\n').map((l) => l.replace(/^\s*\d+: /, '')).join('\n');

describe('PDF', () => {
  test('each page, marked, as text', async () => {
    const r = await read('report.pdf');
    assert.equal(body(r), '--- page 1 ---\nQuarterly report\nRevenue grew in the third quarter.\n\n--- page 2 ---\nSecond page: costs fell.');
    assert.equal(formatReadResult(r).split('\n')[0], 'report.pdf · lines 1–6 of 6 · markdown, from PDF (2 pages)');
  });

  test('a range reads whole lines of the extracted text', async () => {
    const r = await read('report.pdf', { startLine: 5, endLine: 6 });
    assert.equal(body(r), '--- page 2 ---\nSecond page: costs fell.');
    assert.deepEqual(r.range, { start: 5, end: 6 });
  });

  test('no text layer is said, not returned as a blank file', async () => {
    const r = await read('scanned.pdf');
    assert.match(r.content, /no text layer: 2 pages of images/);
  });

  test('extracted once, again only when the file changes', async () => {
    clearDocumentCache();
    const dir = mkdtempSync(join(tmpdir(), 'docs-'));
    const file = join(dir, 'r.pdf');
    copyFileSync(join(FIXTURES, 'report.pdf'), file);
    const first = await extractDocument(file, statSync(file));
    assert.equal(await extractDocument(file, statSync(file)), first, 'the cached object');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    assert.notEqual(await extractDocument(file, statSync(file)), first, 'touched: extracted again');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Word and PowerPoint', () => {
  test('.docx: headings, a list, a table, escapes', async () => {
    assert.equal(body(await read('notes.docx')), [
      '# Release notes',
      '',
      'Plain paragraph with <b>no</b> markup.',
      '',
      '## Details',
      '',
      '- first point',
      '  - nested point',
      '',
      '| Item | Cost |',
      '| --- | --- |',
      '| Servers | 12 & up |',
      '| Pipes \\| tubes | 3 |',
      '',
      'After the table.',
    ].join('\n'));
  });

  test('.pptx: slides in order, numbered by their own number', async () => {
    const text = body(await read('deck.pptx'));
    assert.match(text, /^--- slide 1 ---\nTitle slide\nby the team\n\n--- slide 2 ---\nSecond slide\ncosts < budget\n\n--- slide 10 ---\nTenth slide$/);
  });

  test('.doc through textutil on macOS; elsewhere a refusal that says what to do', async (t) => {
    assert.throws(() => textutilToText('/x/old.doc', 'linux'), /only be read on macOS.*Save it as \.docx/);
    if (process.platform !== 'darwin') return t.skip('textutil is macOS-only');
    assert.match(body(await read('sample.doc')), /Heading One\nFirst paragraph of the report\.\n+Second page text here\./);
  });

  test('the zip reader finds an entry and only the ones asked for', () => {
    const entries = readZipEntries(readFileSync(join(FIXTURES, 'notes.docx')), (n) => n === 'word/document.xml');
    assert.deepEqual([...entries.keys()], ['word/document.xml']);
  });
});

describe('everything else', () => {
  test('a binary file is refused, and the refusal says what can be read', async () => {
    for (const name of ['archive.zip', 'pixel.png']) {
      await assert.rejects(read(name), /binary file .* cannot be read as text\. read_file reads text, PDF, Word/);
    }
  });

  test('control: Markdown and source read exactly as before', async () => {
    const r = await read('readme.md');
    assert.equal(r.language, 'markdown');
    assert.equal(body(r), readFileSync(join(FIXTURES, 'readme.md'), 'utf8'));
    assert.equal(looksBinary(Buffer.from('plain text')), false);
  });
});
