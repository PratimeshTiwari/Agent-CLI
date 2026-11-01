/**
 * The version badge on `chrome://extensions` is not evidence.
 *
 * On 2026-09-24 it read **1.25.0** while the loaded copy still carried
 * `github.com/*` site access — a permission removed from the manifest on
 * 2026-09-19. Six `model_options_unanswered` failures were investigated as a
 * broken picker selector; the selectors were provably fine and the build was
 * three weeks stale. A manifest number is something a person typed;
 * `chrome.runtime.getManifest()` is what Chrome is running.
 *
 * The negative controls are the point of this file. A staleness check that
 * fires when it has no information is one people learn to ignore, which costs
 * more than the staleness it exists to catch.
 */
import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { extensionVersionNotice, expectedExtensionVersion, selfReloadNotice, SELF_RELOAD_SINCE } from '../../../../src/backend/core/install/extension-version.js';

describe('expectedExtensionVersion', () => {
  /*
   * Resolved from the module's own location, not the workspace: the agent is
   * usually pointed at some other project, and the extension that matters is
   * the one beside the server that is running.
   */
  test('is the manifest in this checkout, not a hardcoded string', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(
      readFileSync(resolve(here, '../../../../../extension/manifest.json'), 'utf8'),
    );
    assert.equal(expectedExtensionVersion(), manifest.version);
  });
});

describe('extensionVersionNotice', () => {
  test('agreement is silence', () => {
    assert.equal(extensionVersionNotice('1.26.0', '1.26.0'), null);
  });

  test('a disagreement names both sides and what to do', () => {
    const msg = extensionVersionNotice('1.25.0', '1.26.0');
    assert.match(msg, /1\.25\.0/);
    assert.match(msg, /1\.26\.0/);
    assert.match(msg, /chrome:\/\/extensions/);
    assert.equal(msg, '⚠ Extension update · 1.25.0 → 1.26.0 · reload at chrome://extensions');
    assert.ok(msg.length <= 76, 'one line at 80 columns, not a paragraph');
  });

  /*
   * The case it was written for. Every build before 1.26.0 sends
   * `{clientType: 'extension'}` and nothing else — so silence is the only
   * reading available for precisely the builds old enough to be the problem.
   */
  test('no version reported is a version older than the check itself', () => {
    const msg = extensionVersionNotice(undefined, '1.26.0');
    assert.match(msg, /unknown → 1\.26\.0/);
    assert.match(msg, /1\.26\.0/);
    assert.match(msg, /chrome:\/\/extensions/);
    assert.equal(extensionVersionNotice(null, '1.26.0'), msg, 'null and undefined read the same');
  });

  // No source tree beside the server — an installed copy, a packed release.
  // No opinion, never "mismatch".
  test('nothing to compare against says nothing at all', () => {
    assert.equal(extensionVersionNotice('1.25.0', null), null);
    assert.equal(extensionVersionNotice(undefined, null), null);
  });

  test('the comparison is by value, not by type', () => {
    assert.equal(extensionVersionNotice(1.26, '1.26'), null);
  });
});

describe('shortcutNotice — the global shortcut nobody bound', async () => {
  const { shortcutNotice } = await import('../../../../src/backend/core/install/extension-version.js');
  test('an empty binding is explained, with where to fix it', () => {
    const n = shortcutNotice('');
    assert.match(n, /chrome:\/\/extensions\/shortcuts/);
    assert.match(n, /Global/);
  });
  test('a bound key, or an older build that reports nothing, says nothing', () => {
    assert.equal(shortcutNotice('⌘⇧1'), null);
    assert.equal(shortcutNotice(undefined), null);
    assert.equal(shortcutNotice(null), null, 'could not read it is not the same as unbound');
  });
});

test('an extension newer than the agent asks for a restart, not an "update" to a lower version (v7.9)', async () => {
  const { extensionVersionNotice, compareVersions } = await import('../../../../src/backend/core/install/extension-version.js');
  assert.equal(compareVersions('1.55.0', '1.54.0'), 1);
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1, 'numeric, not string, order');
  assert.equal(compareVersions('1.54', '1.54.0'), 0);
  assert.match(extensionVersionNotice('1.55.0', '1.54.0'), /^⚠ Agent restart needed · extension 1\.55\.0, this agent expects 1\.54\.0/);
  assert.match(extensionVersionNotice('1.42.0', '1.54.0'), /Extension update · 1\.42\.0 → 1\.54\.0/, 'control: older still says update');
});

describe('selfReloadNotice (v8.1)', () => {
  it('an older build that has the handler is reloaded from here', () => {
    assert.deepEqual(selfReloadNotice('1.58.0', '1.59.0'), { to: '1.59.0', message: '↻ Extension updated · 1.58.0 → 1.59.0' });
  });
  it('a build before the handler, a current one, a newer one or no version: no', () => {
    assert.equal(selfReloadNotice('1.57.0', '1.59.0'), null, 'it would ignore the message');
    assert.equal(selfReloadNotice('1.59.0', '1.59.0'), null);
    assert.equal(selfReloadNotice('1.60.0', '1.59.0'), null, 'the agent is the stale one');
    assert.equal(selfReloadNotice(null, '1.59.0'), null);
    assert.equal(selfReloadNotice('1.58.0', null), null);
  });
  it('the build that brought the handler is the one the constant names', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../../../../../extension/src/background/socket.js'), 'utf8');
    assert.match(src, /case 'reload_extension':\s*\n\s*chrome\.runtime\.reload\(\);/);
    assert.equal(SELF_RELOAD_SINCE, '1.58.0');
  });
});
