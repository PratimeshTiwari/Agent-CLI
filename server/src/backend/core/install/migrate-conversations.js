/**
 * `sessions/` → `conversations/` (v9.9.2), once, for both copies.
 *
 * The old layout spread one conversation over four places (owner: "very
 * confusing"):
 *
 *   sessions/history.jsonl            the conversation in progress
 *   sessions/session-meta.json        its id (`liveId`) and its Gemini chat
 *   sessions/index.jsonl              the list /history shows
 *   sessions/archive.jsonl            turns compaction summarised, all of them
 *   sessions/sessions/<id>.jsonl      a filed conversation
 *   sessions/sessions/<id>-artifacts/ its task list and plans
 *
 * and the home copy kept the same names directly in
 * `~/.agent/workspaces/<slug>/`. The new layout is in `storage/session-store.js`.
 *
 * The rules are `migrate.js`'s: move, never overwrite, a no-op the second time,
 * and never what stops the agent starting. Nothing is deleted: what is left
 * over — a conflict copy like `history 2.jsonl`, a file already at its
 * destination — goes to `~/.agent/trash/<slug>-sessions-<stamp>/`.
 */
import fs from 'fs';
import path from 'path';
import * as paths from '../workspace/paths.js';
import { isConversationId, newSessionId } from '../../storage/session-store.js';

const LIVE = 'history.jsonl';
const META = 'session-meta.json';
const INDEX = 'index.jsonl';
const ARCHIVE = 'archive.jsonl';
const FILED = 'sessions';

/** The names the old layout used, so the home folder's other entries are never touched. */
export const OLD_ENTRIES = [LIVE, META, INDEX, ARCHIVE, FILED];

function move(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
  return true;
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const lines = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length; } catch { return 0; } };

function writeJsonIfAbsent(file, value) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/**
 * Move one copy's old layout into `root`.
 *
 * @param {string} old   the folder holding the old names
 * @param {string} root  the `conversations/` folder to fill
 * @param {(name: string, from: string) => void} leftover  where an unmoved entry goes
 * @returns {string[]} what was moved, as `root`-relative names
 */
export function moveOldLayout(old, root, leftover) {
  const moved = [];
  if (!fs.existsSync(old)) return moved;

  // Filed conversations, each into its own folder.
  const filed = path.join(old, FILED);
  if (fs.existsSync(filed) && fs.statSync(filed).isDirectory()) {
    for (const name of fs.readdirSync(filed)) {
      const from = path.join(filed, name);
      const art = name.match(/^(.+)-artifacts$/);
      const conv = name.match(/^(.+)\.jsonl$/);
      const id = art?.[1] || conv?.[1];
      if (!isConversationId(id)) continue;
      const to = art ? path.join(root, id, 'plans') : path.join(root, id, 'conversation.jsonl');
      if (move(from, to)) moved.push(path.relative(root, to));
    }
  }

  if (move(path.join(old, INDEX), path.join(root, INDEX))) moved.push(INDEX);
  if (move(path.join(old, ARCHIVE), path.join(root, 'compacted.jsonl'))) moved.push('compacted.jsonl');

  // Each filed conversation's chat, beside it, so a folder says which chat it was.
  for (const record of readIndex(path.join(root, INDEX))) {
    if (!isConversationId(record.id) || !fs.existsSync(path.join(root, record.id))) continue;
    if (record.thread || record.leftThread) {
      writeJsonIfAbsent(path.join(root, record.id, 'chat.json'),
        { thread: record.thread || null, leftThread: record.leftThread || null });
    }
  }

  // The conversation in progress: its folder is the id the old meta promised.
  const meta = readJson(path.join(old, META)) || {};
  const live = path.join(old, LIVE);
  const hasLive = lines(live) > 0;
  if (hasLive || meta.thread || meta.leftThread) {
    const id = isConversationId(meta.liveId) ? meta.liveId : newSessionId();
    const target = path.join(root, id, 'conversation.jsonl');
    if (hasLive) {
      // A resumed conversation is also filed under the same id. The live copy is
      // the filed one plus what came after, so the longer copy is kept and the
      // other goes with the leftovers.
      if (fs.existsSync(target) && lines(live) > lines(target)) {
        leftover(`${id}.conversation.jsonl`, target);
      }
      if (move(live, target)) moved.push(path.relative(root, target));
    }
    writeJsonIfAbsent(path.join(root, 'current.json'), { id });
    if (meta.thread || meta.leftThread) {
      writeJsonIfAbsent(path.join(root, id, 'chat.json'),
        { thread: meta.thread || null, leftThread: meta.leftThread || null, updated: meta.updated || Date.now() });
    }
  }
  return moved;
}

function readIndex(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

/** Both copies. Returns `{ moved, leftovers, trash }`; never throws. */
export function migrateConversations(workspace, { now = new Date() } = {}) {
  const result = { moved: [], leftovers: [], trash: null };
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const trash = path.join(paths.homeDir(), 'trash', `${paths.workspaceSlug(workspace)}-sessions-${stamp}`);
  const toTrash = (sub) => (name, from) => {
    try {
      const to = path.join(trash, sub, name);
      if (move(from, to)) { result.leftovers.push(path.join(sub, name)); result.trash = trash; }
    } catch { /* stays where it is; the agent never reads it */ }
  };

  // The workspace copy: the whole old folder goes, leftovers to the trash.
  try {
    const old = paths.oldSessionsDir(workspace);
    if (fs.existsSync(old)) {
      result.moved.push(...moveOldLayout(old, paths.conversationsDir(workspace), toTrash('repo')));
      for (const name of fs.readdirSync(old)) {
        const from = path.join(old, name);
        if (name === '.DS_Store') { fs.rmSync(from, { force: true }); continue; }
        // A folder the move emptied is just removed; one still holding something is a leftover.
        try { fs.rmSync(path.join(from, '.DS_Store'), { force: true }); fs.rmdirSync(from); continue; } catch { /* a file, or not empty */ }
        toTrash('repo')(name, from);
      }
      try { fs.rmdirSync(old); } catch { /* something could not move; it stays */ }
    }
  } catch { /* the old layout stays readable to nobody, and nothing breaks */ }

  // The home copy: only the old names, because the folder holds `conversations/` itself.
  try {
    const home = paths.workspaceHomeDir(workspace);
    if (OLD_ENTRIES.some((n) => fs.existsSync(path.join(home, n)))) {
      result.moved.push(...moveOldLayout(home, paths.homeConversationsDir(workspace), toTrash('home')));
      for (const name of OLD_ENTRIES) {
        const from = path.join(home, name);
        if (!fs.existsSync(from)) continue;
        // A filed folder emptied by the move is just removed.
        try { if (name === FILED) { fs.rmSync(path.join(from, '.DS_Store'), { force: true }); fs.rmdirSync(from); } } catch { /* not empty */ }
        if (fs.existsSync(from)) toTrash('home')(name, from);
      }
    }
  } catch { /* as above */ }

  return result;
}
