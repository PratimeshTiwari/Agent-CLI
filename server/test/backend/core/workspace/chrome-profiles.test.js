import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeDataDir, chromeLaunch, EXTENSION_DIR, listChromeProfiles, openChromeProfile } from '../../../../src/backend/core/workspace/chrome-profiles.js';

function chrome() {
  const dataDir = mkdtempSync(join(tmpdir(), 'chrome-'));
  writeFileSync(join(dataDir, 'Local State'), JSON.stringify({ profile: { info_cache: {
    Default: { name: 'Main', user_name: 'main@x.com' },
    'Profile 2': { name: 'Zed', user_name: '' },
    'Profile 3': { name: 'Broken' },
  } } }));
  for (const dir of ['Default', 'Profile 2']) mkdirSync(join(dataDir, dir));
  writeFileSync(join(dataDir, 'Default/Secure Preferences'), JSON.stringify({ extensions: { settings: { a: { path: '/other' } } } }));
  writeFileSync(join(dataDir, 'Profile 2/Secure Preferences'), JSON.stringify({ extensions: { settings: { a: { path: '/x/extension' } } } }));
  return dataDir;
}

test('profiles come from Chrome, the ones with the extension first', () => {
  const list = listChromeProfiles({ dataDir: chrome(), extensionDir: '/x/extension' });
  assert.deepEqual(list.map((p) => [p.dir, p.name, p.email, p.hasExtension]), [
    ['Profile 2', 'Zed', '', true],
    ['Profile 3', 'Broken', '', false],
    ['Default', 'Main', 'main@x.com', false],
  ]);
});

test('no Chrome is an empty list, not a throw', () => {
  assert.deepEqual(listChromeProfiles({ dataDir: '/no/such/dir' }), []);
});

test('the data folder on each system', () => {
  assert.match(chromeDataDir({ platform: 'darwin', home: '/h' }), /Library\/Application Support\/Google\/Chrome$/);
  assert.equal(chromeDataDir({ platform: 'linux', home: '/h' }), '/h/.config/google-chrome');
  assert.match(chromeDataDir({ platform: 'win32', home: '/h', env: { LOCALAPPDATA: 'C:/L' } }), /User Data$/);
});

test('EXTENSION_DIR is the folder a person loads', () => {
  assert.match(EXTENSION_DIR, /\/extension$/);
});

test('it opens the named profile, through no shell, inheriting nothing', () => {
  assert.deepEqual(chromeLaunch('Profile 2', 'u', { platform: 'darwin' }), {
    cmd: 'open', args: ['-na', 'Google Chrome', '--args', '--profile-directory=Profile 2', 'u'],
  });
  const calls = [];
  const launch = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { on() {}, unref() {} }; };
  assert.equal(openChromeProfile('P; rm -rf /', 'u', { launch, platform: 'linux' }), true);
  assert.equal(calls[0].opts.stdio, 'ignore', "our stderr is Ink's terminal");
  assert.equal(calls[0].opts.shell, undefined);
  assert.equal(calls[0].args[0], '--profile-directory=P; rm -rf /', 'one argument, whatever it holds');
});

test('a launch that throws is false', () => {
  assert.equal(openChromeProfile('P', 'u', { launch: () => { throw new Error('no'); } }), false);
});
