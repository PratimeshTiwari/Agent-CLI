/**
 * A `/doctor` change that breaks the next start is undone (v5.30).
 *
 * Asked 2026-10-27: *"if on next startup due to doctor changes something
 * breaks, revert to previous automatically"*. Installing another version or
 * removing a package from the menu rewrites `package.json` and the lockfile,
 * and the running agent never notices — its modules are already loaded. The
 * change is first tried on the next start, which is exactly when there is no
 * menu to undo it from.
 *
 * So, before the change, the manifests and the lockfile are copied to
 * `~/.agent/doctor-change.json` with what is being changed. The next start
 * that stays up for `CONFIRM_AFTER_MS` with the UI drawn confirms it (the
 * record is deleted). A start that exits with an error first is a broken
 * one, and the bin (`index.js`) puts the files back, runs `npm install`,
 * says what it did, and starts again — once: a reverted record is never
 * reverted twice, so a start that fails for some other reason still fails.
 *
 * Built-ins only, like `doctor.js`: it runs from the bin, before tsx, on the
 * machine whose install may be the thing that is broken.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

/** How long a start must stay up, drawn, before the change counts as working. */
export const CONFIRM_AFTER_MS = 8000;

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function home(env = process.env) {
  return env.AGENT_CLI_HOME || env.GEMINI_AGENT_HOME || env.AGENT_HOME || path.join(os.homedir(), '.agent');
}

export const guardFile = (env) => path.join(home(env), 'doctor-change.json');

/** The files a package change rewrites: every manifest and the lockfile. */
function trackedFiles(root) {
  const out = ['package.json', 'package-lock.json'];
  try {
    const ws = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces || [];
    for (const w of Array.isArray(ws) ? ws : ws.packages || []) out.push(path.join(w, 'package.json'));
  } catch { /* the root manifest alone */ }
  return out.filter((f) => fs.existsSync(path.join(root, f)));
}

/**
 * Copy what `change` is about to rewrite. A record still pending from an
 * earlier change is kept rather than replaced: its files are the last state
 * known to start, and two changes in a row should both be undone.
 *
 * @param {{root: string, change: string, env?: object}} opts
 * @returns {boolean} whether there is now a record to revert to
 */
export function snapshotBeforeChange({ root, change, env, pid = process.pid }) {
  const file = guardFile(env);
  try {
    const prior = readRecord(env);
    if (prior?.state === 'pending') {
      prior.changes = [...(prior.changes || []), change];
      fs.writeFileSync(file, JSON.stringify(prior));
      return true;
    }
    const files = {};
    for (const f of trackedFiles(root)) files[f] = fs.readFileSync(path.join(root, f), 'utf8');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // `pid` is the session that made the change: its own exit, crash or not,
    // says nothing about whether the change starts — only a later start does.
    fs.writeFileSync(file, JSON.stringify({ state: 'pending', root, pid, changes: [change], at: new Date().toISOString(), files }));
    return true;
  } catch {
    return false;
  }
}

export function readRecord(env) {
  try { return JSON.parse(fs.readFileSync(guardFile(env), 'utf8')); } catch { return null; }
}

/** The start worked: forget the copy. */
export function confirmChange(env, pid = process.pid) {
  const r = readRecord(env);
  if (r?.state === 'pending' && r.pid !== pid) fs.rmSync(guardFile(env), { force: true });
}

/** Whether an exit status from the child is a start that broke while a change was untried. */
export function shouldRevert(status, env, childPid = null) {
  const r = readRecord(env);
  return typeof status === 'number' && status !== 0 && r?.state === 'pending' && r.pid !== childPid;
}

/**
 * Put the files back and reinstall. Marked `reverted` before anything else, so
 * a crash halfway cannot make the next start try again.
 *
 * @returns {{ok: boolean, changes: string[], error?: string}}
 */
export function revertChange({ env, install = (root) => spawnSync(NPM, ['install'], { cwd: root, stdio: 'inherit', windowsHide: true }) } = {}) {
  const r = readRecord(env);
  if (!r || r.state !== 'pending') return { ok: false, changes: [], error: 'nothing to revert' };
  fs.writeFileSync(guardFile(env), JSON.stringify({ ...r, state: 'reverted', files: undefined, revertedAt: new Date().toISOString() }));
  try {
    for (const [rel, text] of Object.entries(r.files || {})) fs.writeFileSync(path.join(r.root, rel), text);
  } catch (err) {
    return { ok: false, changes: r.changes, error: err.message };
  }
  const res = install(r.root);
  const ok = !res?.error && res?.status === 0;
  return { ok, changes: r.changes, ...(ok ? {} : { error: res?.error?.message || `npm install exited ${res?.status}` }) };
}

/** The notice the next start shows, once, after a revert. */
export function takeRevertNotice(env) {
  const r = readRecord(env);
  if (r?.state !== 'reverted') return null;
  fs.rmSync(guardFile(env), { force: true });
  return `↶ ${r.changes.join(', ')} broke the start, so it was undone · /doctor to look again`;
}
