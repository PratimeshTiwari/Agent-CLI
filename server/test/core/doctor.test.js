/**
 * `/doctor` and `agent doctor` (v5.29): what is installed, what is missing,
 * what is newer, and why each package is here.
 *
 * The tier and the "why" are prose in `PACKAGES`, and prose drifts. So the
 * claims are checked against the source: a `required` package must be a static
 * import (or the agent would start without it), an `optional` one must never be
 * (or it is required in fact), and every package any manifest declares must
 * have an entry — the answer to "why do we use this" cannot go missing for the
 * next dependency someone adds.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PACKAGES, TOOLS, REPO_ROOT, packageInfo, satisfies, compareVersions, readManifests, checkInstalled,
  problems, startupWarning, lookupLatest, checkHealth, formatReport, summaryLine, describePackage,
  findImporters, runDoctorCli, installArgs, installPackage, listVersions, applyLatest, clip, newerCount, installTool, errorOutput, checkTools,
} from '../../src/core/doctor.js';

const SRC = new URL('../../src/', import.meta.url).pathname;

describe('the table says why, and the code agrees', () => {
  test('every declared package has a tier and a reason', () => {
    const missing = readManifests().flatMap((m) => m.declared
      .filter((d) => !packageInfo(d.name, m.workspace)?.why)
      .map((d) => `${m.workspace}: ${d.name}`));
    assert.deepEqual(missing, [], 'add these to PACKAGES in core/doctor.js');
  });

  test('every entry is for a package something declares', () => {
    const declared = new Set(readManifests().flatMap((m) => m.declared.map((d) => d.name)));
    assert.deepEqual(Object.keys(PACKAGES).filter((n) => !declared.has(n)), []);
  });

  test('required means a static import; optional means only a lazy one; unused means none', () => {
    const wrong = [];
    for (const [name, info] of Object.entries(PACKAGES)) {
      if (!['required', 'optional', 'unused'].includes(info.tier) || name === 'tsx') continue;
      const files = findImporters(name, join(SRC));
      const text = files.map((f) => readFileSync(join(SRC, '..', f), 'utf8')).join('\n');
      const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      const isStatic = new RegExp(`from\\s+['"]${esc}(?:/[^'"]*)?['"]`).test(text);
      const isLazy = new RegExp(`import\\s*\\(\\s*['"]${esc}['"]`).test(text);
      if (info.tier === 'required' && !isStatic) wrong.push(`${name}: required, but nothing imports it at startup`);
      if (info.tier === 'optional' && (isStatic || !isLazy)) wrong.push(`${name}: optional, but ${isStatic ? 'imported statically' : 'never imported'}`);
      if (info.tier === 'unused' && files.length) wrong.push(`${name}: unused, but ${files[0]} imports it`);
    }
    assert.deepEqual(wrong, []);
  });

  test('negative control: the importer scan finds what is there and nothing that is not', () => {
    assert.deepEqual(findImporters('unpdf', SRC), ['src/mcp/tools/documents.js']);
    assert.ok(findImporters('ink', SRC).length > 5);
    assert.deepEqual(findImporters('no-such-package', SRC), []);
  });

  test('doctor.js imports only built-ins — agent doctor runs where node_modules is broken', () => {
    const source = readFileSync(join(SRC, 'core/doctor.js'), 'utf8');
    const specifiers = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    assert.ok(specifiers.length > 0);
    for (const s of specifiers) {
      assert.ok(builtinModules.includes(s.replace(/^node:/, '')), `${s} is not a Node built-in`);
    }
  });

  test('the bin answers doctor before it looks for tsx', () => {
    const bin = readFileSync(join(SRC, 'index.js'), 'utf8');
    assert.ok(bin.indexOf("'doctor'") > 0 && bin.indexOf("'doctor'") < bin.indexOf("'tsx' not found"));
  });

  test('a missing unpdf tells the model what to do, not a module path', () => {
    const docs = readFileSync(join(SRC, 'mcp/tools/documents.js'), 'utf8');
    assert.match(docs, /MODULE_NOT_FOUND[\s\S]{0,400}\/doctor fix/);
  });
});

describe('versions', () => {
  test('the range shapes this repo uses', () => {
    assert.equal(satisfies('7.1.1', '^7.1.1'), true);
    assert.equal(satisfies('7.9.0', '^7.1.1'), true);
    assert.equal(satisfies('8.0.0', '^7.1.1'), false);
    assert.equal(satisfies('7.0.9', '^7.1.1'), false);
    assert.equal(satisfies('0.23.9', '^0.23.0'), true);
    assert.equal(satisfies('0.24.0', '^0.23.0'), false, '^0.x pins the minor');
    assert.equal(satisfies('1.8.1', '1.8.1'), true);
    assert.equal(satisfies('1.9.1', '1.8.1'), false, 'an exact pin is exact');
    assert.equal(satisfies('4.0.9', '~4.0.0'), true);
    assert.equal(satisfies('4.1.0', '~4.0.0'), false);
    assert.equal(satisfies('22.19.0', '>=20.0.0'), true);
    assert.equal(satisfies('18.0.0', '>=20.0.0'), false);
    assert.equal(satisfies('1.0.0', '^1 || ^2'), null, 'not judged, so never reported as wrong');
  });

  test('compare', () => {
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
    assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1);
    assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  });
});

/** A repo on disk: a root with one workspace, packages placed where asked. */
function fakeRepo({ deps = {}, devDeps = {}, installed = {}, local = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'doctor-'));
  const put = (dir, name, version) => {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
  };
  writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['server'], engines: { node: '>=20.0.0' } }));
  mkdirSync(join(root, 'server'));
  writeFileSync(join(root, 'server', 'package.json'), JSON.stringify({ dependencies: deps, devDependencies: devDeps }));
  for (const [n, v] of Object.entries(installed)) put(root, n, v);
  for (const [n, v] of Object.entries(local)) put(join(root, 'server'), n, v);
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

