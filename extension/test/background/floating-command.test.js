/**
 * The global shortcut opens the floating window — once.
 *
 * It fires from any app while Chrome runs. Pressing it twice must focus the
 * window it opened, not stack a second one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function stubChrome(windows = []) {
  const log = [];
  globalThis.chrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
    windows: {
      getAll: async () => windows,
      update: async (id, props) => { log.push(['update', id, props]); },
      create: async (props) => { log.push(['create', props]); },
    },
  };
  return log;
}

const load = () => import(`../../src/background/floating.js?${Math.random()}`);

test('with no floating window, the shortcut opens one', async () => {
  const log = stubChrome([{ id: 1, tabs: [{ url: 'https://gemini.google.com/app' }] }]);
  const { handleCommand, FLOATING_COMMAND } = await load();
  assert.equal(await handleCommand(FLOATING_COMMAND), 'created');
  assert.equal(log[0][0], 'create');
  assert.equal(log[0][1].url, 'chrome-extension://abc/side-panel/panel.html?window=1', 'the same page the ⧉ button opens');
  assert.equal(log[0][1].type, 'popup');
});

test('with one open, it is focused, not duplicated', async () => {
  const log = stubChrome([{ id: 9, tabs: [{ url: 'chrome-extension://abc/side-panel/panel.html?window=1' }] }]);
  const { handleCommand, FLOATING_COMMAND } = await load();
  assert.equal(await handleCommand(FLOATING_COMMAND), 'focused');
  assert.deepEqual(log, [['update', 9, { focused: true, drawAttention: true }]]);
});

test('another command is not ours', async () => {
  const log = stubChrome();
  const { handleCommand } = await load();
  assert.equal(handleCommand('something-else'), null);
  assert.deepEqual(log, []);
});

test('a failure is reported, never thrown into the worker', async () => {
  stubChrome();
  globalThis.chrome.windows.getAll = async () => { throw new Error('no windows API'); };
  const { openFloatingPanel } = await load();
  assert.equal(await openFloatingPanel(), 'failed');
});

test('the manifest declares it global, on a key Chrome allows for global commands', async () => {
  const { FLOATING_COMMAND } = await load();
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));
  const cmd = manifest.commands?.[FLOATING_COMMAND];
  assert.ok(cmd, `manifest has no "${FLOATING_COMMAND}" command`);
  assert.equal(cmd.global, true);
  // Chrome only suggests Ctrl+Shift+[0-9] for global commands; anything else is silently dropped.
  assert.match(cmd.suggested_key.default, /^Ctrl\+Shift\+[0-9]$/);
  assert.equal(cmd.suggested_key.mac, undefined, "Ctrl already means ⌘ on a Mac; a separate mac key is one more string to get wrong");
});

test('the worker routes commands to it', () => {
  const main = readFileSync(resolve(ROOT, 'src/background/main.js'), 'utf8');
  assert.match(main, /chrome\.commands\?\.onCommand\.addListener\(\(command\) => \{ handleCommand\(command\); \}\)/);
});

test('the binding is reported: the key, empty when unbound, null when unreadable', async () => {
  const { floatingShortcut, FLOATING_COMMAND } = await load();
  stubChrome();
  globalThis.chrome.commands = { getAll: async () => [{ name: FLOATING_COMMAND, shortcut: '⌘⇧1' }] };
  assert.equal(await floatingShortcut(), '⌘⇧1');
  // Chrome's state after a reload of an already-installed unpacked extension.
  globalThis.chrome.commands = { getAll: async () => [{ name: FLOATING_COMMAND, shortcut: '' }] };
  assert.equal(await floatingShortcut(), '');
  globalThis.chrome.commands = { getAll: async () => { throw new Error('no commands API'); } };
  assert.equal(await floatingShortcut(), null);
});

test('identify carries the binding', () => {
  const socket = readFileSync(resolve(ROOT, 'src/background/socket.js'), 'utf8');
  // Read before the send (the onopen awaits must finish before it checks the
  // socket is still the current one), then carried on the payload.
  assert.match(socket, /const shortcut = await floatingShortcut\(\);/);
  assert.match(socket, /floatingShortcut: shortcut,/);
});
