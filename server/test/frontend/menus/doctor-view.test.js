import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  homeItems, homeCursor, homeStatus, findEntry, packageLines, packageActions, versionItems, versionCursor, jobLine,
  errorLines,
} from '../../../src/frontend/menus/doctor-view.js';

const pkg = (over) => ({
  name: 'ink', range: '^7.1.1', tier: 'required', installed: '7.1.1', status: 'ok',
  why: 'Draws the terminal UI.', without: 'The agent does not start.', ...over,
});
const report = (over = {}) => ({
  groups: [{ workspace: 'server', packages: [
    pkg(),
    pkg({ name: 'unpdf', range: '1.8.1', tier: 'optional', installed: null, status: 'missing', why: 'Reads PDFs.', without: 'read_file fails on PDFs.' }),
    pkg({ name: '@types/react', range: '^19.0.0', tier: 'dev', status: 'ok', installed: '19.0.0' }),
  ] }],
  tools: [
    { name: 'node', tier: 'required', status: 'ok', version: '22.19.0' },
    { name: 'rg', tier: 'optional', status: 'missing', short: 'search is slower' },
  ],
  registry: null,
  ...over,
});

test('home: a fix row when something is wrong, a fine dev package left out, the cursor on the fault', () => {
  const items = homeItems(report());
  assert.deepEqual(items.map((i) => i.key), ['fix', 'server:ink', 'server:unpdf', 'tool:node', 'tool:rg']);
  assert.match(items[2].detail, /^missing\s+optional/);
  assert.match(items[1].detail, /latest …$/, 'the registry has not answered yet');
  assert.match(items[4].label, /^· rg/, 'a missing optional tool is not marked as a fault');
  assert.equal(homeCursor(items), 0);
  assert.equal(homeStatus(report()), '✗ 1 to fix · asking npm for the latest…');
});

test('home status follows the registry', () => {
  const ok = { groups: [{ workspace: 'server', packages: [pkg({ latest: '7.3.0' })] }], tools: [] };
  assert.equal(homeStatus({ ...ok, registry: { ok: true } }), '✔ all installed · 1 with a newer release');
  assert.equal(homeStatus({ ...ok, registry: { ok: false } }), '✔ all installed · latest unknown');
});

test('the package page fits its rows, and never drops the versions', () => {
  const entry = findEntry(report(), { kind: 'package', name: 'unpdf', workspace: 'server' });
  assert.equal(entry.kind, 'package');
  const full = packageLines(entry, { width: 80, rows: 10, importers: ['backend/mcp/tools/documents.js'] });
  assert.match(full.join('\n'), /^Why\s+Reads PDFs\./m);
  assert.match(full.join('\n'), /^Imported by backend\/mcp\/tools\/documents\.js/m);
  for (const rows of [1, 2, 3, 4, 5]) {
    const lines = packageLines(entry, { width: 80, rows, importers: ['a.js'] });
    assert.ok(lines.length <= rows, `${lines.length} lines in ${rows} rows`);
    assert.ok(lines.some((l) => l.startsWith('Versions')), `the versions went at ${rows} rows`);
  }
  assert.ok(packageLines(entry, { width: 30, rows: 9 }).every((l) => l.length <= 28), 'a row wider than the panel wraps');
});

test('actions: install when broken, update only when newer, a version list always, nothing for a tool', () => {
  assert.deepEqual(packageActions({ ...pkg({ status: 'missing', installed: null }), kind: 'package' }).map((a) => a.key), ['fix', 'versions']);
  const behind = packageActions({ ...pkg({ latest: '8.0.0' }), kind: 'package' });
  assert.deepEqual(behind.map((a) => a.key), ['latest', 'versions']);
  assert.match(behind[0].detail, /8\.0\.0 · outside the current range/);
  assert.equal(packageActions({ ...pkg({ latest: '7.3.0' }), kind: 'package' })[0].detail, '7.3.0');
  assert.deepEqual(packageActions({ ...pkg({ latest: '7.1.1' }), kind: 'package' }).map((a) => a.key), ['versions']);
  assert.deepEqual(packageActions({ name: 'rg', kind: 'tool' }), []);
});

