/**
 * Session Store — one folder per conversation (v9.9.2).
 *
 *   <workspace>/.agent/conversations/
 *     index.jsonl                 the list /history shows, one record per filing
 *     current.json                { "id": … } — the conversation in progress
 *     compacted.jsonl             turns compaction summarised (session-recall.js)
 *     <id>/conversation.jsonl     every turn, written from the first one
 *     <id>/chat.json              which Gemini chat it is held in
 *     <id>/plans/                 its task list and plans, moved here when filed
 *
 * and the same `conversations/` under `~/.agent/workspaces/<name>-<hash>/`,
 * written on every turn: the workspace copy is the one you can see, the home
 * copy survives a clean checkout or a wiped `.agent/`. On load the current
 * conversation and the index are reconciled — the longer copy wins.
 *
 * Before v9.9.2 the live conversation was a rolling `sessions/history.jsonl`
 * that filing *copied* into `sessions/sessions/<id>.jsonl`, with its meta in
 * `session-meta.json` and its plans in `<id>-artifacts/`. Now the conversation
 * lives in its folder from the start, so filing is an index line and a pointer
 * dropped. `core/install/migrate.js` moves the old layout once.
 */

import fs from 'fs';
import path from 'path';
import { logError } from '../core/logs/error-log.js';
import { conversationsDir, homeConversationsDir, artifactsDir } from '../core/workspace/paths.js';

const CURRENT = 'current.json';
const CONVERSATION = 'conversation.jsonl';
const CHAT = 'chat.json';
const INDEX = 'index.jsonl';

/** An id is a folder name: nothing that could climb out of `conversations/`. */
export const isConversationId = (id) =>
  typeof id === 'string' && /^[\w.-]+$/.test(id) && id !== '.' && id !== '..';

/**
 * Sortable, filename-safe, and readable — the id doubles as the date.
 *
 * To the millisecond, so the id is readable as a date without opening
 * anything. It is **not** the sort key: two sessions in the same millisecond
 * fall back to the random suffix. The index is append-only and its order is
 * the true one — the only scheme that stays correct across processes.
 */
