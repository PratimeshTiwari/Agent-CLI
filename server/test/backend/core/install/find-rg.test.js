import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRg, rgOnPath, editorCandidates } from '../../../../src/backend/core/install/find-rg.js';

/*
 * The work laptop has no Homebrew, and every VS Code ships ripgrep. These pin
 * the order: AGENT_RG, then a real rg on PATH, then the editors' bundles.
 */

function fakeHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'rg-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function place(file) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '#!/bin/sh\n');
  return file;
}

test('VS Code\'s bundled ripgrep is found when there is none on PATH', (t) => {
  const home = fakeHome(t);
  const vscode = join(home, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app',
    'node_modules.asar.unpacked', '@vscode', 'ripgrep-universal', 'bin', 'darwin-arm64', 'rg');
  place(vscode);
  const found = findRg({ fresh: true, env: { PATH: join(home, 'empty') }, platform: 'darwin', arch: 'arm64', home, appDirs: [join(home, 'Applications')] });
  assert.deepEqual(found, { path: vscode, source: 'Visual Studio Code' });
});

test('Cursor\'s older layout is found too', (t) => {
  const home = fakeHome(t);
  const cursor = place(join(home, 'Applications', 'Cursor.app', 'Contents', 'Resources', 'app',
    'node_modules', '@vscode', 'ripgrep', 'bin', 'rg'));
  const found = findRg({ fresh: true, env: { PATH: '' }, platform: 'darwin', arch: 'x64', home, appDirs: [join(home, 'Applications')] });
  assert.equal(found?.path, cursor);
  assert.equal(found?.source, 'Cursor');
});

test('a real rg on PATH wins over an editor copy, and AGENT_RG over both', (t) => {
  const home = fakeHome(t);
  place(join(home, 'Applications', 'Cursor.app', 'Contents', 'Resources', 'app', 'node_modules', '@vscode', 'ripgrep', 'bin', 'rg'));
  const onPath = place(join(home, 'bin', 'rg'));
  assert.equal(findRg({ fresh: true, env: { PATH: join(home, 'bin') }, platform: 'darwin', home })?.source, 'path');
  const pinned = place(join(home, 'mine', 'rg'));
  assert.deepEqual(findRg({ fresh: true, env: { PATH: join(home, 'bin'), AGENT_RG: pinned }, platform: 'darwin', home }),
    { path: pinned, source: 'env' });
  assert.equal(rgOnPath({ env: { PATH: join(home, 'bin') }, platform: 'darwin' }), onPath);
});

test('nothing anywhere is null, and a directory named rg is not a binary', (t) => {
  const home = fakeHome(t);
  mkdirSync(join(home, 'bin', 'rg'), { recursive: true });
  assert.equal(findRg({ fresh: true, env: { PATH: join(home, 'bin') }, platform: 'darwin', home, appDirs: [join(home, 'Applications')] }), null);
});

test('this machine\'s architecture is looked for first', () => {
  const arm = editorCandidates({ platform: 'darwin', arch: 'arm64', home: '/h' }).map((c) => c.path);
  assert.ok(arm[0].includes('darwin-arm64'));
  const intel = editorCandidates({ platform: 'darwin', arch: 'x64', home: '/h' }).map((c) => c.path);
  assert.ok(intel[0].includes('darwin-x64'));
});
