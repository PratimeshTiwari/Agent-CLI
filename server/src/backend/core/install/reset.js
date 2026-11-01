/**
 * `/reset`: start this repo over, without destroying anything.
 *
 * Asked for: "give me an option to empty the .agent folder so we can start
 * fresh". Three things make it more than `rm -rf .agent`:
 *
 * - **State is in two places.** `<repo>/.agent/` and the durable history copy
 *   at `~/.agent/workspaces/<slug>/`, which exists precisely to survive the
 *   repo copy being wiped. Clearing one brings it back from the other on the
 *   next start (`SessionStore` reconciles them: more turns wins).
 * - **`.agent/` is not always only this repo's.** In a monorepo the root
 *   `.agent/` holds every sibling's scope folder; even in this repo it held a
 *   `server/` scope from an old run. So only entries known to be agent state
 *   move — an allowlist — and everything else stays and is listed. `skills/`
 *   stays too: it is written by a person, like `AGENT.md`.
 * - **Moved, not deleted.** Everything goes to `~/.agent/trash/<slug>-<stamp>/`,
 *   so a reset you regret is a `mv` away. Nothing here ever unlinks.
 *
 * The agent restarts afterwards: the loop, session store and memory hold the
 * old state in memory and would write it straight back.
 */
import fs from 'fs';
import path from 'path';
import { agentDir, homeDir, workspaceHomeDir, workspaceSlug } from '../workspace/paths.js';

/** Entries of a state directory that are agent state. Anything else stays. */
export const STATE_ENTRIES = [
  'artifacts', 'backups', 'context', 'logs', 'sessions', 'state', 'tmp',
  'github-reviews', 'github-pr-plans', 'memory.json',
  'config.json', 'memory.md',
];

/** What `--keep-settings` leaves: your choices and the agent's notes. */
export const SETTINGS_ENTRIES = new Set(['config.json', 'memory.md']);

/**
 * What a reset would move, without moving it.
 *
 * @returns {{ moves: {from: string, to: string, name: string}[], kept: string[],
 *             trashDir: string, stateDir: string }}
 */
export function planReset(workspace, { keepSettings = false, now = new Date() } = {}) {
  const stateDir = agentDir(workspace);
  const home = homeDir();
  if (path.resolve(stateDir) === path.resolve(home)) {
    // resolveState already refuses ~/.agent as a project root; this is the
    // second lock on the door that would empty every project's history.
    throw new Error('Refusing to reset the global ~/.agent directory.');
  }

  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const trashDir = path.join(home, 'trash', `${workspaceSlug(workspace)}-${stamp}`);
  const moves = [];
  const kept = [];

  let entries = [];
  try { entries = fs.readdirSync(stateDir); } catch { /* nothing there */ }
  for (const name of entries) {
    const known = STATE_ENTRIES.includes(name) && !(keepSettings && SETTINGS_ENTRIES.has(name));
    if (known) moves.push({ name, from: path.join(stateDir, name), to: path.join(trashDir, 'repo', name) });
    else kept.push(name);
  }

  const homeCopy = workspaceHomeDir(workspace);
  if (fs.existsSync(homeCopy)) {
    moves.push({ name: '~/.agent history copy', from: homeCopy, to: path.join(trashDir, 'home') });
  }

  return { moves, kept: kept.sort(), trashDir, stateDir };
}

/** Rename, or copy-then-remove across volumes (a repo on another disk). */
function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/**
 * Carry out a plan. Stops at the first failure and says what had moved, so a
 * half-done reset is never reported as done.
 *
 * @returns {{ moved: string[], failed: {name: string, error: string}|null }}
 */
export function applyReset(plan) {
  const moved = [];
  for (const m of plan.moves) {
    try {
      move(m.from, m.to);
      moved.push(m.name);
    } catch (err) {
      return { moved, failed: { name: m.name, error: err.message } };
    }
  }
  return { moved, failed: null };
}
