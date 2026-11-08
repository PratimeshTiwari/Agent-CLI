/**
 * CLAUDE.md stays short.
 *
 * Claude Code loads a CLAUDE.md up to 150,000 characters, and this file once
 * reached 167.9k and 150,968 by adding a paragraph per feature. On 2026-11-09
 * it was cut to the rules (about 35k): the stories moved word for word to
 * docs/design/<area>.md and the whole old file to docs/old-claude.md.
 *
 * The cap is this project's own, far under Claude Code's: a feature adds a
 * line or two to its area in CLAUDE.md, and its story (what was reported,
 * tried and measured) goes to its design file and docs/CHANGELOG.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CAP = 45_000;

test('CLAUDE.md stays short: rules here, stories in docs/design/', () => {
  const size = [...readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')].length;
  assert.ok(size <= CAP,
    `CLAUDE.md is ${size.toLocaleString()} characters; keep it under ${CAP.toLocaleString()} — `
      + 'move the story (what was reported, tried, measured) to its docs/design/<area>.md');
});

test('every design file CLAUDE.md links to exists', () => {
  const text = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  const links = [...text.matchAll(/\]\((docs\/[^)#]+)/g)].map((m) => m[1]);
  assert.ok(links.length > 10, 'expected CLAUDE.md to link its design files');
  for (const link of links) {
    assert.doesNotThrow(() => readFileSync(join(ROOT, link.replace(/\/$/, '/README.md'))), `${link} is missing`);
  }
});
