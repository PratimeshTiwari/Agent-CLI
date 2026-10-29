/**
 * Noticing an update, and saying what it leaves you to reload.
 *
 * The version check and the pull are the easy halves. **`reloadSteps` is the
 * feature**: three artifacts ship from one repo and pulling only updates one of
 * them — `service-worker.js` is a committed bundle Chrome reads on reload,
 * content scripts stay in the page until it is hard-refreshed, and the `.vsix`
 * is installed by hand. So a pull leaves new server code talking to an old
 * bridge, and the symptom is the agent going quiet rather than an error.
 *
 * A standing "you may want to reload things" is the notice people stop reading.
 * These pin that it asks for the steps that changed and no others.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  reloadSteps, needsInstall, checkForUpdate, pullUpdate,
  savePendingReload, readPendingReload, clearPendingReload, isDirty, treeState, nameFiles,
} from '../../src/core/update.js';

const ids = (files) => reloadSteps(files).map((s) => s.id);

describe('reloadSteps — only what actually moved', () => {
  test('a server-only change needs nothing beyond the restart', () => {
    assert.deepEqual(ids(['server/src/main.js', 'server/test/core/x.test.js']), []);
  });

  test('the bundle Chrome runs means reload the extension', () => {
    assert.deepEqual(ids(['extension/service-worker.js']), ['extension']);
    assert.deepEqual(ids(['extension/src/background/content.js']), ['extension']);
    assert.deepEqual(ids(['extension/manifest.json']), ['extension']);
  });

  test('content scripts mean hard-refresh the tab, which is a different step', () => {
    // They are not bundled and are not re-injected into a page that already has
    // one, so reloading the extension alone does not reach them.
    assert.deepEqual(ids(['extension/content-scripts/gemini-bridge.js']), ['tabs']);
  });

  test('a new .vsix means reinstall the companion', () => {
    assert.deepEqual(ids(['vscode-companion/cli-agent-companion-1.6.0.vsix']), ['companion']);
  });

  test('editing the companion source without repackaging asks for nothing', () => {
    // Correct: the .vsix is what gets installed, and it has not changed.
    assert.deepEqual(ids(['vscode-companion/extension.js']), []);
  });

  test('everything at once, in the order you would do it', () => {
    assert.deepEqual(ids([
      'server/src/main.js',
      'extension/src/background/socket.js',
      'extension/content-scripts/gemini-bridge.js',
      'vscode-companion/a.vsix',
    ]), ['extension', 'tabs', 'companion']);
  });

  test('each step says how, not just what', () => {
    for (const step of reloadSteps(['extension/service-worker.js', 'extension/content-scripts/a.js'])) {
      assert.ok(step.what && step.how, `${step.id} has no instruction`);
      assert.ok(step.how.length > 10, `${step.id}'s "how" is not actionable`);
    }
  });

  test('no files, no steps, no crash', () => {
    assert.deepEqual(reloadSteps(), []);
    assert.deepEqual(reloadSteps([]), []);
  });
});

describe('needsInstall', () => {
  test('a moved manifest or lockfile means npm install', () => {
    assert.equal(needsInstall(['package.json']), true);
    assert.equal(needsInstall(['server/package.json']), true);
    assert.equal(needsInstall(['package-lock.json']), true);
  });

  test('ordinary source does not', () => {
    assert.equal(needsInstall(['server/src/main.js']), false);
    assert.equal(needsInstall([]), false);
  });
});

describe('it measures against main, not the branch you happen to be on', () => {
  /**
   * It compared the current branch to *its own* upstream first, which answers
   * nothing useful: work happens on a branch and lands on `main` through a PR,
   * so `main` moving is the only thing that means "there is a newer agent than
   * the one you are running". A dev branch being level with its own remote copy
   * is not news.
   */
  test('the comparison is always origin/main', async () => {
    const state = await checkForUpdate(process.cwd());
    if (state.reason) return; // no remote in this environment
    assert.equal(state.upstream, 'origin/main');
  });

  test('a branch ahead of main is up to date, which is correct', async () => {
    // Nothing has been released that you do not already have.
    const state = await checkForUpdate(process.cwd());
    if (state.reason) return;
    assert.equal(typeof state.available, 'boolean');
    assert.ok(state.behind >= 0);
  });

  test('it still reports which branch you are on', async () => {
    const state = await checkForUpdate(process.cwd());
    if (state.reason === 'not a git checkout') return;
    assert.ok(state.branch, 'the report does not say where you are');
  });
});