const row = (groups, name) => groups.flatMap((g) => g.packages).find((p) => p.name === name);

describe('what is installed', () => {
  test('missing, wrong version, hoisted and local copies', () => {
    const { root, done } = fakeRepo({
      deps: { ink: '^7.1.1', ws: '^8.18.0', unpdf: '1.8.1', diff: '^7.0.0' },
      devDeps: { '@types/react': '^19.0.0' },
      installed: { ink: '7.1.1', ws: '7.5.0', diff: '6.0.0' },
      local: { diff: '7.0.0' },
    });
    const groups = checkInstalled(root);
    assert.equal(row(groups, 'ink').status, 'ok');
    assert.equal(row(groups, 'ws').status, 'mismatch');
    assert.equal(row(groups, 'unpdf').status, 'missing');
    assert.equal(row(groups, 'unpdf').tier, 'optional');
    assert.equal(row(groups, 'diff').installed, '7.0.0', 'the workspace\'s own copy wins over the hoisted one');
    assert.equal(row(groups, '@types/react').status, 'missing');
    assert.deepEqual(problems(groups).map((p) => p.name).sort(), ['unpdf', 'ws'], 'a missing dev package is not a problem');
    done();
  });

  test('the startup row names the package and the fix, or is absent', () => {
    const bad = fakeRepo({ deps: { unpdf: '1.8.1' } });
    assert.match(startupWarning(checkInstalled(bad.root)), /^✗ unpdf not installed · \/doctor fix/);
    bad.done();
    const fine = fakeRepo({ deps: { ink: '^7.1.1' }, devDeps: { '@types/react': '^19' }, installed: { ink: '7.2.0' } });
    assert.equal(startupWarning(checkInstalled(fine.root)), null, 'control: only a missing dev package');
    fine.done();
  });
});

