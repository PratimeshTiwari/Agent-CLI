import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashedShapes, promptShapes } from './prompt-golden-shapes.js';
import { clearPromptCache } from '../../src/core/prompt-loader.js';
import { PROMPT_VERSIONS } from '../../src/core/prompt-versions.js';

/*
 * Prompt v1 is frozen (v5.32). The point of a selectable prompt version is a
 * fixed baseline to measure a newer one against; one that drifts with every
 * edit compares nothing. So every shape the builder produces under v1 —
 * turn 0, short, refresh, redeclare and warm-up for each effort × mode ×
 * subagents, the handovers, a tool-results batch, the subagent wrappers and
 * the compaction prompt — is hashed against what v5.31 sent.
 *
 * A failure here means a change reached v1. Put it in a newer version instead
 * (core/prompt-versions.js: a file under prompts/<dir>/, or a flag).
 */

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'fixtures', 'prompt-v1-golden.json'), 'utf8'));

test('v1 is byte-identical to the frozen baseline, every shape', () => {
  const now = hashedShapes({});
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort(), 'the set of shapes changed');
  const moved = Object.keys(golden).filter((k) => now[k] !== golden[k]);
  assert.deepEqual(moved, [], `v1 changed in: ${moved.join(', ')}`);
  assert.ok(Object.keys(golden).length >= 90);
});

test('naming v1 explicitly is the same as the default', () => {
  assert.deepEqual(hashedShapes({ version: 'v1' }), golden);
});

test('negative control: a file override under a newer version moves its shapes and leaves v1 alone', (t) => {
  // v2 overrides by directory; plant one override and watch only v2 change.
  const dir = join(here, '..', '..', 'src', 'prompts', PROMPT_VERSIONS.v2.dir);
  const file = join(dir, 'core-terse.md');
  let existed = true;
  try { readFileSync(file); } catch { existed = false; }
  if (existed) return t.skip('v2 already overrides core-terse.md');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, 'OVERRIDDEN FOR THE CONTROL\n');
  t.after(() => { rmSync(file, { force: true }); clearPromptCache(); });
  clearPromptCache();
  const v2 = promptShapes({ version: 'v2' });
  assert.ok(Object.values(v2).some((text) => text.includes('OVERRIDDEN FOR THE CONTROL')), 'the override never reached a prompt');
  clearPromptCache();
  assert.deepEqual(hashedShapes({ version: 'v1' }), golden, 'v1 must not see v2\'s file');
});