test('the version list marks installed, latest and in-range, and starts on the installed one', () => {
  const entry = { ...pkg({ latest: '8.0.0' }), kind: 'package' };
  const versions = ['8.0.0', '7.3.0', '7.1.1', '6.0.0'];
  const items = versionItems(versions, entry);
  assert.deepEqual(items.map((i) => i.detail), ['latest', 'in range', 'installed', undefined]);
  assert.equal(items[2].current, true);
  assert.equal(versionCursor(versions, entry), 2);
  assert.equal(versionCursor(['9.0.0'], entry), 0);
});

test('job lines', () => {
  assert.equal(jobLine(null), null);
  assert.match(jobLine({ state: 'running', name: 'ink', version: '7.3.0' }), /^◌ Installing ink@7\.3\.0/);
  assert.equal(jobLine({ state: 'busy', holder: '/update pull' }), '! /update pull is still running — try again when it finishes');
  assert.equal(jobLine({ state: 'done', name: 'ink', installed: '7.3.0' }), '✔ ink 7.3.0 installed · /restart to load it');
  assert.equal(jobLine({ state: 'done', text: '✔ npm install finished' }), '✔ npm install finished');
});

test('tabs: each tier on its own, tools apart, and a fine dev package only under Other', async () => {
  const { HEALTH_TABS, nextHealthTab, tabCounts } = await import('../../../src/frontend/menus/doctor-view.js');
  const keys = (tab) => homeItems(report(), { tab }).map((i) => i.key);
  assert.deepEqual(keys('required'), ['fix', 'server:ink']);
  assert.deepEqual(keys('optional'), ['fix', 'server:unpdf']);
  assert.deepEqual(keys('other'), ['fix', 'server:@types/react']);
  assert.deepEqual(keys('tools'), ['tool:node', 'tool:rg'], 'npm install does not fix a tool');
  assert.deepEqual(HEALTH_TABS.map((t) => t.id), ['all', 'required', 'optional', 'other', 'tools']);
  assert.equal(nextHealthTab('all', -1), 'tools');
  assert.equal(nextHealthTab('tools', 1), 'all');
  const counts = tabCounts(report());
  assert.deepEqual(counts.all, { count: 4, bad: 1 });
  assert.deepEqual(counts.optional, { count: 1, bad: 1 });
  assert.deepEqual(counts.tools, { count: 2, bad: 0 }, 'a missing optional tool is not a fault');
});

test('a missing tool offers its installer, or names the command when it cannot run one', () => {
  const rg = { name: 'rg', kind: 'tool', status: 'missing', tier: 'optional', install: ['brew', ['install', 'ripgrep']] };
  assert.deepEqual(packageActions(rg).map((a) => [a.label, a.detail]), [['Install rg', 'brew install ripgrep']]);
  assert.deepEqual(packageActions({ ...rg, status: 'ok' }), []);
  const linux = { ...rg, install: null, manual: 'sudo apt install ripgrep' };
  assert.deepEqual(packageActions(linux), []);
  assert.match(packageLines(linux, { rows: 9 }).join('\n'), /Installed\s+no · install it with sudo apt install ripgrep/);
});

test('a failed install says one line, and the error is a choice, never shown unasked', () => {
  const job = { state: 'failed', name: 'ink', version: '8.0.0', error: 'npm error code E401\nnpm error Unable to authenticate', output: ['a', 'b', 'c'] };
  assert.equal(jobLine(job), '✗ ink did not install: npm error Unable to authenticate');
  assert.equal(jobLine({ ...job, name: 'npm install' }), '✗ npm install failed: npm error Unable to authenticate');
  const entry = { ...pkg({ latest: '8.0.0' }), kind: 'package' };
  assert.deepEqual(packageActions(entry, { job }).map((a) => a.key), ['error', 'latest', 'versions']);
  assert.deepEqual(packageActions(entry, { job: { ...job, name: 'react' } }).map((a) => a.key), ['latest', 'versions'], 'another package\'s failure');
  assert.equal(homeItems(report(), { job })[0].key, 'error');
  assert.equal(homeItems(report(), { job: { ...job, output: [] } })[0].key, 'fix', 'nothing to show, no choice');
  const many = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const view = errorLines(many, { width: 80, rows: 10 });
  assert.equal(view.note, 'the last 9 of 40 lines');
  assert.equal(view.lines.at(-1), 'line 39', 'the end, where the cause usually is');
});

