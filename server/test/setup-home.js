/**
 * Preloaded into every test process (`node --import ./test/setup-home.js`).
 *
 * Points the agent's home directory at a throwaway temp dir before any test
 * runs. Without it, every test that builds an `AgentLoop` or a `SessionStore`
 * against a temp workspace still wrote that workspace's durable history copy
 * to `paths.workspaceHomeDir()` — which is the real `~/.agent/workspaces/`.
 * Found on 2026-10-19 holding **3,238** `resume-*`, `parsecap-*` and
 * `thread-*` folders, twelve more per `npm test`.
 *
 * Unconditional, on purpose: a developer with `AGENT_CLI_HOME` exported in
 * their shell is pointing it at a home they use, and tests must not write
 * there either.
 *
 * Tests that need their own home still set the variable — and must *restore*
 * it afterwards rather than delete it, or every later test in the same file
 * falls back to the real one. `test/backend/core/test-home.test.js` enforces both.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every test process gets a temp dir of its own, first (v8.7). On Linux the
// system one is the shared /tmp: a test that left a `.agent` there was found
// by every other test's upward walk, and eighteen failed in CI reading each
// other's skills, logs and artifacts. os.tmpdir() reads TMPDIR on each call, so
// everything below, and every test, makes its scratch folders in here, and
// they go when the process ends instead of piling up (~400 a run).
const tmp = mkdtempSync(join(tmpdir(), 'agent-test-tmp-'));
process.env.TMPDIR = tmp;

const home = mkdtempSync(join(tmpdir(), 'agent-test-home-'));
process.env.AGENT_CLI_HOME = home;

process.on('exit', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
