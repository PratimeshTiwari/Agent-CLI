/**
 * `~/.agent/settings.json` — per-person settings (the theme, first).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadUserSettings, saveUserSettings } from '../../src/core/user-settings.js';

function withHome(t) {
  const prev = process.env.AGENT_CLI_HOME;
  const home = mkdtempSync(join(tmpdir(), 'usettings-'));
  process.env.AGENT_CLI_HOME = home;
  t.after(() => { process.env.AGENT_CLI_HOME = prev; });
  return home;
}

test('missing file reads as empty', (t) => {
  withHome(t);
  assert.deepEqual(loadUserSettings(), {});
});

test('a write merges and keeps keys it does not own', (t) => {
  const home = withHome(t);
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ someday: 'kept' }));
  assert.equal(saveUserSettings({ theme: 'dark' }), true);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')), { someday: 'kept', theme: 'dark' });
  assert.equal(loadUserSettings().theme, 'dark');
});

test('a corrupt or non-object file reads as empty rather than throwing', (t) => {
  const home = withHome(t);
  writeFileSync(join(home, 'settings.json'), '{not json');
  assert.deepEqual(loadUserSettings(), {});
  writeFileSync(join(home, 'settings.json'), '["dark"]');
  assert.deepEqual(loadUserSettings(), {});
});