describe('checkForUpdate never throws, whatever it is pointed at', () => {
  test('a directory that is not a checkout', async () => {
    const out = await checkForUpdate(tmpdir());
    assert.equal(out.available, false);
    assert.match(out.reason, /not a git checkout/);
  });

  test('no directory at all', async () => {
    assert.equal((await checkForUpdate(null)).available, false);
    assert.equal((await checkForUpdate(undefined)).available, false);
  });

  test('a path that does not exist', async () => {
    assert.equal((await checkForUpdate('/no/such/place')).available, false);
  });
});

describe('pullUpdate refuses rather than clobbers', () => {
  test('a non-repo is refused with a reason', async () => {
    const out = await pullUpdate(tmpdir());
    assert.equal(out.ok, false);
    assert.match(out.error, /not running from a git checkout/);
  });

  // The dirty-tree cases are below, in throwaway repos. This one used to dirty
  // the real checkout with an untracked file — which no longer blocks, so it
  // would have pulled origin/main into the repo running the tests.
});

/**
 * Issue #90: "26 updates available", then a refusal over uncommitted changes
 * nobody had made, on every try. `npm install` rewrites `package-lock.json`
 * under a different npm, and every install path here runs it.
 */
describe('what a dirty tree means to a pull', () => {
  let origin, work, other;

  const git = (dir, ...args) => execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });

  const commit = (dir, name, body) => {
    writeFileSync(join(dir, name), body);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', name);
  };

  beforeEach(() => {
    origin = mkdtempSync(join(tmpdir(), 'upd-origin-'));
    work = mkdtempSync(join(tmpdir(), 'upd-work-'));
    other = mkdtempSync(join(tmpdir(), 'upd-other-'));
    git(origin, 'init', '--bare', '--initial-branch=main', '.');
    git(work, 'clone', origin, '.');
    commit(work, 'package-lock.json', '{"lockfileVersion": 3}\n');
    commit(work, 'app.js', 'one\n');
    git(work, 'push', '-u', 'origin', 'main');
    // Something to pull.
    git(other, 'clone', origin, '.');
    commit(other, 'new.js', 'two\n');
    git(other, 'push', 'origin', 'main');
  });

  afterEach(() => {
    for (const d of [origin, work, other]) rmSync(d, { recursive: true, force: true });
  });

  test('a clean tree pulls', async () => {
    const out = await pullUpdate(work);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(out.files, ['new.js']);
    assert.deepEqual(out.restored, []);
  });

  test('your edit is refused, and named', async () => {
    writeFileSync(join(work, 'app.js'), 'mine\n');
    const out = await pullUpdate(work);
    assert.equal(out.ok, false);
    assert.match(out.error, /`app\.js`/);
    assert.match(out.error, /will not pull over your work/);
    assert.equal(await isDirty(work), true);
  });

  test('a lockfile npm rewrote is put back, and the pull goes ahead', async () => {
    writeFileSync(join(work, 'package-lock.json'), '{"lockfileVersion": 2}\n');
    assert.equal(await isDirty(work), false, 'a rewritten lockfile still reads as your work');
    const out = await pullUpdate(work);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(out.restored, ['package-lock.json']);
    assert.deepEqual(out.files, ['new.js']);
  });

  test('the lockfile is put back when called from a subfolder, as the agent calls it (#102)', async () => {
    // The agent passes `server/`, not the repo root. Porcelain status names the
    // lockfile from the root; a bare checkout path is read from the folder.
    mkdirSync(join(work, 'server'));
    writeFileSync(join(work, 'package-lock.json'), '{"lockfileVersion": 2}\n');
    const out = await pullUpdate(join(work, 'server'));
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(out.restored, ['package-lock.json']);
    assert.deepEqual(out.files, ['new.js']);
  });

  test('a lockfile beside your edit is not put back — the edit still refuses', async () => {
    // Control: the exemption must not leak into "anything goes once npm ran".
    writeFileSync(join(work, 'package-lock.json'), '{"lockfileVersion": 2}\n');
    writeFileSync(join(work, 'app.js'), 'mine\n');
    const out = await pullUpdate(work);
    assert.equal(out.ok, false);
    assert.match(out.error, /`app\.js`/);
    assert.doesNotMatch(out.error, /package-lock/);
    assert.equal(git(work, 'status', '--porcelain', 'package-lock.json').trim(), 'M package-lock.json',
      'the lockfile was put back on a pull that never happened');
  });

  test('a deleted lockfile is somebody\'s decision', async () => {
    rmSync(join(work, 'package-lock.json'));
    const out = await pullUpdate(work);
    assert.equal(out.ok, false);
    assert.match(out.error, /`package-lock\.json`/);
  });

  test('an untracked file does not block', async () => {
    writeFileSync(join(work, 'notes.txt'), 'x');
    assert.equal(await isDirty(work), false);
    const out = await pullUpdate(work);
    assert.equal(out.ok, true, out.error);
  });

  test('treeState reads a path with a space', async () => {
    commit(work, 'a b.js', '1\n');
    writeFileSync(join(work, 'a b.js'), '2\n');
    assert.deepEqual((await treeState(work)).blocking, ['a b.js']);
  });

  test('nameFiles caps the list', () => {
    assert.equal(nameFiles(['a']), '`a`');
    assert.equal(nameFiles(['a', 'b', 'c'], 2), '`a`, `b` and 1 more');
  });
});

