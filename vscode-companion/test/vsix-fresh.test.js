/**
 * The committed .vsix holds the sources beside it.
 *
 * The VSIX is what people install, and only the newest is tracked. A change to
 * extension.js, chat-panel.js or the Chrome side panel it copies in, without
 * `vsce package`, ships nothing (v8.7, run by CI on every push). Read with
 * `unzip`, which macOS and the CI runners both have.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = path.join(__dirname, '..');
const pkg = require('../package.json');
const vsix = path.join(HERE, `${pkg.name}-${pkg.version}.vsix`);

const inVsix = (entry) => execFileSync('unzip', ['-p', vsix, `extension/${entry}`], { maxBuffer: 1 << 26 });

test('exactly one .vsix is committed, and it is this version', () => {
  const found = fs.readdirSync(HERE).filter((f) => f.endsWith('.vsix'));
  assert.deepEqual(found, [path.basename(vsix)], 'repackage after a version bump, and delete the old .vsix');
});

test('the .vsix holds the current sources', () => {
  const pairs = [
    ['extension.js', 'extension.js'],
    ['chat-panel.js', 'chat-panel.js'],
    ['chat-panel-html.js', 'chat-panel-html.js'],
    ['media/vscode-shim.js', 'media/vscode-shim.js'],
    // Copied in at package time by scripts/sync-panel.js.
    ['media/panel/panel.js', '../extension/side-panel/panel.js'],
    ['media/panel/panel.html', '../extension/side-panel/panel.html'],
    ['media/panel/panel.css', '../extension/side-panel/panel.css'],
  ];
  const stale = pairs.filter(([entry, src]) => !inVsix(entry).equals(fs.readFileSync(path.join(HERE, src))));
  assert.deepEqual(stale.map(([e]) => e), [],
    'the .vsix is stale — run `npx @vscode/vsce package --allow-missing-repository --skip-license` in vscode-companion/');
});
