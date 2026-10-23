import { watch as fsWatch, existsSync, statSync } from 'fs';
import path from 'path';
import { AgentLoop } from '../core/agent-loop.js';
import { logError } from '../core/error-log.js';

/**
 * FileWatcher
 *
 * Tells the agent when a file in the workspace changes outside it.
 *
 * **It used to take the shell down with it on a large repo.** chokidar 4
 * dropped fsevents, so on macOS it holds roughly one descriptor per watched
 * *file* — 131 directories here cost 852. macOS refuses `posix_spawn` once a
 * process holds a descriptor numbered at or above `OPEN_MAX` (10,240; bisected
 * to the descriptor), so on a work monorepo every spawn after startup failed
 * with `spawn EBADF`: every `run_command`, `run_background`, the browser-open
 * at launch and `/update`'s git. The agent could not run a single command, and
 * the error said nothing about why.
 *
 * Node's own recursive `fs.watch` is FSEvents-backed on macOS and
 * ReadDirectoryChangesW on Windows: one handle for any tree, measured at zero
 * extra descriptors on the tree that cost chokidar 852. chokidar stays on
 * Linux, where recursive watching is per-directory inotify either way.
 */

/**
 * Directory names whose contents are never reported. Matched by path
 * segment: the old regexes matched anywhere, so `distance.rb` and
 * `rebuild.js` were silently ignored as if they were `dist/` and `build/`.
 */
export const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'vendor', 'tmp', 'log', 'coverage',
]);

/** Quiet time before a change is reported — chokidar's `awaitWriteFinish`. */
export const SETTLE_MS = 1000;

/**
 * Whether a workspace-relative path is outside what the agent cares about.
 * Dot segments (`.git`, `.agent`, `.DS_Store`) and the bulk directories above.
 */
export function isIgnored(relPath) {
  // The root itself is '' — and ignoring it means watching nothing at all.
  if (!relPath) return false;
  return relPath.split(/[\\/]/).some((seg) => seg.startsWith('.') || IGNORED_DIRS.has(seg));
}

/** One handle for the whole tree where the platform has one. */
export const NATIVE_RECURSIVE = process.platform === 'darwin' || process.platform === 'win32';

export class FileWatcher {
  /**
   * @param {string} workspacePath
   * @param {AgentLoop} agentLoop
   */
  constructor(workspacePath, agentLoop, { native = NATIVE_RECURSIVE, settleMs = SETTLE_MS } = {}) {
    this.workspacePath = workspacePath;
    this.agentLoop = agentLoop;
    this.watcher = null;
    this.enabled = true;
    this.native = native;
    this.settleMs = settleMs;
    this._pending = new Map(); // relPath -> { timer, sawRename, firstAt }
  }

  async start() {
    try {
      if (this.native) this._startNative();
      else await this._startChokidar();
    } catch (err) {
      // A watcher that cannot start costs a convenience. Throwing here would
      // cost the session, which is the trade the old one made by accident.
      this.watcher = null;
      logError(this._logWorkspace(), {
        flow: 'agent', op: 'file_watcher', level: 'notice',
        message: `File watching is off: ${err.message}`,
        detail: 'Outside edits will not be announced to the agent this session.',
      });
    }
  }

  _startNative() {
    this._startedAt = Date.now();
    this.watcher = fsWatch(this.workspacePath, { recursive: true, persistent: true }, (type, filename) => {
      if (!filename) return;
      const rel = String(filename);
      if (isIgnored(rel)) return;
      this._noteRaw(rel, type === 'rename');
    });
    this.watcher.on('error', (err) => {
      logError(this._logWorkspace(), {
        flow: 'agent', op: 'file_watcher', level: 'notice',
        message: `File watching stopped: ${err.message}`,
      });
      this.stop();
    });
  }

  async _startChokidar() {
    const { default: chokidar } = await import('chokidar');
    this.watcher = chokidar.watch(this.workspacePath, {
      ignored: (p) => isIgnored(path.relative(this.workspacePath, p)),
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: this.settleMs, pollInterval: 100 },
    });
    this.watcher.on('change', (p) => this._handleChange('modified', p));
    this.watcher.on('add', (p) => this._handleChange('added', p));
    this.watcher.on('unlink', (p) => this._handleChange('deleted', p));
  }

  /**
   * A raw native event, settled before it is reported.
   *
   * `fs.watch` says only `rename` or `change`, and an editor's atomic save is
   * several of each. Waiting for quiet and then looking at the disk gives one
   * report per save, worded by what is there now.
   */
  _noteRaw(rel, isRename) {
    const prev = this._pending.get(rel);
    if (prev) clearTimeout(prev.timer);
    const entry = {
      sawRename: Boolean(prev?.sawRename || isRename),
      firstAt: prev?.firstAt ?? Date.now(),
      timer: null,
    };
    entry.timer = setTimeout(() => this._settle(rel, entry), this.settleMs);
    entry.timer.unref?.();
    this._pending.set(rel, entry);
  }

  _settle(rel, entry) {
    this._pending.delete(rel);
    const abs = path.join(this.workspacePath, rel);
    if (!existsSync(abs)) {
      if (entry.sawRename) this._handleChange('deleted', abs);
      return;
    }
    let st;
    try { st = statSync(abs); } catch { return; }
    if (!st.isFile()) return; // chokidar reported files only
    // FSEvents can deliver writes from just before the watch began. A file
    // untouched since then has nothing to report — chokidar's `ignoreInitial`.
    if (st.mtimeMs < this._startedAt && st.birthtimeMs < this._startedAt) return;
    /*
     * New if it was born after the watch began and written as it was born.
     * Compared against the event's *arrival* this was a race: under load
     * FSEvents delivers late, and a brand-new file was reported "modified"
     * (one run in thirteen of the full suite). The file's own timestamps do
     * not depend on when we heard about it.
     */
    const added = entry.sawRename
      && st.birthtimeMs >= this._startedAt
      && st.mtimeMs - st.birthtimeMs <= Math.max(2000, this.settleMs * 2);
    this._handleChange(added ? 'added' : 'modified', abs);
  }

  /** Logs live with the agent's state, which a scoped workspace keeps elsewhere. */
  _logWorkspace() {
    return this.agentLoop?.workspace || this.workspacePath;
  }

  stop() {
    for (const { timer } of this._pending.values()) clearTimeout(timer);
    this._pending.clear();
    if (this.watcher) {
      try { this.watcher.close(); } catch { /* already closed */ }
      this.watcher = null;
    }
  }

  /**
   * Pause the watcher temporarily (e.g. when the agent is writing files itself)
   * to avoid echo loops.
   */
  pause() {
    this.enabled = false;
  }

  resume() {
    this.enabled = true;
  }

  _handleChange(event, filePath) {
    if (!this.enabled) return;

    const relativePath = path.relative(this.workspacePath, filePath);

    // Inject a system event into the conversation history
    const eventTurn = {
      role: 'system',
      type: 'fs_event',
      content: `[System Event] File ${relativePath} was ${event} externally by the user.`,
      timestamp: Date.now()
    };

    if (this.agentLoop && this.agentLoop.conversationHistory) {
      this.agentLoop.conversationHistory.push(eventTurn);
      if (this.agentLoop.sessionStore) {
        this.agentLoop.sessionStore.appendTurn(eventTurn);
      }
    }
  }
}