export function newSessionId(now = new Date()) {
  return `${now.toISOString().replace(/[:.]/g, '-').slice(0, 23)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** The conversation in progress in a workspace, without a store: `session-recall.js` searches it. */
export function currentConversationFile(workspace) {
  const root = conversationsDir(workspace);
  const id = readJson(path.join(root, CURRENT))?.id;
  return isConversationId(id) ? path.join(root, id, CONVERSATION) : null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) || null; } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function countLines(file) {
  try {
    return fs.readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim() !== '').length;
  } catch {
    return -1;
  }
}

function readTurns(file) {
  return fs.readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

export class SessionStore {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.localRoot = conversationsDir(workspacePath);
    this.homeRoot = homeConversationsDir(workspacePath);
    this._reconcile();
  }

  /** Both copies, in write order. */
  get _roots() {
    return [this.localRoot, this.homeRoot];
  }

  _conversationFile(root, id) {
    return path.join(root, id, CONVERSATION);
  }

  /** The conversation in progress, or null when none has started. */
  _currentId() {
    for (const root of this._roots) {
      const id = readJson(path.join(root, CURRENT))?.id;
      if (isConversationId(id)) return id;
    }
    return null;
  }

  _setCurrent(id) {
    this._writeBoth((root) => writeJson(path.join(root, CURRENT), { id }));
  }

  /** The current id, starting a conversation if there is none. */
  _ensureId() {
    let id = this._currentId();
    if (!id) {
      id = newSessionId();
      this._setCurrent(id);
    }
    return id;
  }

  /**
   * Make the two copies agree, preferring whichever holds more: the pointer,
   * the current conversation and the index. Runs once at construction, which is
   * also what restores a workspace copy that was lost.
   */
  _reconcile() {
    try {
      const [local, home] = this._roots;
      const sync = (rel) => {
        const a = countLines(path.join(local, rel));
        const b = countLines(path.join(home, rel));
        if (a === -1 && b === -1) return;
        const [from, to] = b > a ? [home, local] : a > b ? [local, home] : [null, null];
        if (!from) return;
        fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
        fs.copyFileSync(path.join(from, rel), path.join(to, rel));
      };
      sync(CURRENT);
      sync(INDEX);
      const id = this._currentId();
      if (id) {
        sync(path.join(id, CONVERSATION));
        sync(path.join(id, CHAT));
      }
    } catch (err) {
      logError(this.workspacePath, {
        flow: 'storage', op: 'reconcile',
        message: `Could not reconcile session copies: ${err.message}`, detail: err.stack,
      });
    }
  }

  /** Run `fn(root)` for both copies, reporting per-copy failures without throwing. */
  _writeBoth(fn) {
    for (const root of this._roots) {
      try {
        fs.mkdirSync(root, { recursive: true });
        fn(root);
      } catch (err) {
        logError(this.workspacePath, {
          flow: 'storage', op: 'write',
          message: `Error writing ${path.basename(root)}: ${err.message}`,
          meta: { root },
        });
      }
    }
  }

  /**
   * Append a single turn to both copies.
   * @param {Object} turn
   */
  appendTurn(turn) {
    const id = this._ensureId();
    const line = JSON.stringify(turn) + '\n';
    this._writeBoth((root) => {
      fs.mkdirSync(path.join(root, id), { recursive: true });
      fs.appendFileSync(this._conversationFile(root, id), line, 'utf-8');
    });
  }

  /**
   * Rewrite the entire conversation (e.g. after compaction).
   * @param {Array<Object>} history
   */
  saveHistory(history) {
    const id = this._ensureId();
    const lines = history.map((turn) => JSON.stringify(turn)).join('\n') + '\n';
    this._writeBoth((root) => {
      fs.mkdirSync(path.join(root, id), { recursive: true });
      fs.writeFileSync(this._conversationFile(root, id), lines, 'utf-8');
    });
  }

  /**
   * The current conversation, preferring the workspace copy (already reconciled).
   * @returns {Array<Object>}
   */
  loadHistory() {
    const id = this._currentId();
    if (!id) return [];
    const file = this._roots.map((r) => this._conversationFile(r, id)).find((f) => fs.existsSync(f));
    if (!file) return [];
    try {
      return readTurns(file);
    } catch (err) {
      logError(this.workspacePath, {
        flow: 'storage', op: 'load',
        message: `Error loading history: ${err.message}`, detail: err.stack,
      });
      return [];
    }
  }

  /**
   * Remember which browser conversation this session was held in.
   *
   * Kept beside the history rather than inside it: the turns are the human's
   * record and this is a fact about the *model's* memory — whether a future
   * resume can carry on, or has to explain what happened first.
   *
   * Best-effort, like everything else here. A session that cannot record its
   * thread is a session that will be offered as "view", which is the safe
   * answer anyway.
   */
  setThread(thread) {
    if (!thread?.id) return;
    this._writeThreadMeta({ thread, leftThread: null });
  }

  /**
   * We walked away from that conversation, and there is not a new one yet.
   *
   * The third state, and it was missing. Stored thread was either **an id** or
   * **absent**, where absent means "this session never reached a thread" — so
   * there was no way to say "it reached one and we deliberately left it".
   *
   * Nothing could write that state even by accident. `setThread` opens with
   * `if (!thread?.id) return`, so passing null is a no-op; `startNewChat()`
   * nulled `chatThread` in memory and never touched disk; and a fresh chat is
   * `/app` with **no id until its first exchange**, so `_recordThread` had
   * nothing to overwrite the old id with. Between the handover and the first
   * reply, memory said "no thread" and disk said the abandoned one — and both
   * resume paths read disk. `/compact` and `/new` call `startNewChat()` today,
   * so the window is real and not hypothetical.
   *
   * A separate method rather than relaxing `setThread`. That guard is
   * load-bearing: it stops a URL with no id — which is every brand-new chat —
   * from wiping a good record. Clearing is something a caller has to ask for.
   *
   * `leftThread` is kept rather than discarded for the reason `previousThread`
   * is kept in memory: a handover you cannot look back from is a reset with a
   * nicer name.
   *
   * @param {{model: string, id: string}|null} [previous] the one being left
   */
  clearThread(previous = null) {
    this._writeThreadMeta({
      thread: null,
      leftThread: previous?.id ? previous : null,
    });
  }

  /** One writer for both, so the two states cannot be written inconsistently. */
  _writeThreadMeta(fields) {
    const id = this._ensureId();
    const existing = this._threadMeta(id);
    this._writeBoth((root) => writeJson(path.join(root, id, CHAT), { ...existing, ...fields, updated: Date.now() }));
  }

  /** The conversation this session is held in **now**, or `null`. */
  getThread() {
    return this._threadMeta().thread || null;
  }

  /**
   * The id this conversation is kept under — and the one printed when the CLI
   * exits, as `agent --resume <id>`.
   *
   * Asked for directly: show the resume id on exit, as Claude Code does. The
   * conversation's folder is named by it from the first turn, so the id at
   * exit, the id in `/history` and the id `--resume` accepts are one id.
   */
  liveId() {
    return this._ensureId();
  }

  /** The current id if a conversation has started, without starting one. */
  peekLiveId() {
    return this._currentId();
  }

  /** Is there a conversation worth resuming — one the user actually spoke in? */
  hasUserTurn() {
    return this.loadHistory().some((t) => t.role === 'user' && typeof t.content === 'string');
  }

  /**
   * The conversation this session was in before a handover, or `null`.
   *
   * Only meaningful when `getThread()` is null: together they are the third
   * state. A caller that reads only `getThread()` sees "no thread" and does
   * the safe thing anyway, which is why this is additive rather than a
   * breaking change.
   */
  getLeftThread() {
    const meta = this._threadMeta();
    return meta.thread ? null : (meta.leftThread || null);
  }

  _threadMeta(id = this._currentId()) {
    if (!id) return {};
    for (const root of this._roots) {
      const meta = readJson(path.join(root, id, CHAT));
      if (meta) return meta;
    }
    return {};
  }

  /**
   * Past conversations, newest first.
   *
   * `--sessions` and `--resume <id>` were in `--help`, parsed into config, and
   * read by nothing until conversations survived the start of the next one.
   *
   * @returns {Array<{id, started, updated, turns, title, thread}>}
   */
  listSessions() {
    const file = this._roots.map((r) => path.join(r, INDEX)).find((f) => fs.existsSync(f));
    if (!file) return []; // no sessions yet is the ordinary first-run case
    try {
      return fs.readFileSync(file, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean)
        .reverse()
        // Newest record per id. A resumed conversation keeps its id, so filing
        // it again appends a second record for the same conversation, now
        // longer — one row, the latest.
        .filter((r, i, all) => all.findIndex((o) => o.id === r.id) === i);
    } catch {
      return [];
    }
  }

  _isFiled(id) {
    return this.listSessions().some((r) => r.id === id);
  }

  /**
   * Put the current conversation on the list, so the next one does not replace it.
   *
   * Always followed by `clear()` at the call sites. The conversation is already
   * in its folder, so filing is an index record, its plans moved in beside it,
   * and the pointer dropped — nothing is copied.
   *
   * The title is the first thing the user said, because that is what a person
   * scanning a list is actually looking for — not a timestamp, and not a
   * summary nobody asked a model to write.
   *
   * @returns {string|null} the id it was filed under, or null if there was
   *   nothing worth keeping
   */
  rollover() {
    const id = this._currentId();
    if (!id) return null;
    const turns = this.loadHistory();
    if (turns.length === 0) return null;

    const firstUser = turns.find((t) => t.role === 'user' && typeof t.content === 'string');

    /**
     * A conversation the user never spoke in is not one.
     *
     * `file-watcher.js` appends `[System Event] File X was modified` turns
     * whenever anything on disk changes, so leaving the agent open in an
     * editor session manufactures history with no prompt in it. Filing those
     * put **6 of 19** rows into this user's `/history` picker, every one of
     * them reading `Untitled`. `clear()` drops such a folder instead.
     */
    if (!firstUser) return null;

    const title = (firstUser.content || 'Untitled')
      .replace(/\s+/g, ' ').trim().slice(0, 72);

    const record = {
      id,
      title,
      turns: turns.length,
      started: turns[0]?.timestamp ?? null,
      updated: turns[turns.length - 1]?.timestamp ?? Date.now(),
      thread: this.getThread(),
      // Null unless the session ended after a handover with no new thread yet.
      // Without it a filed session that was deliberately left is indistinguish-
      // able from one that never reached a browser at all, and `planResume`
      // offers "view" — which is safe, and wrong: there *is* a transcript worth
      // replaying into a fresh chat.
      leftThread: this.getLeftThread(),
    };

    try {
      // The artifacts belong to the conversation, not to the workspace.
      //
      // Reported from use: open the agent fresh, type nothing, and the status
      // row already reads "task.md · walkthrough.md" — a finished plan from a
      // conversation that had just been filed away. Worse than untidy, because
      // `task.md` is also fed back to the model every turn.
      this._archiveArtifacts(id);
      this._writeBoth((root) => fs.appendFileSync(path.join(root, INDEX), JSON.stringify(record) + '\n', 'utf-8'));
      // Filed: the next conversation is a new one with a new id.
      this._dropCurrent();
    } catch (err) {
      logError(this.workspacePath, {
        flow: 'storage', op: 'rollover',
        message: `Could not file the previous session: ${err.message}`,
      });
      return null;
    }
    return id;
  }

  _dropCurrent() {
    for (const root of this._roots) {
      try { fs.rmSync(path.join(root, CURRENT), { force: true }); } catch { /* the other copy still answers */ }
    }
  }

  /** The documents a conversation wrote for the user to read. */
  static get ARTIFACTS() {
    return ['task.md', 'plan.md', 'implementation_plan.md', 'walkthrough.md'];
  }

  _artifactDir() {
    return artifactsDir(this.workspacePath);
  }

  _sessionArtifactDir(id) {
    return path.join(this.localRoot, id, 'plans');
  }

  /**
   * Move this conversation's artifacts in with it.
   *
   * Moved, not copied: leaving them behind is the bug. Only the local copy —
   * they are working documents for the person in this checkout, where the home
   * copy exists to survive losing it.
   */
  _archiveArtifacts(id) {
    const from = this._artifactDir();
    const to = this._sessionArtifactDir(id);
    for (const name of SessionStore.ARTIFACTS) {
      const src = path.join(from, name);
      if (!fs.existsSync(src)) continue;
      try {
        fs.mkdirSync(to, { recursive: true });
        fs.renameSync(src, path.join(to, name));
      } catch (err) {
        logError(this.workspacePath, {
          flow: 'storage', op: 'archive_artifacts',
          message: `Could not file ${name}: ${err.message}`,
        });
      }
    }
  }

  /** Put a resumed conversation's artifacts back where the agent looks. */
  _restoreArtifacts(id) {
    const from = this._sessionArtifactDir(id);
    if (!fs.existsSync(from)) return;
    const to = this._artifactDir();
    for (const name of SessionStore.ARTIFACTS) {
      const src = path.join(from, name);
      if (!fs.existsSync(src)) continue;
      try {
        fs.mkdirSync(to, { recursive: true });
        fs.copyFileSync(src, path.join(to, name));
      } catch (err) {
        logError(this.workspacePath, {
          flow: 'storage', op: 'restore_artifacts',
          message: `Could not restore ${name}: ${err.message}`,
        });
      }
    }
  }

  /**
   * Make a past conversation the current one.
   *
   * Restores its thread too, so `planResume` can still tell whether the model
   * remembers it. The one in progress is filed first (`--resume` used to
   * overwrite it), unless it is the one asked for.
   *
   * @returns {Array<Object>|null} the turns, or null if there is no such session
   */
  resumeSession(id) {
    if (!isConversationId(id)) return null;
    const source = this._roots.map((r) => this._conversationFile(r, id)).find((f) => fs.existsSync(f));
    if (!source) return null;

    try {
      const turns = readTurns(source);
      const current = this._currentId();
      if (current && current !== id) {
        this.rollover();
        this.clear();
      }
      // A conversation only the home copy kept comes back into the workspace too.
      for (const root of this._roots) {
        const file = this._conversationFile(root, id);
        if (file !== source && !fs.existsSync(file)) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.copyFileSync(source, file);
        }
      }
      // It goes on being that conversation: exit prints the same id, and
      // filing it again updates its row rather than adding a copy.
      this._setCurrent(id);
      const record = this.listSessions().find((r) => r.id === id);
      if (record?.thread) this.setThread(record.thread);
      // Its plan and its walkthrough come back with it, or the conversation is
      // restored without the documents it was about.
      this._restoreArtifacts(id);
      return turns;
    } catch (err) {
      logError(this.workspacePath, {
        flow: 'storage', op: 'resume',
        message: `Could not resume ${id}: ${err.message}`,
      });
      return null;
    }
  }

  /**
   * End the current conversation. A filed one stays in its folder; one that was
   * never filed — `/clear`, or nothing but file-watcher rows — is removed.
   */
  clear() {
    const id = this._currentId();
    if (!id) return;
    if (!this._isFiled(id)) {
      for (const root of this._roots) {
        try {
          fs.rmSync(path.join(root, id), { recursive: true, force: true });
        } catch (err) {
          logError(this.workspacePath, {
            flow: 'storage', op: 'clear',
            message: `Error clearing ${id}: ${err.message}`,
            meta: { root },
          });
        }
      }
    }
    this._dropCurrent();
  }
}