describe('the latest versions', () => {
  const outdated = JSON.stringify({
    ink: { current: '7.1.1', wanted: '7.1.1', latest: '8.0.0' },
    marked: [{ current: '15.0.12', latest: '18.1.2' }, { current: '15.0.12', latest: '18.1.2' }],
  });

  test('npm outdated exits 1 when anything is behind; the JSON is still the answer', async () => {
    const r = await lookupLatest({ runner: async () => ({ error: new Error('exit 1'), stdout: outdated, stderr: '' }) });
    assert.equal(r.ok, true);
    assert.equal(r.latest.get('ink'), '8.0.0');
    assert.equal(r.latest.get('marked'), '18.1.2');
  });

  test('a registry that refuses says why — the work-laptop case', async () => {
    const r = await lookupLatest({ runner: async () => ({ error: new Error('x'), stdout: '', stderr: 'npm error code E401\nnpm error Unable to authenticate' }) });
    assert.deepEqual(r, { ok: false, reason: 'code E401' });
  });

  test('absent from npm outdated means installed is latest', async () => {
    const { root, done } = fakeRepo({ deps: { ink: '^7.1.1', ws: '^8.0.0' }, installed: { ink: '7.1.1', ws: '8.21.0' } });
    const runner = async (cmd) => (cmd === 'npm' ? { stdout: outdated, stderr: '' } : { stdout: '1.0.0', stderr: '' });
    const report = await checkHealth({ root, runner });
    assert.equal(row(report.groups, 'ink').latest, '8.0.0');
    assert.equal(row(report.groups, 'ws').latest, '8.21.0');
    const text = formatReport(report).join('\n');
    assert.match(text, /✔ ink\s+7\.1\.1\s+\^7\.1\.1\s+latest 8\.0\.0/);
    assert.match(text, /✔ ws\s+8\.21\.0\s+\^8\.0\.0\s+latest$/m);
    done();
  });
});

describe('what is shown', () => {
  test('tiers are headings; a missing package says what breaks; an optional tool is not a fault', async () => {
    const { root, done } = fakeRepo({ deps: { ink: '^7.1.1', unpdf: '1.8.1' }, installed: { ink: '7.1.1' } });
    const runner = async (cmd) => (cmd === 'rg' ? { error: new Error('ENOENT'), stdout: '', stderr: '' } : { stdout: 'v1.2.3', stderr: '' });
    const report = await checkHealth({ root, runner, latest: false });
    const text = formatReport(report).join('\n');
    assert.match(text, /required — the agent does not start without it/);
    assert.match(text, /optional — one feature stops working without it/);
    assert.match(text, /✗ unpdf\s+missing\s+1\.8\.1\s+read_file fails on PDFs/);
    assert.match(text, /· rg\s+missing\s+optional\s+search is slower$/m);
    assert.match(summaryLine(report), /^✗ 1 missing · run `npm install` in /);
    done();
  });

  test('one package: why, what breaks, versions, and who imports it', async () => {
    const { root, done } = fakeRepo({ deps: { unpdf: '1.8.1' }, installed: { unpdf: '1.8.1' } });
    const report = await checkHealth({ root, latest: false, runner: async () => ({ stdout: '1.0.0', stderr: '' }) });
    const lines = describePackage('unpdf', report, { importers: ['src/mcp/tools/documents.js'] });
    assert.match(lines[0], /^unpdf · optional in server/);
    assert.match(lines.join('\n'), /Why: Extracts the text of a PDF/);
    assert.match(lines.join('\n'), /Imported by 1 file:\n {2}src\/mcp\/tools\/documents\.js/);
    assert.match(describePackage('git', report).join('\n'), /^git · optional tool/);
    assert.equal(describePackage('left-pad', report), null);
    done();
  });

  test('agent doctor exits 1 when a required package is missing, 0 when only an optional one is', async () => {
    const sink = () => ({ text: '', isTTY: false, write(s) { this.text += s; } });
    const a = fakeRepo({ deps: { ink: '^7.1.1' } });
    const outA = sink();
    assert.equal(await runDoctorCli(['doctor', '--offline'], { out: outA, root: a.root }), 1);
    assert.match(outA.text, /✗ ink\s+missing/);
    a.done();
    const b = fakeRepo({ deps: { ink: '^7.1.1', unpdf: '1.8.1' }, installed: { ink: '7.1.1' } });
    assert.equal(await runDoctorCli(['--offline'], { out: sink(), root: b.root }), 0);
    b.done();
  });
});