describe('the reminder survives a restart', () => {
  let home, savedHome;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'uh-'));
    savedHome = process.env.AGENT_CLI_HOME;
    process.env.AGENT_CLI_HOME = home;
  });
  afterEach(() => {
    // Restore, never delete: test/setup-home.js points the home at a temp dir,
    // and deleting it sends every later test in this file to the real ~/.agent.
    if (savedHome === undefined) delete process.env.AGENT_CLI_HOME;
    else process.env.AGENT_CLI_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  const STEPS = [{ id: 'extension', what: 'Reload the Chrome extension', how: 'chrome://extensions' }];

  test('saved, then read back after what would be a restart', () => {
    assert.equal(readPendingReload(), null);
    assert.equal(savePendingReload(STEPS, { to: 'abc123' }), true);
    const back = readPendingReload();
    assert.equal(back.steps.length, 1);
    assert.equal(back.to, 'abc123');
  });

  test('it is NOT read-once — that is the whole point', () => {
    // The failure it prevents is silent, so a notice that scrolls past once and
    // disappears would reproduce it.
    savePendingReload(STEPS);
    assert.ok(readPendingReload());
    assert.ok(readPendingReload(), 'reading it consumed it');
    assert.ok(readPendingReload());
  });

  test('cleared only when the user says so', () => {
    savePendingReload(STEPS);
    clearPendingReload();
    assert.equal(readPendingReload(), null);
  });

  test('nothing to reload is not written at all', () => {
    assert.equal(savePendingReload([]), false);
    assert.equal(readPendingReload(), null);
  });

  test('a corrupt file reads as nothing rather than failing startup', async () => {
    const { writeFileSync } = await import('fs');
    const { pendingReloadPath } = await import('../../src/core/paths.js');
    savePendingReload(STEPS);
    writeFileSync(pendingReloadPath(), '{ not json');
    assert.equal(readPendingReload(), null);
  });
});

