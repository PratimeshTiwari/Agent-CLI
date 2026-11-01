/**
 * Noticing that this agent is out of date, and saying what to do about it.
 *
 * **Why this exists, and why the last part is the point.** Three artifacts ship
 * from one repo and *pulling only updates one of them*:
 *
 * - `server/` is live as soon as the process restarts.
 * - `extension/service-worker.js` is a **committed bundle**, which Chrome picks
 *   up only when the extension is reloaded.
 * - `extension/content-scripts/*.js` need the model tab hard-refreshed.
 * - `vscode-companion/*.vsix` has to be reinstalled by hand.
 *
 * So `git pull` leaves new server code talking to an old bridge, and the
 * symptom is the agent going quiet rather than an error. Anyone can lose an
 * afternoon to that once.
 *
 * The version check and the pull are the easy parts. The part worth building is
 * `reloadSteps()`: after a pull, the changed file list says exactly which of
 * those surfaces moved, so the reminder asks for the steps that matter and no
 * others. A standing "you may want to reload things" is the kind of notice
 * people stop reading.
 *
 * Nothing here throws. An update check that can break startup is worse than no
 * update check.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, rmSync } from 'fs';
import { ensureParent, pendingReloadPath } from '../workspace/paths.js';

const run = promisify(execFile);

/** Long enough for a slow network, short enough not to be a hang. */
const FETCH_TIMEOUT_MS = 10_000;

