/**
 * The file watcher, and the shell it used to take down with it.
 *
 * On the work laptop, 2026-10-23, every spawn failed with `spawn EBADF` —
 * `run_command` ×9, `run_background`, the browser-open at launch, `/update`'s
 * git. macOS refuses `posix_spawn` once a process holds a descriptor numbered
 * at or above `OPEN_MAX` (10,240), and chokidar 4 holds about one descriptor
 * per watched file. A large repo crossed the line at startup.
 *
 * The descriptor tests run in a child process: holding ten thousand files in
 * the test runner would break every later test that spawns anything, which is
 * the bug itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FileWatcher, isIgnored } from '../../../src/backend/watcher/file-watcher.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WATCHER = join(HERE, '../../../src/backend/watcher/file-watcher.js');
const darwin = process.platform === 'darwin';

test('ignored by path segment, not by substring', () => {
  assert.equal(isIgnored(''), false, 'the root is relative path "": ignoring it watches nothing');
  for (const p of ['.git/HEAD', '.agent/state/x.json', 'node_modules/a/b.js', 'vendor/bundle/x.rb',
    'tmp/cache/y', 'log/development.log', 'app/.DS_Store', 'coverage/index.html']) {
    assert.equal(isIgnored(p), true, p);
  }
  // The old regexes matched anywhere, so these were silently never reported.
  for (const p of ['app/models/distance.rb', 'lib/rebuild.js', 'src/logger.js', 'app/vendors.rb']) {
    assert.equal(isIgnored(p), false, p);
  }
});

/** Runs `body` in a fresh node process; returns its last stdout line, parsed. */
function inChild(body) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', body], {
    encoding: 'utf8', timeout: 120_000,
  });
  const line = (r.stdout || '').trim().split('\n').pop();
  try { return JSON.parse(line); } catch { throw new Error(`child said: ${r.stdout}\n${r.stderr}`); }
}

/** A tree big enough to cross OPEN_MAX under a per-file watcher. */
function bigTree(files = 15_000) {
  const root = mkdtempSync(join(tmpdir(), 'watch-big-'));
  for (let d = 0; d < files / 100; d++) {
    const dir = join(root, 'app', `d${d}`);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < 100; f++) writeFileSync(join(dir, `f${f}.rb`), '');
  }
  return root;
}

const PROBE = `
  import { exec } from 'node:child_process';
  import { readdirSync } from 'node:fs';
  const fds = () => readdirSync('/dev/fd').length;
  const tryExec = () => new Promise((r) => {
    try { exec('echo ok', (e, o) => r(e ? 'ERR ' + e.code : o.trim())); }
    catch (e) { r('ERR ' + e.code); }
  });
`;

test('control: past OPEN_MAX descriptors, macOS refuses to spawn', { skip: !darwin }, (t) => {
  const out = inChild(`${PROBE}
    import { openSync } from 'node:fs';
    try { for (let i = 0; i < 10_300; i++) openSync('/dev/null', 'r'); }
    catch (e) { console.log(JSON.stringify({ room: e.code })); process.exit(0); }
    console.log(JSON.stringify({ exec: await tryExec() }));`);
  // The control needs a soft limit above OPEN_MAX (a Mac's is unlimited by
  // default; CI's runner was 256 until the workflow raised it). Below it the
  // process runs out of descriptors before it can show what OPEN_MAX does.
  if (out.room) return t.skip(`ulimit -n is below 10,300 here (${out.room})`);
  assert.equal(out.exec, 'ERR EBADF');
});

test('a 15,000-file tree: the watcher holds no descriptors per file, and commands still run',
  { skip: !darwin }, (t) => {
    const root = bigTree();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const native = inChild(`${PROBE}
      const { FileWatcher } = await import(${JSON.stringify(WATCHER)});
      const before = fds();
      const w = new FileWatcher(${JSON.stringify(root)}, null);
      await w.start();
      await new Promise((r) => setTimeout(r, 500));
      const after = fds();
      const result = await tryExec();
      w.stop();
      console.log(JSON.stringify({ added: after - before, exec: result }));`);
    assert.ok(native.added < 10, `the watcher opened ${native.added} descriptors`);
    assert.equal(native.exec, 'ok');
    // The negative control was chokidar on the same tree, holding >10,240
    // descriptors and failing the spawn. chokidar was removed in v5.31; the
    // OPEN_MAX control above still shows what the limit does.
  });

/** A watcher on a small tree, with every reported turn collected. */
async function watching(t) {
  const root = mkdtempSync(join(tmpdir(), 'watch-ev-'));
  mkdirSync(join(root, 'app'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'app', 'old.rb'), 'a');
  writeFileSync(join(root, 'app', 'gone.rb'), 'a');
  // Files in a real workspace predate the agent; created in the same
  // millisecond as the watch, they are indistinguishable from new ones.
  await new Promise((r) => setTimeout(r, 50));
  const loop = { conversationHistory: [] };
  const w = new FileWatcher(root, loop, { settleMs: 150 });
  await w.start();
  await new Promise((r) => setTimeout(r, 300)); // FSEvents needs a moment to arm
  t.after(() => { w.stop(); rmSync(root, { recursive: true, force: true }); });
  const events = () => loop.conversationHistory.map((e) => e.content);
  return { root, events };
}

test('outside edits are reported once each, worded by what is on disk', { skip: !darwin }, async (t) => {
  const { root, events } = await watching(t);
  writeFileSync(join(root, 'app', 'old.rb'), 'b');
  writeFileSync(join(root, 'app', 'old.rb'), 'c'); // a burst is one report
  writeFileSync(join(root, 'app', 'new.rb'), 'x');
  unlinkSync(join(root, 'app', 'gone.rb'));
  writeFileSync(join(root, 'node_modules', 'pkg.js'), 'x');
  // Wait for the events, not for a fixed time: FSEvents delivery under a
  // loaded machine (the whole suite in parallel) took longer than the 1.2s
  // this used to sleep, and the test failed about one run in four. Then a
  // quiet period, so an extra report would still be caught.
  const deadline = Date.now() + 10_000;
  while (events().length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 500));

  const got = events().sort();
  assert.deepEqual(got, [
    `[System Event] File ${join('app', 'gone.rb')} was deleted externally by the user.`,
    `[System Event] File ${join('app', 'new.rb')} was added externally by the user.`,
    `[System Event] File ${join('app', 'old.rb')} was modified externally by the user.`,
  ]);
});

test('a watcher that cannot start leaves the session running', async () => {
  const w = new FileWatcher('/definitely/not/a/dir', { workspace: mkdtempSync(join(tmpdir(), 'wl-')) });
  await w.start(); // must not throw
  // fs.watch refuses a missing path, and the session carries on without one.
  assert.equal(w.watcher, null);
  w.stop();
});

test('an editor\'s atomic-save temp file is not a change (v7.9)', async () => {
  const { isIgnored } = await import('../../../src/backend/watcher/file-watcher.js');
  assert.equal(isIgnored('server/src/ui/mismatch-row.js.tmp.49691.0c7a4b70e972'), true);
  assert.equal(isIgnored('notes.md~'), true);
  assert.equal(isIgnored('src/App.jsx___jb_tmp___'), true);
  assert.equal(isIgnored('server/src/ui/mismatch-row.js'), false, 'control: the file itself');
  assert.equal(isIgnored('src/tmp.js'), false, 'control: a name with tmp in it');
});
