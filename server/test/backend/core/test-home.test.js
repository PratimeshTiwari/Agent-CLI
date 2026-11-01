/**
 * The test suite must never write to the real `~/.agent`.
 *
 * It did, for weeks: 3,238 leaked workspace folders by 2026-10-19. The fix is
 * `test/setup-home.js`, preloaded by the `test` script. These assertions are
 * what keep it fixed, because the regression is silent — a leaked folder
 * fails nothing, it just accumulates.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDir } from '../../../src/backend/core/paths.js';

const TEST_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the agent home resolves to a temp dir, never the real ~/.agent', () => {
  assert.notEqual(homeDir(), join(homedir(), '.agent'));
  // realpath on both sides: macOS tmpdir() is a /var → /private/var symlink.
  assert.ok(
    realpathSync(homeDir()).startsWith(realpathSync(tmpdir())),
    `home is ${homeDir()} — is the test script still preloading test/setup-home.js?`,
  );
});

test('no test deletes the home override instead of restoring it', () => {
  // Built from parts so this file does not match its own scan.
  const bare = ['delete', 'process.env.AGENT_CLI_HOME'].join(' ');
  const restored = /===\s*undefined\)\s*delete process\.env\.AGENT_CLI_HOME/;

  const offenders = [];
  for (const rel of readdirSync(TEST_ROOT, { recursive: true })) {
    if (!String(rel).endsWith('.js')) continue;
    const lines = readFileSync(join(TEST_ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(bare) && !restored.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'restore the saved value; deleting it points later tests at the real ~/.agent');
});

/*
 * The same leak one level down (v7.9): a stub loop with `workspace:
 * process.cwd()` writes into *this checkout's* `.agent/` — the suite runs in
 * `server/`, so the walk up found the repo's `.agent/` and filed everything
 * under a `server` scope. Compaction's tests grew a 4 MB archive there.
 */
test('no test hands the agent this checkout as its workspace', () => {
  const bare = ['workspace:', 'process.cwd()'].join(' ');
  const offenders = [];
  for (const rel of readdirSync(TEST_ROOT, { recursive: true })) {
    if (!String(rel).endsWith('.js')) continue;
    const lines = readFileSync(join(TEST_ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => { if (line.includes(bare)) offenders.push(`${rel}:${i + 1}`); });
  }
  assert.deepEqual(offenders, [], 'use a mkdtempSync workspace');
});
