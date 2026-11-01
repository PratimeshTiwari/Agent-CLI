/**
 * The `/` suggestion list never wraps a row.
 *
 * Each row is charged one row of the live frame. `/subagents`'s description
 * was long enough to wrap at 80 columns, so typing `/` drew a row nobody had
 * charged for and cost a full clear at 13 rows (pty, 2026-10-26). Truncating
 * the row fixes every description, including the next long one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/frontend/components/InputBar.jsx', import.meta.url), 'utf8');

test('a suggestion row truncates instead of wrapping', () => {
  const at = src.indexOf('slashMatches.map(');
  assert.ok(at > -1, 'control: the list exists');
  const row = src.slice(at, src.indexOf('</Text>', at));
  assert.match(row, /wrap="truncate"/);
});