test('the real repo: every tool is described, and the report builds offline', async () => {
  assert.ok(TOOLS.every((t) => t.why && t.without));
  const report = await checkHealth({ root: REPO_ROOT, latest: false });
  assert.ok(formatReport(report).length > 10);
});

describe('changing a version from the menu', () => {
  test('the range keeps its style: caret stays caret, tilde stays tilde, a pin stays exact', () => {
    assert.deepEqual(installArgs({ name: 'ink', version: '7.2.0', workspace: 'server', range: '^7.1.1' }),
      ['install', 'ink@7.2.0', '--workspace=server']);
    assert.deepEqual(installArgs({ name: 'x', version: '1.2.9', workspace: 'server', range: '~1.2.0' }),
      ['install', 'x@1.2.9', '--workspace=server', '--save-prefix=~']);
    assert.deepEqual(installArgs({ name: 'unpdf', version: '1.4.0', workspace: 'server', range: '1.8.1' }),
      ['install', 'unpdf@1.4.0', '--workspace=server', '--save-exact']);
    assert.deepEqual(installArgs({ name: 'esbuild', version: '0.25.0', workspace: 'root', range: '^0.24.0' }),
      ['install', 'esbuild@0.25.0'], 'the root is not a --workspace');
  });

  test('listVersions: newest first, prereleases only when one is installed, npm\'s reason when it fails', async () => {
    const runner = async () => ({ stdout: JSON.stringify(['1.0.0', '1.10.0', '1.2.0', '2.0.0-beta.1']), stderr: '' });
    assert.deepEqual((await listVersions('x', { runner })).versions, ['1.10.0', '1.2.0', '1.0.0']);
    assert.equal((await listVersions('x', { runner, installed: '2.0.0-beta.1' })).versions[0], '2.0.0-beta.1');
    const refused = async () => ({ stdout: '', stderr: 'npm error code E401\nnpm error Unable to authenticate', error: new Error('exit 1') });
    assert.deepEqual(await listVersions('x', { runner: refused }), { ok: false, reason: 'code E401' });
  });

  test('installPackage judges by what is on disk afterwards, not by the exit code', async () => {
    const { root, done } = fakeRepo({ deps: { ink: '^7.1.1' }, installed: { ink: '7.1.1' } });
    const seen = [];
    const lands = async (cmd, args) => {
      seen.push([cmd, ...args]);
      writeFileSync(join(root, 'node_modules', 'ink', 'package.json'), JSON.stringify({ name: 'ink', version: '7.2.0' }));
      return { stdout: '', stderr: '' };
    };
    const ok = await installPackage({ name: 'ink', version: '7.2.0', workspace: 'server', range: '^7.1.1' }, { root, runner: lands });
    assert.deepEqual(ok, { ok: true, installed: '7.2.0' });
    assert.deepEqual(seen[0], ['npm', 'install', 'ink@7.2.0', '--workspace=server']);
    const fails = async () => ({ stdout: '', stderr: 'npm error ETARGET No matching version', error: new Error('exit 1') });
    const bad = await installPackage({ name: 'ink', version: '9.9.9', workspace: 'server', range: '^7.1.1' }, { root, runner: fails });
    assert.equal(bad.ok, false);
    assert.equal(bad.installed, '7.2.0', 'what is there now, so the page can say it');
    assert.match(bad.error, /ETARGET/);
    done();
  });

  test('applyLatest fills the column the menu opened without, and an unknown registry leaves it empty', () => {
    const report = { groups: [{ workspace: 'server', packages: [{ name: 'ink', installed: '7.1.1' }, { name: 'ws', installed: '8.18.0' }] }], tools: [] };
    const filled = applyLatest(report, { ok: true, latest: new Map([['ink', '7.3.0']]) });
    assert.deepEqual(filled.groups[0].packages.map((p) => p.latest), ['7.3.0', '8.18.0']);
    assert.equal(newerCount(filled), 1);
    assert.equal(applyLatest(report, { ok: false, reason: 'E401' }).groups[0].packages[0].latest, undefined);
    assert.equal(report.groups[0].packages[0].latest, undefined, 'the report it was given is not changed');
  });

  test('clip cuts to the width and leaves a short line alone', () => {
    assert.equal(clip('abcdef', 4), 'abc…');
    assert.equal(clip('abc', 4), 'abc');
    assert.equal(clip('abcdef'), 'abcdef');
  });
});

