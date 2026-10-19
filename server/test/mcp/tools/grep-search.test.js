import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { grepSearch } from '../../../src/mcp/tools/grep-search.js';

function repo(files) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(ws, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return ws;
}

const search = (ws, args) => grepSearch(args, { workspace: ws });

test('results are grouped by file', async (t) => {
  const ws = repo({
    'src/a.js': 'const throttle = 1;\nfunction throttle2() {}\nconst throttle3 = 3;\n',
    'src/b.js': 'import { throttle } from "../../../src/mcp/tools/a";\n',
    'src/c.js': 'nothing here\n',
  });

  await t.test('one entry per file, path stated once', async () => {
    const r = await search(ws, { pattern: 'throttle' });
    assert.equal(r.fileCount, 2);
    assert.deepEqual(r.files.map((f) => f.path).sort(), ['src/a.js', 'src/b.js']);
  });

  // On a large repo the module that owns a concept is usually the one that
  // mentions it most, and the model reads from the top of the list.
  await t.test('the file with the most matches comes first', async () => {
    const r = await search(ws, { pattern: 'throttle' });
    assert.equal(r.files[0].path, 'src/a.js');
    assert.equal(r.files[0].matches.length, 3);
  });

  await t.test('each match carries its line number and text', async () => {
    const r = await search(ws, { pattern: 'import' });
    assert.equal(r.files[0].matches[0].line, 1);
    assert.match(r.files[0].matches[0].text, /import \{ throttle \}/);
  });

  await t.test('no matches is an empty result, not an error', async () => {
    const r = await search(ws, { pattern: 'zzzznotpresent' });
    assert.equal(r.matchCount, 0);
    assert.deepEqual(r.files, []);
  });
});

// The model already knows "rate limit" might be spelled `throttle` here. It
// just had to spend a whole round trip per guess to find out.
test('several patterns in one search', async (t) => {
  const ws = repo({
    'a.js': 'const throttle = 1;\n',
    'b.js': 'const quota = 2;\n',
    'c.js': 'const unrelated = 3;\n',
  });

  await t.test('any of the terms matches', async () => {
    const r = await search(ws, { pattern: ['throttle', 'quota'] });
    assert.equal(r.fileCount, 2);
    assert.deepEqual(r.files.map((f) => f.path).sort(), ['a.js', 'b.js']);
  });

  await t.test('the terms searched are reported back', async () => {
    const r = await search(ws, { pattern: ['throttle', 'quota'] });
    assert.deepEqual(r.patterns, ['throttle', 'quota']);
  });

  await t.test('a single term still reports as `pattern`, as it always did', async () => {
    const r = await search(ws, { pattern: 'throttle' });
    assert.equal(r.pattern, 'throttle');
    assert.equal(r.patterns, undefined);
  });

  await t.test('blank terms are dropped rather than matching everything', async () => {
    const r = await search(ws, { pattern: ['throttle', '', '   '] });
    assert.equal(r.fileCount, 1);
  });

  await t.test('nothing to search for is an error', async () => {
    await assert.rejects(() => search(ws, { pattern: [] }), /cannot be empty/);
    await assert.rejects(() => search(ws, { pattern: '  ' }), /cannot be empty/);
  });
});

test('context lines', async (t) => {
  const ws = repo({ 'a.js': ['one', 'two', 'TARGET', 'four', 'five'].join('\n') + '\n' });

  await t.test('none by default — a match is one line', async () => {
    const r = await search(ws, { pattern: 'TARGET' });
    assert.equal(r.files[0].matches[0].before, undefined);
    assert.equal(r.files[0].matches[0].after, undefined);
  });

  await t.test('surrounding lines come back when asked for', async () => {
    const r = await search(ws, { pattern: 'TARGET', contextLines: 2 });
    const m = r.files[0].matches[0];
    assert.deepEqual(m.before, ['one', 'two']);
    assert.deepEqual(m.after, ['four', 'five']);
  });

  // A model asking for 200 lines of context wants the file, and should be told
  // to read it rather than handed it one match at a time.
  await t.test('an absurd amount of context is capped, not obeyed', async () => {
    const r = await search(ws, { pattern: 'TARGET', contextLines: 200 });
    assert.ok(r.files[0].matches[0].before.length <= 5);
  });
});

