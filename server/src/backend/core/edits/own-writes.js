/**
 * Paths the agent itself just wrote, so the file watcher does not announce
 * them back as edits "made externally by the user" (v6.15).
 *
 * `FileWatcher.pause()` existed for this and nothing ever called it, so every
 * applied edit came back a second later as a `[System Event]` row: 107 of them
 * in the real histories, each one telling the model the user had touched a
 * file the model had just written. A global pause would also hide a real edit
 * made in the same second, so this is per path: `DiffEngine` notes each path
 * as it writes, and the watcher drops events for that path inside a short
 * window.
 *
 * Process-wide on purpose: the engine and the watcher are built separately in
 * `main.js`, and keyed by absolute path there is nothing to share wrongly.
 */
import path from 'path';

/** How long after our write an event for the same path is ours. The watcher settles for 1s. */
export const OWN_WRITE_WINDOW_MS = 3000;

const writes = new Map(); // absPath -> ms

export function noteOwnWrite(absPath, at = Date.now()) {
  writes.set(path.resolve(absPath), at);
  // Bounded: an old entry can only ever answer "no".
  if (writes.size > 500) {
    for (const [p, t] of writes) if (at - t > OWN_WRITE_WINDOW_MS) writes.delete(p);
  }
}

/**
 * Whether a change first seen at `eventAt` is the agent's own write. An event
 * a little *before* the note counts too: the rename lands, then the note.
 */
export function isOwnWrite(absPath, eventAt = Date.now()) {
  const at = writes.get(path.resolve(absPath));
  if (at == null) return false;
  return eventAt >= at - 500 && eventAt - at <= OWN_WRITE_WINDOW_MS;
}

/** Tests only. */
export function clearOwnWrites() {
  writes.clear();
}
