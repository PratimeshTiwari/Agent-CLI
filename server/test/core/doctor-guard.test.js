/**
 * A `/doctor` package change that breaks the next start is put back, once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  snapshotBeforeChange, readRecord, confirmChange, shouldRevert, revertChange, takeRevertNotice, guardFile,
} from '../../src/core/doctor-guard.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  const root = join(dir, 'repo');
  mkdirSync(join(root, 'server'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['server'] }));
  writeFileSync(join(root, 'server', 'package.json'), '{"dependencies":{"ink":"^7.1.1"}}');
  writeFileSync(join(root, 'package-lock.json'), '{"lock":1}');
  const env = { AGENT_CLI_HOME: join(dir, 'home') };
  return { root, env, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a start that breaks after a change puts every manifest and the lockfile back, then says so once', () => {
  const { root, env, done } = setup();
  assert.equal(snapshotBeforeChange({ root, change: 'ink 7.1.1 → 8.0.0', env, pid: 100 }), true);
  writeFileSync(join(root, 'server', 'package.json'), '{"dependencies":{"ink":"^8.0.0"}}');
  writeFileSync(join(root, 'package-lock.json'), '{"lock":2}');

  assert.equal(shouldRevert(1, env, 100), false, 'the session that made the change proves nothing by crashing');
  assert.equal(shouldRevert(0, env, 200), false, 'a clean exit is not a broken start');
  assert.equal(shouldRevert(null, env, 200), false, 'killed by a signal is not a broken start');
  assert.equal(shouldRevert(1, env, 200), true);

  let installedIn = null;
  const r = revertChange({ env, install: (dir) => { installedIn = dir; return { status: 0 }; } });
  assert.deepEqual(r, { ok: true, changes: ['ink 7.1.1 → 8.0.0'] });
  assert.equal(readFileSync(join(root, 'server', 'package.json'), 'utf8'), '{"dependencies":{"ink":"^7.1.1"}}');
  assert.equal(readFileSync(join(root, 'package-lock.json'), 'utf8'), '{"lock":1}');
  assert.equal(installedIn, root);
  assert.equal(shouldRevert(1, env, 300), false, 'never twice: a start that still fails, fails');
  assert.match(takeRevertNotice(env), /^↶ ink 7\.1\.1 → 8\.0\.0 broke the start, so it was undone/);
  assert.equal(takeRevertNotice(env), null);
  done();
});

test('a start that stays up keeps the change; two changes in a row are undone together', () => {
  const { root, env, done } = setup();
  snapshotBeforeChange({ root, change: 'remove ink-spinner', env, pid: 100 });
  writeFileSync(join(root, 'package-lock.json'), '{"lock":2}');
  snapshotBeforeChange({ root, change: 'ink 7.1.1 → 8.0.0', env, pid: 100 });
  assert.deepEqual(readRecord(env).changes, ['remove ink-spinner', 'ink 7.1.1 → 8.0.0']);
  assert.equal(readRecord(env).files['package-lock.json'], '{"lock":1}', 'the copy is of the last state known to start');
  confirmChange(env, 100);
  assert.ok(existsSync(guardFile(env)), 'only a later start confirms');
  confirmChange(env, 200);
  assert.equal(readRecord(env), null);
  done();
});

test('the bin reverts before it passes an exit through', () => {
  const src = readFileSync(new URL('../../src/index.js', import.meta.url), 'utf8');
  const revert = src.indexOf('shouldRevert(result.status, process.env, result.pid)');
  const exit = src.indexOf('process.exit(result.status ?? 0)');
  assert.ok(revert > 0 && revert < exit);
  assert.match(src, /if \(ok\) continue;/);
});
