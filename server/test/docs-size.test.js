/**
 * CLAUDE.md stays loadable.
 *
 * Claude Code loads a CLAUDE.md up to 150,000 characters. Past that the file
 * this project relies on to carry its rules is cut, silently. It reached
 * 167.9k once (moved out to docs/history.md on 2026-10-25) and 150,968 in
 * v8.4, unnoticed until a review in v8.7. A paragraph that records *what
 * happened* belongs in docs/history.md; this file keeps what governs the code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const LIMIT = 150_000;
// Room to add a paragraph without the next commit failing the build.
const HEADROOM = 5_000;

test('CLAUDE.md is under the size Claude Code loads, with room to grow', () => {
  const size = [...readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')].length;
  assert.ok(size <= LIMIT - HEADROOM,
    `CLAUDE.md is ${size.toLocaleString()} characters; keep it under ${(LIMIT - HEADROOM).toLocaleString()} — `
      + 'move history (what was measured, what was tried) to docs/history.md');
});
