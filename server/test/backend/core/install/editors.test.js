import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  COMPANION_ID, companionSettled, companionVsix, findEditors, installCompanion, isOutdated, readCompanion, readEditors,
} from '../../../../src/backend/core/install/editors.js';

const listing = (v) => `other.ext@1.0.0\n${v ? `${COMPANION_ID}@${v}\n` : ''}`;
const cursor = { id: 'cursor', name: 'Cursor', cli: '/bin/cursor' };

describe('findEditors', () => {
  const on = (...paths) => (p) => paths.includes(p);
  const mac = { platform: 'darwin', home: '/Users/x', env: { PATH: '/usr/bin:/shims' } };

  test('an app bundle is found with no command on PATH', () => {
    const cli = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    assert.deepEqual(findEditors({ ...mac, exists: on(cli) }), [{ id: 'code', name: 'VS Code', cli }]);
  });

  test('Antigravity IDE is found where it really is, under its own name', () => {
    const cli = '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide';
    assert.deepEqual(findEditors({ ...mac, exists: on(cli) }).map((e) => e.name), ['Antigravity IDE']);
  });

  test('an app with no command at that path is not offered', () => {
    assert.deepEqual(findEditors({ ...mac, exists: on('/Applications/Antigravity.app') }), []);
  });

  test('the home folder and PATH count too, and the bundle comes first', () => {
    const home = '/Users/x/.antigravity-ide/antigravity-ide/bin/antigravity-ide';
    assert.equal(findEditors({ ...mac, exists: on(home) })[0].cli, home);
    assert.equal(findEditors({ ...mac, exists: on('/shims/cursor') })[0].cli, '/shims/cursor');
    const app = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
    assert.equal(findEditors({ ...mac, exists: on(app, '/shims/cursor') })[0].cli, app);
  });

  test('Linux has no bundles, Windows no PATH: a .cmd needs a shell', () => {
    const opts = { home: '/h', env: { PATH: '/shims' }, exists: on('/shims/code') };
    assert.equal(findEditors({ ...opts, platform: 'linux' }).length, 1);
    assert.deepEqual(findEditors({ ...opts, platform: 'win32' }), []);
  });

  // Every real place at once, PATH included. An empty PATH here is how this test
  // once passed while a harness run installed into the real Antigravity IDE.
  const REAL = [
    '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    '/Users/x/.antigravity-ide/antigravity-ide/bin/antigravity-ide',
    '/real/bin/antigravity-ide',
    '/real/bin/code',
  ];

  test('negative control: without the override every one of them is found', () => {
    const got = findEditors({ ...mac, env: { PATH: '/real/bin' }, exists: on(...REAL) });
    assert.deepEqual(got.map((e) => e.id), ['code', 'cursor', 'antigravity-ide']);
  });

  test('AGENT_EDITOR_APPS set to nothing reaches none of them', () => {
    assert.deepEqual(findEditors({ ...mac, env: { AGENT_EDITOR_APPS: '', PATH: '/real/bin' }, exists: on(...REAL) }), []);
    assert.equal(process.env.AGENT_EDITOR_APPS, '', 'setup-home sets it');
  });

  test('set to a folder, only that folder counts', () => {
    const env = { AGENT_EDITOR_APPS: '/fakes', PATH: '/real/bin' };
    const got = findEditors({ ...mac, env, exists: on(...REAL, '/fakes/cursor') });
    assert.deepEqual(got, [{ id: 'cursor', name: 'Cursor', cli: '/fakes/cursor' }]);
  });
});

describe('the version an editor reports', () => {
  test('read, not installed, and could not say are three answers', async () => {
    assert.equal((await readCompanion(cursor, { run: async () => ({ stdout: listing('1.8.13') }) })).version, '1.8.13');
    const none = await readCompanion(cursor, { run: async () => ({ stdout: listing(null) }) });
    assert.deepEqual([none.read, none.version], [true, null]);
    const failed = await readCompanion(cursor, { run: async () => { throw new Error('boom\nstack'); } });
    assert.deepEqual([failed.read, failed.error], [false, 'boom']);
  });

  test('editors are read with no shell, and one failing does not lose the rest', async () => {
    const run = async (cli, args, opts) => {
      assert.deepEqual(args, ['--list-extensions', '--show-versions']);
      assert.equal(opts.shell, undefined);
      if (cli === '/bin/bad') throw new Error('no');
      return { stdout: listing('1.0.0') };
    };
    const got = await readEditors([cursor, { id: 'x', name: 'X', cli: '/bin/bad' }], { run });
    assert.deepEqual(got.map((e) => e.read), [true, false]);
  });
});

describe('installing', () => {
  const vsix = { path: '/repo/my stuff/cli-agent-companion-1.8.15.vsix', version: '1.8.15' };

  test('the path is one argument, whatever is in it, and the read-back decides', async () => {
    const calls = [];
    const run = async (_cli, args) => {
      calls.push(args);
      return { stdout: listing('1.8.15') };
    };
    assert.equal((await installCompanion(cursor, vsix, { run })).ok, true);
    assert.deepEqual(calls[0], ['--install-extension', vsix.path, '--force']);
  });

  test('exit 0 and an old version is not a success', async () => {
    const got = await installCompanion(cursor, vsix, { run: async () => ({ stdout: listing('1.8.13') }) });
    assert.equal(got.ok, false);
    assert.match(got.error, /still reports 1\.8\.13/);
  });

  test('a failed install says why, and reads nothing', async () => {
    let calls = 0;
    const got = await installCompanion(cursor, vsix, { run: async () => { calls += 1; throw Object.assign(new Error('x'), { stderr: 'Failed to install\nat y' }); } });
    assert.deepEqual([got.ok, got.error, calls], [false, 'Failed to install', 1]);
  });
});

describe('when the reminder ends', () => {
  const v = '1.8.15';
  const e = (version, read = true) => ({ read, version });

  test('every editor answered and none is behind', () => {
    assert.equal(companionSettled([e('1.8.15'), e('1.9.0')], v), true);
  });

  test('an editor without it is owed nothing, so nobody is nagged', () => {
    assert.equal(companionSettled([e(null)], v), true);
    assert.equal(companionSettled([], v), true);
  });

  test('one behind keeps it', () => {
    assert.equal(companionSettled([e('1.8.15'), e('1.8.13')], v), false);
    assert.equal(isOutdated(e('1.8.9'), v), true, 'numbers, not strings');
  });

  test('an editor that could not answer is not evidence', () => {
    assert.equal(companionSettled([e(null, false)], v), false);
  });
});

describe('the checkout', () => {
  test('the newest .vsix wins, by number', () => {
    const list = () => ['cli-agent-companion-1.8.9.vsix', 'cli-agent-companion-1.8.15.vsix', 'notes.md'];
    assert.deepEqual(companionVsix({ dir: '/c', list }), { path: path.join('/c', 'cli-agent-companion-1.8.15.vsix'), version: '1.8.15' });
  });

  test('no folder, no vsix, no throw', () => {
    assert.equal(companionVsix({ dir: '/no/such/place' }), null);
    assert.equal(companionVsix({ list: () => [] }), null);
  });

  test('the id and the file are what the companion ships', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../../../vscode-companion/package.json', import.meta.url), 'utf8'));
    assert.equal(COMPANION_ID, `${pkg.publisher}.${pkg.name}`);
    assert.equal(companionVsix().version, pkg.version);
  });
});