test('an unused package can be removed; a used one cannot', () => {
  const unused = { ...pkg({ name: 'ink-spinner', tier: 'unused' }), kind: 'package', workspace: 'server' };
  assert.deepEqual(packageActions(unused).map((a) => a.key), ['remove', 'versions']);
  assert.ok(!packageActions({ ...pkg(), kind: 'package', workspace: 'server' }).some((a) => a.key === 'remove'));
  assert.equal(jobLine({ state: 'removed', name: 'ink-spinner' }), '✔ ink-spinner removed · /restart to load it');
  assert.equal(jobLine({ state: 'running', name: 'ink-spinner', removing: true }), '◌ Removing ink-spinner — npm uninstall');
});

test('a required package does not repeat "the agent does not start" under its tier', () => {
  const lines = packageLines(pkg({ name: 'zod', workspace: 'server', tier: 'required', status: 'ok', installed: '3.25.76', range: '^3.24.0' }), { width: 100, rows: 12 });
  assert.match(lines[0], /required — the agent does not start without it/);
  assert.ok(!lines.some((l) => l.startsWith('Without it')), lines.join('\n'));
  // Negative controls: a line that says more stays, and so does an optional one.
  const tsx = packageLines(pkg({ name: 'tsx', tier: 'required', without: 'The agent does not start: the bin prints "tsx not found".' }), { width: 100, rows: 12 });
  assert.ok(tsx.some((l) => l.startsWith('Without it') && /tsx not found/.test(l)));
  const unpdf = packageLines(pkg({ name: 'unpdf', tier: 'optional', without: 'read_file fails on PDFs.' }), { width: 100, rows: 12 });
  assert.ok(unpdf.some((l) => l.startsWith('Without it')));
});

test('optional: Uninstall when installed, Install when removed; Remove unused gathers every unused one', () => {
  const installed = pkg({ name: 'unpdf', workspace: 'server', tier: 'optional', range: '1.8.1', installed: '1.8.1', without: 'read_file fails on PDFs.' });
  assert.deepEqual(packageActions(installed).filter((a) => a.value.kind === 'remove').map((a) => a.label), ['Uninstall']);
  const removed = { ...installed, installed: null, status: 'removed' };
  const acts = packageActions(removed);
  assert.equal(acts[0].label, 'Install');
  assert.deepEqual(acts[0].value, { kind: 'install', version: '1.8.1' });
  assert.ok(!acts.some((a) => a.value.kind === 'fix' || a.value.kind === 'remove'));
  // Control: a required package offers neither.
  assert.ok(!packageActions(pkg({ workspace: 'server' })).some((a) => a.value.kind === 'remove'));

  const r = report();
  r.groups[0].packages.push(
    pkg({ name: 'ink-spinner', tier: 'unused', installed: '5.0.0' }),
    pkg({ name: 'left-pad', tier: 'unused', installed: '1.3.0' }),
    { ...removed, name: 'gone' },
  );
  const items = homeItems(r);
  const bulk = items.find((i) => i.value.kind === 'remove-unused');
  assert.deepEqual(bulk.value, { kind: 'remove-unused', workspace: 'server', names: ['ink-spinner', 'left-pad'] });
  const gone = items.find((i) => i.key === 'server:gone');
  assert.match(gone.detail, /removed .*enter to install it/);
  assert.equal(gone.tone, undefined, 'removed is not drawn as a fault');
  assert.ok(!homeItems(report()).some((i) => i.value.kind === 'remove-unused'), 'control: nothing unused, no row');
});