test('limits', async (t) => {
  const ws = repo({ 'a.js': Array.from({ length: 40 }, (_, i) => `hit ${i}`).join('\n') });

  await t.test('maxResults is respected and the truncation is stated', async () => {
    const r = await search(ws, { pattern: 'hit', maxResults: 5 });
    assert.equal(r.matchCount, 5);
    assert.equal(r.truncated, true);
    assert.match(r.note, /Narrow with/);
  });

  await t.test('a complete result says nothing about truncation', async () => {
    const r = await search(ws, { pattern: 'hit', maxResults: 500 });
    assert.equal(r.truncated, undefined);
  });
});

test('filters', async (t) => {
  const ws = repo({ 'a.js': 'needle\n', 'b.md': 'needle\n', 'c.txt': 'needle\n' });

  await t.test('includes restricts by glob', async () => {
    const r = await search(ws, { pattern: 'needle', includes: ['*.js'] });
    assert.deepEqual(r.files.map((f) => f.path), ['a.js']);
  });
});

/**
 * `a|b|c` is alternation, whatever `isRegex` says — but only when it is.
 *
 * `isRegex` defaults to false, which is `--fixed-strings`, so the model's most
 * ingrained grep habit searched for the literal string, pipes included, and
 * answered 0. On this repo `parseToolCall|tool_call|extractToolCalls|
 * handleToolCall` returned 0 where the same search as a regex returned 26, and
 * the model then read a 131 KB file three times. A model told "0 matches" does
 * not doubt the tool; it concludes the code is not there.
 */
test('identifier alternation is searched as alternatives', async (t) => {
  const ws = repo({
    'src/a.js': 'function extractToolCalls() {}\n',
    'src/b.js': 'const handleToolCall = 1;\n',
    'src/c.js': 'literal: a || b\nshell: cat x | grep y\n| col | col |\n',
  });
  const count = (r) => r.files.reduce((n, f) => n + f.matches.length, 0);

  await t.test('the shape from the session finds what the regex finds', async () => {
    const r = await search(ws, { pattern: 'parseToolCall|extractToolCalls|handleToolCall' });
    assert.equal(count(r), 2, 'answered 0 — the model concludes the code is not there');
    assert.deepEqual(r.files.map((f) => f.path).sort(), ['src/a.js', 'src/b.js']);
  });

  await t.test('and says it did, so the model learns the array form', async () => {
    const r = await search(ws, { pattern: 'extractToolCalls|handleToolCall' });
    assert.match(r.alternation, /2 alternatives/);
    assert.match(r.alternation, /array/);
  });

  await t.test('an ordinary search carries no such note', async () => {
    const r = await search(ws, { pattern: 'extractToolCalls' });
    assert.equal(r.alternation, undefined);
  });

  /*
   * The negative controls. A literal `|` is real text in code and prose: a
   * logical or, a shell pipe, a markdown table. Splitting those would search
   * for fragments and return nonsense, which is the same failure turned round.
   */
  await t.test('a literal || with spaces is searched as written', async () => {
    const r = await search(ws, { pattern: 'a || b' });
    assert.equal(count(r), 1);
    assert.equal(r.alternation, undefined);
  });

  await t.test('a shell pipe is searched as written', async () => {
    const r = await search(ws, { pattern: 'cat x | grep y' });
    assert.equal(count(r), 1);
    assert.equal(r.alternation, undefined);
  });

  await t.test('with isRegex: true it is left to the regex engine', async () => {
    const r = await search(ws, { pattern: 'extractToolCalls|handleToolCall', isRegex: true });
    assert.equal(count(r), 2);
    assert.equal(r.alternation, undefined, 'the note is for the rescue, not for a regex');
  });
});