describe('installing a tool npm does not manage', () => {
  test('each platform gets its own package manager, and Linux only a command to run by hand', async () => {
    const missing = async () => ({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), stdout: '', stderr: '' });
    const rg = (platform) => checkTools({ platform, runner: missing }).then((t) => t.find((x) => x.name === 'rg'));
    assert.deepEqual((await rg('darwin')).install, ['brew', ['install', 'ripgrep']]);
    assert.equal((await rg('win32')).install[0], 'winget');
    assert.equal((await rg('linux')).install, null, 'sudo wants a password the menu cannot ask for');
    assert.equal((await rg('linux')).manual, 'sudo apt install ripgrep');
  });

  test('judged by running the tool afterwards; a missing brew is said in words', async () => {
    const tool = { name: 'rg', install: ['brew', ['install', 'ripgrep']], manual: 'https://brew.sh, then brew install ripgrep' };
    let installed = false;
    const works = async (cmd) => (cmd === 'brew' ? ((installed = true), { stdout: '', stderr: '' })
      : installed ? { stdout: 'ripgrep 14.1.1', stderr: '' } : { error: new Error('ENOENT'), stdout: '', stderr: '' });
    assert.deepEqual(await installTool(tool, { runner: works }), { ok: true, version: '14.1.1' });
    const noBrew = async () => ({ error: Object.assign(new Error('spawn brew ENOENT'), { code: 'ENOENT' }), stdout: '', stderr: '' });
    const r = await installTool(tool, { runner: noBrew });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'brew is not installed — https://brew.sh, then brew install ripgrep');
    const fails = async (cmd) => (cmd === 'brew'
      ? { error: new Error('exit 1'), stdout: '==> Fetching ripgrep', stderr: 'Error: Permission denied @ dir_s_mkdir - /opt/homebrew/Cellar' }
      : { error: new Error('ENOENT'), stdout: '', stderr: '' });
    const f = await installTool(tool, { runner: fails });
    assert.equal(f.error, 'Permission denied @ dir_s_mkdir - /opt/homebrew/Cellar');
    assert.deepEqual(f.output, ['Error: Permission denied @ dir_s_mkdir - /opt/homebrew/Cellar', '==> Fetching ripgrep']);
  });

  test('errorOutput strips colour and keeps the tail', () => {
    assert.deepEqual(errorOutput({ stderr: '\x1b[31mnpm error\x1b[39m code E401\n\n', stdout: '' }), ['npm error code E401']);
    assert.equal(errorOutput({ stdout: Array.from({ length: 300 }, (_, i) => `l${i}`).join('\n') }).length, 200);
    assert.deepEqual(errorOutput({ error: new Error('spawn npm EBADF') }), ['spawn npm EBADF']);
  });
});
