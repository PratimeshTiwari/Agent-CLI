/*
 * Replies are wrapped by us, to the width beside the `●` (v6.12).
 *
 * Reported with three screenshots: a reply whose wrapped rows spilled one
 * character onto a row of their own (`you` / `r`), bullets whose second row ran
 * back under the `◦`, and ~20 blank rows between a long reply and the prompt.
 * One cause for the first and third: Yoga shrank the 2-column dot to 1, so the
 * reply was laid out a column wider than the terminal; Ink counted rows the
 * terminal then wrapped again, and the frame arithmetic left the gap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitLines, renderMarkdown, visibleWidth } from '../../src/frontend/format.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const words = (n, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

test('no rendered row is wider than the width it was given', () => {
  const md = `${words(60)}\n\n- **Lead:** \`a/b.js\` ${words(40, 'item')}\n  - nested ${words(30, 'deep')}\n\n1. ${words(30, 'step')}\n\n| a | b |\n|---|---|\n| x | ${words(40, 'cell')} |`;
  for (const width of [40, 68, 100]) {
    const rows = renderMarkdown(md, width).split('\n');
    const wide = rows.filter((r) => visibleWidth(r) > width);
    assert.deepEqual(wide, [], `at ${width}`);
  }
});

test('a wrapped bullet hangs under its text, not under the marker', () => {
  const rows = strip(renderMarkdown(`- ${words(30, 'item')}\n- short`, 40)).split('\n').filter(Boolean);
  assert.match(rows[0], /^◦ item0/);
  assert.match(rows[1], /^ {2}item\d/, 'continuation at the text column');
  assert.ok(rows.some((r) => r === '◦ short'));
  const ordered = strip(renderMarkdown(`1. ${words(30, 'step')}`, 40)).split('\n').filter(Boolean);
  assert.match(ordered[1], /^ {3}step\d/, 'past "1. "');
  const nested = strip(renderMarkdown(`- top\n  - ${words(30, 'deep')}`, 40)).split('\n').filter(Boolean);
  assert.match(nested[1], /^ {2}◦ deep0/);
  assert.match(nested[2], /^ {4}deep\d/);
});

test('continuation rows never open with the space they broke at', () => {
  for (const row of strip(fitLines(words(50), 30)).split('\n')) assert.doesNotMatch(row, /^ /);
});

test('colour survives the wrap and code blocks are never re-wrapped', () => {
  const bold = fitLines(`\x1b[1m${words(20)}\x1b[22m`, 30);
  assert.equal(strip(bold).split('\n').length > 1, true);
  assert.ok(bold.startsWith('\x1b[1m'));
  const code = `\`\`\`js\nconst x = "${'y'.repeat(120)}";\n\`\`\``;
  assert.ok(renderMarkdown(code, 40).includes('y'.repeat(120)), 'a code line is copied whole');
});

test('the dot beside a reply cannot shrink', () => {
  const src = readFileSync(new URL('../../src/frontend/components/TranscriptTurn.jsx', import.meta.url), 'utf8');
  assert.match(src, /<Box flexShrink=\{0\}><Text bold>● <\/Text><\/Box>/);
  assert.match(src, /renderMarkdown\(item\.content, textWidth\)/);
});
