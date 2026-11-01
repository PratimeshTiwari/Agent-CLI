/**
 * Tables are drawn here, and they fit.
 *
 * `marked-terminal` hands them to `cli-table3`, which sizes to **content**
 * and ignores its `width` option. Measured on a three-column table from a
 * real reply: 158 visible columns whatever the terminal was. At 90 columns
 * every line of that wraps, and a wrapped border is not a narrow table — it
 * is the top-left corner of a box on one line and the rest on the next.
 *
 * A table is the one element Ink must never wrap, so it is the one renderer
 * that has to know the terminal width.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderMarkdown, visibleWidth, wrapAnsi, fitColumns } from '../../src/frontend/format.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('visibleWidth', () => {
  it('ignores the escapes that colour a string', () => {
    assert.strictEqual(visibleWidth('\x1b[36mabc\x1b[0m'), 3);
    assert.strictEqual('\x1b[36mabc\x1b[0m'.length, 12, 'the naive count is what broke alignment');
  });
});

describe('wrapAnsi', () => {
  it('breaks at the last space that fits', () => {
    assert.deepStrictEqual(wrapAnsi('the quick brown fox', 10), ['the quick', 'brown fox']);
  });

  it('keeps colour across a break and still measures right', () => {
    // Wrapping the stripped copy would be easier arithmetic and would lose
    // the one thing marking a cell as code.
    const out = wrapAnsi('\x1b[36mcoloured\x1b[0m text here', 10);
    assert.deepStrictEqual(out.map(visibleWidth), [8, 9]);
    assert.ok(out[0].includes('\x1b[36m'));
  });

  it('cuts a token longer than the column', () => {
    // The alternative is a row wider than the table says it is, which is the
    // whole bug.
    const out = wrapAnsi('supercalifragilistic', 8);
    assert.ok(out.every((l) => visibleWidth(l) <= 8), out.join('|'));
  });

  it('never opens a continuation line with a space', () => {
    for (const w of [6, 9, 13, 21]) {
      for (const line of wrapAnsi('Verified (Pre-implementation): Inspected lines 1929', w)) {
        assert.notStrictEqual(strip(line)[0], ' ', `width ${w}: ${JSON.stringify(line)}`);
      }
    }
  });

  it('an empty string is one empty line, not none', () => {
    assert.deepStrictEqual(wrapAnsi('', 10), ['']);
  });
});

describe('fitColumns', () => {
  it('takes from the widest, not proportionally', () => {
    // Proportional shrinking takes as much from a 6-column Status as from a
    // 70-column Verdict, and the narrow ones cannot afford it.
    const [a, b, c] = fitColumns([8, 8, 60], 60);
    assert.strictEqual(a, 8);
    assert.strictEqual(b, 8);
    assert.ok(c < 60);
  });

  it('fits the budget exactly when it can', () => {
    const cols = fitColumns([37, 37, 70], 90);
    assert.strictEqual(cols.reduce((x, y) => x + y, 0) + cols.length * 3 + 1, 90);
  });

  it('leaves a table that already fits alone', () => {
    assert.deepStrictEqual(fitColumns([5, 5], 80), [5, 5]);
  });

  it('stops at the minimum rather than shrinking to nothing', () => {
    const cols = fitColumns([40, 40, 40], 20, 6);
    assert.ok(cols.every((c) => c >= 6), JSON.stringify(cols));
  });
});

describe('the rendered table', () => {
  const md = [
    '| Item | Status | Verdict |',
    '| --- | --- | --- |',
    '| **Direct Text Fallback in `agent-loop.js`** | Task 2: Root-Cause Verification (`[x]`) '
      + '| **Verified**: Inspected lines 1929-1951 of `agent-loop.js` and confirmed the exit. |',
    '| Short | Also short | Confirmed in `server/src/mcp/mcp-server.js`. |',
  ].join('\n');

  for (const width of [120, 100, 90, 72, 60, 40]) {
    it(`never exceeds the terminal at ${width} columns`, () => {
      for (const line of renderMarkdown(md, width).split('\n')) {
        assert.ok(
          visibleWidth(line) <= width,
          `${visibleWidth(line)} > ${width}: ${JSON.stringify(strip(line))}`,
        );
      }
    });
  }

  it('every row of the box is the same width', () => {
    // The zig-zag right border was this, twice, from padding strings that
    // carried escapes.
    const widths = new Set(
      renderMarkdown(md, 90).split('\n').filter((l) => strip(l).trim()).map(visibleWidth),
    );
    assert.strictEqual(widths.size, 1, [...widths].join(','));
  });

  it('keeps every cell\'s text, wrapped rather than cut', () => {
    const flat = strip(renderMarkdown(md, 90)).replace(/[│┌┐└┘├┤┬┴─]/g, ' ').replace(/\s+/g, ' ');
    assert.ok(flat.includes('Root-Cause'), flat);
    assert.ok(flat.includes('1929-1951'), flat);
  });

  it('the cache does not serve one width\'s answer at another', () => {
    const at72 = renderMarkdown(md, 72);
    const at120 = renderMarkdown(md, 120);
    assert.notStrictEqual(at72, at120);
    assert.strictEqual(renderMarkdown(md, 72), at72, 'a repeat must still hit the cache');
  });
});

describe('wrapAnsi at an exact fit (v7.10)', () => {
  it('a cell exactly as wide as its column is one line', () => {
  assert.deepEqual(wrapAnsi('3.1 Flash-Lite', 14), ['3.1 Flash-Lite']);
  assert.deepEqual(wrapAnsi('abc defg', 7), ['abc', 'defg'], 'one more column still wraps');
  assert.deepEqual(wrapAnsi('\x1b[1mbold text\x1b[0m', 9).length, 1, 'escapes cost nothing');
  });
});

describe('rows are told apart only when one wraps (v8.0, option C)', () => {
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  it('a table of one-line rows has no rule between them', () => {
    const out = strip(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', 60));
    assert.doesNotMatch(out, /┄|═/);
    assert.match(out, /├/);
  });
  it('a wrapped row puts a dotted rule between rows and a double one under the header', () => {
    const long = 'word '.repeat(30).trim();
    const out = strip(renderMarkdown(`| a | b |\n|---|---|\n| 1 | ${long} |\n| 3 | 4 |\n| 5 | 6 |`, 60));
    assert.equal((out.match(/^├┄/gm) || []).length, 2, 'one between each pair of rows');
    assert.equal((out.match(/^╞═/gm) || []).length, 1);
    for (const l of out.split('\n')) assert.ok(visibleWidth(l) <= 60, l);
  });
});