describe('/update reports before it acts', () => {
  /**
   * Reported from use: `/update` answered "there are uncommitted changes in the
   * agent's own repo" on a repo that had **nothing to pull**. The order was the
   * whole bug — whether your tree is dirty only matters once there is something
   * to apply to it, and being told about your own edits when no update exists
   * is a complaint about the wrong thing.
   */
  test('isDirty answers about the tree, and nothing else', async () => {
    // This repo is the checkout under test.
    const clean = await isDirty(process.cwd());
    assert.equal(typeof clean, 'boolean');
  });

  test('a directory that is not a repo is null, not false', async () => {
    // `false` would be a claim that it is clean, which is not something that
    // can be known about a non-repo.
    assert.equal(await isDirty('/no/such/place'), null);
  });

  test('checkForUpdate does not care about the tree', async () => {
    // The two questions are independent, and the bug was answering the second
    // one when the first had not been asked.
    const state = await checkForUpdate(process.cwd());
    assert.ok('available' in state);
    assert.ok(!('dirty' in state), 'the check leaked a tree concern into the version answer');
  });
});

/**
 * A merge of your own branch is not an update.
 *
 * Reported from use: "it says an update is available but I have not merged
 * anything onto main". Both halves were true. Work lands on a branch and
 * reaches `main` through a PR, so merging that PR puts a commit on `main`
 * — the merge commit — that your branch does not have, while introducing no
 * content at all, because everything in it came from your branch. Counting
 * commits called that an update; pulling it would have produced a merge in the
 * other direction for no new lines.
 *
 * These build a real repository with a real merge rather than stubbing git,
 * because the thing under test is exactly what git's own ancestry does.
 */
describe('an update has to carry something you do not have', () => {
  let origin, work, other;

  const git = (dir, ...args) => execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });

  const commit = (dir, name, body) => {
    writeFileSync(join(dir, name), body);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', name);
  };

  beforeEach(() => {
    origin = mkdtempSync(join(tmpdir(), 'upd-origin-'));
    work = mkdtempSync(join(tmpdir(), 'upd-work-'));
    other = mkdtempSync(join(tmpdir(), 'upd-other-'));

    git(origin, 'init', '--bare', '--initial-branch=main', '.');
    git(work, 'clone', origin, '.');
    commit(work, 'base.txt', 'base\n');
    git(work, 'push', '-u', 'origin', 'main');

    // The working branch, ahead of main — the normal state of this repo.
    git(work, 'checkout', '-b', 'feature');
    commit(work, 'feature.txt', 'work\n');
    git(work, 'push', '-u', 'origin', 'feature');
  });

  afterEach(() => {
    for (const d of [origin, work, other]) rmSync(d, { recursive: true, force: true });
  });

  test('merging your own branch into main is not an update', async () => {
    // What "merge pull request" does: a merge commit on main, no new content.
    git(other, 'clone', origin, '.');
    git(other, 'merge', '--no-ff', '-m', 'Merge pull request #13', 'origin/feature');
    git(other, 'push', 'origin', 'main');

    const state = await checkForUpdate(work);
    assert.equal(state.behind, 1, 'main really does have a commit this branch lacks');
    assert.equal(state.available, false, 'a merge of your own work was offered as an update');
    assert.equal(state.mergedBack, true);
  });

  test('a real commit on main is an update', async () => {
    git(other, 'clone', origin, '.');
    commit(other, 'hotfix.txt', 'someone else\n');
    git(other, 'push', 'origin', 'main');

    const state = await checkForUpdate(work);
    assert.equal(state.available, true, 'genuine new work on main was not noticed');
    assert.equal(state.mergedBack, false);
  });

  test('a merge followed by real work is an update again', async () => {
    git(other, 'clone', origin, '.');
    git(other, 'merge', '--no-ff', '-m', 'Merge pull request #13', 'origin/feature');
    commit(other, 'after.txt', 'later\n');
    git(other, 'push', 'origin', 'main');

    const state = await checkForUpdate(work);
    assert.equal(state.available, true, 'new work hid behind the merge commit');
  });

  test('nothing on main at all is not an update', async () => {
    const state = await checkForUpdate(work);
    assert.equal(state.behind, 0);
    assert.equal(state.available, false);
    assert.equal(state.mergedBack, false);
  });
});