/** Run git in `dir`, or resolve null. Never throws, never rejects. */
async function git(dir, args, { timeout = 5000 } = {}) {
  try {
    const { stdout } = await run('git', args, { cwd: dir, timeout, windowsHide: true });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Run git, and say whether it could be run at all.
 *
 * A non-zero exit carries a numeric `code` and means git answered "no". A
 * string code (`ENOENT`, `EBADF`, `ETIMEDOUT`…) means the question was never
 * asked, and the caller has to say so rather than report git's "no".
 *
 * @returns {Promise<{stdout: string|null, cannotRun: string|null}>}
 */
export async function gitOrError(dir, args, { timeout = 5000, runner = run } = {}) {
  try {
    const { stdout } = await runner('git', args, { cwd: dir, timeout, windowsHide: true });
    return { stdout: stdout.trim(), cannotRun: null };
  } catch (err) {
    if (typeof err?.code === 'number') return { stdout: null, cannotRun: null };
    return { stdout: null, cannotRun: String(err?.code || err?.message || 'unknown error') };
  }
}

/**
 * Run git for its **exit code**, not its output.
 *
 * `git()` above collapses "failed" and "printed nothing" into the same `null`,
 * which is right for reading values and useless for `diff --quiet`, where the
 * exit code *is* the answer and empty output is the success case.
 *
 * @returns {Promise<boolean|null>} true if git exited 0, false if it exited
 *   non-zero, `null` if it could not be run at all — a distinction callers
 *   need, because "no differences" and "could not look" must not be the same.
 */
async function gitSucceeds(dir, args, { timeout = 5000 } = {}) {
  try {
    await run('git', args, { cwd: dir, timeout, windowsHide: true });
    return true;
  } catch (err) {
    // A non-zero exit carries a numeric `code`; anything else (git missing,
    // timeout, bad cwd) is a failure to ask the question at all.
    return typeof err?.code === 'number' ? false : null;
  }
}

/**
 * The branch that *is* the released agent.
 *
 * Not the current branch's upstream, which is what this compared against
 * first. Work happens on a branch and lands on `main` through a PR — that is
 * the rule in `CLAUDE.md` — so `main` moving is the only thing that means
 * "there is a newer agent than the one you are running". A dev branch being
 * level with its own remote copy says nothing, and reporting it as "up to
 * date" answered a question nobody asked.
 */
export const UPDATE_BRANCH = 'main';

// ── Which release ────────────────────────────────────────────────────

/**
 * The release a merge brought in, from GitHub's merge subject:
 * `Merge pull request #105 from owner/v6.0/settings-…` → `v6.0`.
 *
 * Branches are named `vN.M/description` and every release reaches `main`
 * through a PR (`CLAUDE.md`), so the merge subjects *are* the version history.
 * `package.json` has said 1.0.0 since the start and is no help.
 */
export function releaseFromSubject(subject) {
  const m = /\bfrom [^/\s]+\/(v\d+\.\d+)\//.exec(String(subject || ''));
  return m ? m[1] : null;
}

/** The newest release merged into `ref`'s first-parent history, or null. */
export async function releaseAt(dir, ref = 'HEAD') {
  const log = await git(dir, ['log', '--merges', '--first-parent', '-50', '--format=%s', ref]);
  for (const subject of (log || '').split('\n')) {
    const v = releaseFromSubject(subject);
    if (v) return v;
  }
  return null;
}

/** How many releases `to` has that `from` does not. */
async function releasesBetween(dir, from, to) {
  const log = await git(dir, ['log', '--merges', '--first-parent', '--format=%s', `${from}..${to}`]);
  return (log || '').split('\n').filter((s) => releaseFromSubject(s)).length;
}

/*
 * What `/update` says, one line each (owner's pick, 2026-10-30, "Compact";
 * the old answer was a bare `✔ Up to date.` and read as bland). Pure, so the
 * wording is tested without git.
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Bare `/update`: `✔ Up to date · v6.0`, or `⬆ v6.0 → v6.2 · 2 releases · /update pull`. */
export function updateLine(state = {}) {
  if (!state.available) return `✔ Up to date${state.version ? ` · ${state.version}` : '.'}`;
  const span = state.version && state.latest && state.version !== state.latest
    ? `${state.version} → ${state.latest}` : null;
  const count = state.releases > 0 ? plural(state.releases, 'release') : plural(state.behind || 0, 'update');
  return `⬆ ${span ? `${span} · ` : ''}${count} · \`/update pull\``;
}

/** After a pull: `✔ Updated v6.0 → v6.2 · 14 files · reload the Chrome extension`. */
export function pulledLine(outcome = {}, { then = '' } = {}) {
  const span = outcome.fromVersion && outcome.toVersion && outcome.fromVersion !== outcome.toVersion
    ? ` ${outcome.fromVersion} → ${outcome.toVersion}` : '';
  const parts = [`✔ Updated${span}`, plural((outcome.files || []).length, 'file')];
  const steps = (outcome.steps || []).map((step) => step.what.charAt(0).toLowerCase() + step.what.slice(1));
  if (steps.length) parts.push(steps.join(', '));
  if (then) parts.push(then);
  return parts.join(' · ');
}

/**
 * Is there a newer agent than this one?
 *
 * Measured against `origin/main` whatever branch you happen to be on. On a
 * feature branch ahead of `main` the answer is no, correctly: nothing has been
 * released that you do not already have.
 *
 * @returns {Promise<{available: boolean, behind: number, branch: string|null,
 *                    upstream: string|null, reason?: string}>}
 */
export async function checkForUpdate(dir) {
  const none = { available: false, behind: 0, branch: null, upstream: null };
  if (!dir) return { ...none, reason: 'no source directory' };

  /*
   * "git could not run" is not "not a git checkout". `git()` folds every
   * failure into null, so on the work laptop — where every spawn failed with
   * EBADF — `/update` told a git checkout it was not one. The first call is
   * the one that tells them apart; the rest can stay quiet.
   */
  const probe = await gitOrError(dir, ['rev-parse', '--is-inside-work-tree']);
  if (probe.cannotRun) return { ...none, reason: `git could not run (${probe.cannotRun})` };
  if (probe.stdout !== 'true') return { ...none, reason: 'not a git checkout' };

  const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);

  // The one network call, and the only reason this is async.
  await git(dir, ['fetch', 'origin', UPDATE_BRANCH, '--quiet'], { timeout: FETCH_TIMEOUT_MS });

  const upstream = `origin/${UPDATE_BRANCH}`;
  const exists = await git(dir, ['rev-parse', '--verify', '--quiet', upstream]);
  if (!exists) return { ...none, branch, reason: `no ${upstream}` };

  const counts = await git(dir, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
  const behind = Number(counts?.split(/\s+/)[1] ?? 0);
  const commits = Number.isFinite(behind) ? behind : 0;

  /**
   * A commit is not an update unless it carries something you do not have.
   *
   * Counting commits says "1 update available" for a **merge commit of your
   * own branch**. Work here lands on `v1-stable` and reaches `main` through a
   * PR, so every merge puts a commit on `main` that your branch does not have
   * — while introducing no content at all, because everything in it came from
   * your branch in the first place. Reported from use: "it says an update is
   * available but I have not merged anything onto main", and the notice was
   * both literally right and useless. Pulling it would have produced a merge
   * in the other direction for no new lines.
   *
   * The three-dot diff is the honest question. `HEAD...upstream` compares the
   * merge base against the upstream tip — *what main has added since we last
   * shared history* — where the two-dot form would also report your own newer
   * commits as differences and never be empty on a branch that is ahead.
   *
   * Exit code only; nothing needs the patch. `null` means git could not
   * answer, and an unanswerable diff falls back to the commit count rather
   * than silently claiming there is nothing to do.
   */
  const noContent = commits > 0
    ? (await gitSucceeds(dir, ['diff', '--quiet', `HEAD...${upstream}`])) === true
    : false;

  return {
    available: commits > 0 && !noContent,
    behind: commits,
    branch,
    upstream,
    // Which releases, for `updateLine`. Local git calls only, after the fetch.
    version: await releaseAt(dir, 'HEAD'),
    latest: await releaseAt(dir, upstream),
    releases: commits > 0 ? await releasesBetween(dir, 'HEAD', upstream) : 0,
    // So a caller can say "already have it" rather than "up to date", which
    // are different facts to someone who just merged their own PR.
    mergedBack: commits > 0 && noContent,
  };
}

/**
 * Is there uncommitted work in the agent's own repo?
 *
 * Asked by `/update` *after* it knows there is something to pull, not before.
 * Checking first meant a repo with local edits was refused with a complaint
 * about those edits even when there was nothing to update — the state of your
 * tree only matters once there is something to apply to it.
 *
 * `null` when it cannot be read, which callers treat as "do not claim it is
 * clean".
 */
export async function isDirty(dir) {
  const tree = await treeState(dir);
  return tree === null ? null : tree.blocking.length > 0;
}

/**
 * A lockfile npm rewrote is not anyone's work.
 *
 * Issue #90, from the work laptop: `/update` said "26 updates available" and
 * refused, every time, over uncommitted changes nobody had made. `npm install`
 * runs from `setup.sh`, from startup recovery and from `/update` itself, and an
 * npm older or newer than the one that wrote `package-lock.json` rewrites it —
 * so one install leaves the tree dirty for good, and the command that is meant
 * to bring the checkout up to date can never run again.
 */
const REGENERABLE = /(^|\/)package-lock\.json$/;

/**
 * What in the tree stands between `/update` and a pull.
 *
 * **Untracked files do not count.** A fast-forward leaves them alone, and if it
 * would add a file at the same path git refuses on its own and the pull reports
 * that. They used to count, and one stray note in the checkout blocked every
 * update.
 *
 * @returns {Promise<{blocking: string[], regenerable: string[]}|null>} the
 *   changed tracked files, split into someone's work and npm's; `null` when the
 *   status cannot be read.
 */
export async function treeState(dir) {
  // -z: a path with a space or a quote is not escaped, and a rename is two
  // entries (new, then old) rather than one with an arrow in it.
  const status = await gitRaw(dir, ['status', '--porcelain', '-z', '--untracked-files=no']);
  if (status === null) return null;
  const entries = status.split('\0').filter(Boolean);
  const blocking = [];
  const regenerable = [];
  for (let i = 0; i < entries.length; i++) {
    const code = entries[i].slice(0, 2);
    const file = entries[i].slice(3);
    if (/[RC]/.test(code)) i++; // the rename's source path follows
    // Only a modification can be put back. A deleted or renamed lockfile is a
    // decision somebody made.
    (REGENERABLE.test(file) && /^[ M]M$|^M $/.test(code) ? regenerable : blocking).push(file);
  }
  return { blocking, regenerable };
}

/** `git()` without the trim, which would eat the leading space of a ` M` row. */
async function gitRaw(dir, args, { timeout = 5000 } = {}) {
  try {
    const { stdout } = await run('git', args, { cwd: dir, timeout, windowsHide: true });
    return stdout;
  } catch {
    return null;
  }
}

/** At most `max` names, then how many more — for a message that has to fit a row or two. */
export function nameFiles(files, max = 5) {
  const shown = files.slice(0, max).map((f) => `\`${f}\``).join(', ');
  return files.length > max ? `${shown} and ${files.length - max} more` : shown;
}

/**
 * Which surfaces a set of changed files touches.
 *
 * The whole value of the feature. A pull that only moved `server/` needs
 * nothing from the user beyond the restart that already happened; one that
 * touched the extension needs two specific actions in a specific order.
 *
 * @param {string[]} files - paths relative to the repo root
 * @returns {Array<{id: string, what: string, how: string}>}
 */
export function reloadSteps(files = []) {
  const steps = [];
  const touched = (re) => files.some((f) => re.test(f));

  // The bundle Chrome actually runs. Reloading the extension is what picks it
  // up; nothing else does.
  if (touched(/^extension\/(service-worker\.js|src\/|manifest\.json)/)) {
    steps.push({
      id: 'extension',
      what: 'Reload the Chrome extension',
      how: 'chrome://extensions → Agent CLI → the reload icon',
    });
  }

  // Content scripts are not bundled and are not re-injected into a page that
  // already has one. The tab keeps the old copy until it is refreshed.
  if (touched(/^extension\/content-scripts\//)) {
    steps.push({
      id: 'tabs',
      what: 'Hard-refresh the model tab',
      how: 'Cmd+Shift+R on gemini.google.com — the page keeps the old content script until you do',
    });
  }

  if (touched(/^vscode-companion\/.*\.vsix$/)) {
    steps.push({
      id: 'companion',
      what: 'Reinstall the VS Code companion',
      how: 'Extensions → ... → Install from VSIX, and pick the newest .vsix',
    });
  }

  return steps;
}

/** Did the pull change anything npm has to re-resolve? */
export const needsInstall = (files = []) =>
  files.some((f) => /(^|\/)package(-lock)?\.json$/.test(f));

/**
 * Pull the upstream, and report what changed.
 *
 * **Refuses on a dirty tree.** Someone's uncommitted work is not ours to
 * rebase, stash or clobber, and an update command that eats an afternoon's
 * edits is worse than no update command. The one exception is a lockfile npm
 * rewrote (`treeState`): it is put back first, and `restored` says so.
 *
 * @returns {Promise<{ok: boolean, error?: string, from?: string, to?: string,
 *                     files?: string[], steps?: Array, install?: boolean,
 *                     restored?: string[]}>}
 */
export async function pullUpdate(dir) {
  const inRepo = await git(dir, ['rev-parse', '--is-inside-work-tree']);
  if (inRepo !== 'true') return { ok: false, error: 'The agent is not running from a git checkout.' };

  const tree = await treeState(dir);
  if (tree === null) return { ok: false, error: 'Could not read the repository status.' };
  if (tree.blocking.length) {
    return {
      ok: false,
      error: `Uncommitted changes in the agent's own repo: ${nameFiles(tree.blocking)}. `
        + 'Commit or stash them first — `/update` will not pull over your work.',
    };
  }
  // The install after the pull writes it again from the new package.json, so
  // nothing is lost by putting it back.
  //
  // `:(top,literal)` because status names paths from the repo root and checkout
  // reads them from `dir`, which is `server/` — so the bare name asked for
  // `server/package-lock.json` and every update with a rewritten lockfile
  // stopped here (#102).
  const restored = tree.regenerable;
  const fromRoot = restored.map((f) => `:(top,literal)${f}`);
  if (restored.length && (await git(dir, ['checkout', 'HEAD', '--', ...fromRoot])) === null) {
    return { ok: false, error: `Could not restore ${nameFiles(restored)} before pulling.` };
  }

  const from = await git(dir, ['rev-parse', 'HEAD']);
  const fromVersion = await releaseAt(dir, 'HEAD');
  // From the same place `checkForUpdate` measured against, or the two would
  // disagree about what an update even is. Fast-forward only: a branch with
  // its own commits is not behind `main` in a way a pull can settle, and
  // merging on someone's behalf is not this command's business.
  const pulled = await git(dir, ['pull', '--ff-only', '--quiet', 'origin', UPDATE_BRANCH],
    { timeout: FETCH_TIMEOUT_MS * 3 });
  if (pulled === null) {
    return {
      ok: false,
      error: `Could not fast-forward to origin/${UPDATE_BRANCH}. `
        + 'This branch has commits of its own, so it needs a merge by hand.',
    };
  }

  const to = await git(dir, ['rev-parse', 'HEAD']);
  const toVersion = await releaseAt(dir, 'HEAD');
  if (from && to && from === to) {
    return { ok: true, from, to, files: [], steps: [], install: false, restored, fromVersion, toVersion };
  }

  const diff = await git(dir, ['diff', '--name-only', `${from}..${to}`]);
  const files = diff ? diff.split('\n').filter(Boolean) : [];
  return {
    ok: true, from, to, files, steps: reloadSteps(files), install: needsInstall(files), restored,
    fromVersion, toVersion,
  };
}

// ── The reminder that survives a restart ─────────────────────────────

/**
 * Steps waiting to be acknowledged.
 *
 * **Not read-once**, unlike the workspace handover it sits beside. The whole
 * failure this prevents is silent — an old bridge answering new server code —
 * so a reminder that scrolls past once and is gone would reproduce it. It stays
 * until the user says they have done it.
 *
 * In the home directory, because the browser extension and the editor companion
 * are yours rather than any one project's.
 *
 * Never throws: a reminder that cannot be written must not fail the update that
 * earned it, and one that cannot be read must not fail startup.
 */
export function savePendingReload(steps, meta = {}) {
  try {
    if (!steps?.length) return false;
    writeFileSync(ensureParent(pendingReloadPath()),
      JSON.stringify({ steps, ...meta, at: Date.now() }, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** @returns {{steps: Array, at?: number, to?: string}|null} */
export function readPendingReload() {
  try {
    const parsed = JSON.parse(readFileSync(pendingReloadPath(), 'utf8'));
    return Array.isArray(parsed?.steps) && parsed.steps.length ? parsed : null;
  } catch {
    return null;
  }
}

/** The user says they have done it. */
export function clearPendingReload() {
  try {
    rmSync(pendingReloadPath(), { force: true });
    return true;
  } catch {
    return false;
  }
}
