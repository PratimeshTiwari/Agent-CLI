/**
 * Where things break, written down.
 *
 * Failures in this agent are spread across processes that cannot see each
 * other: a content script in a Chrome tab, the WebSocket bridge, the agent
 * loop, the MCP tools, the GitHub poller, background tasks. When something goes
 * wrong the symptom usually surfaces somewhere far from the cause — a dead turn
 * in the terminal for a selector that changed in the tab, an empty PR plan for
 * an expired token — and until now none of it was recorded anywhere. The
 * console was the only sink, and console output inside an Ink app is destroyed
 * by the next repaint.
 *
 * So: one JSONL file per workspace, one line per failure, tagged with the flow
 * it came from. Greppable, and `/logs` reads it back grouped by flow, which is
 * the question actually being asked — "what is breaking?"
 *
 * Two rules this module holds to:
 *   - It never throws. An error logger that can fail is worse than none, and
 *     every caller is already on a failure path.
 *   - It collapses repeats. A poller failing every tick, or a crash loop,
 *     would otherwise bury everything else — the 401-per-interval bug wrote the
 *     same line hundreds of times.
 *   - It separates **failures** from **notices**. Three days of logs held 274
 *     rows of which 76% were one optional subsystem, and most of those were
 *     *expected states*: a background `discover_models` at connect, before any
 *     tab exists, correctly declining to open one — logged as a failure every
 *     session. While that is true nobody can look at `/logs` and see a
 *     regression, which is the only thing the log is for.
 *
 * A notice is written to the same file, collapsed the same way, and shown by
 * `/logs <flow>` the same way. What it does not do is count as a failure. That
 * distinction is a `level` field, present only on notices, so that every line
 * written before this existed reads as a failure — which is the honest reading
 * of history, not a convenient one.
 *
 * **Demote, never drop.** The temporary `picker_trace` instrumentation is what
 * found the relay-drift bug in one run after five wrong theories had been
 * shipped; a log that discards what is merely *expected* is a log that cannot
 * be used to find out why an expectation was wrong. The test is whether a
 * reader should act on the row, not whether it is interesting.
 */

import fs from 'fs';
import path from 'path';
import * as paths from './paths.js';

/**
 * The flows a failure can belong to. Keep this list short enough to scan.
 *
 * `github` names a product that was deleted in `e375aed` and is kept
 * deliberately, marked. Nothing writes it any more, but log files written
 * before the removal still hold `github/poll` rows — ten in this workspace —
 * and dropping the label would render that history under a bare key instead of
 * a sentence. Saying "removed" is what stops a reader concluding from a `/logs`
 * heading that the poller is still running and still failing.
 */
export const FLOWS = {
  bridge: 'WebSocket bridge to the browser',
  extension: 'Chrome extension / content script',
  agent: 'Agent loop, prompts and responses',
  tool: 'MCP tool execution',
  github: 'GitHub PR agent (removed — only old logs carry this)',
  task: 'Background tasks',
  diff: 'Edits and diff approval',
  context: 'Indexing, memory and context',
  storage: 'Session history and state files',
  ui: 'Terminal UI',
};

const MAX_BYTES = 512 * 1024;   // rotate past this; one previous file is kept
const MAX_DETAIL = 2000;        // a stack trace is useful, a core dump is not
const REPEAT_WINDOW_MS = 60000; // identical failures inside this collapse

/**
 * Repeats being counted rather than written, keyed by workspace + signature.
 *
 * Holding the count in memory alone would lose it: a failure that repeats 500
 * times and then stops would show as a single line, and the number — the most
 * useful part — would never reach disk. So pending counts are flushed once
 * their window expires, and `summarizeErrors` adds whatever is still pending.
 */
const recent = new Map();

function appendRecord(file, record) {
  paths.ensureParent(file);
  rotate(file);
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/**
 * Write the tally line for one collapsed signature.
 *
 * One function because there are two callers — `flushExpired`, when a window
 * closes, and `flushPending`, on process exit — and they had a copy each. The
 * duplication was not theoretical: deleting the level from one of them left the
 * whole suite green, because every test reached the other. Two copies of "write
 * the tally" is how one of them ends up forgetting.
 */
function writeTally(state) {
  try {
    appendRecord(paths.errorLogPath(state.workspace), {
      time: new Date(state.at).toISOString(),
      flow: state.flow,
      op: state.op,
      message: state.message,
      // Carried, or the collapse silently promotes a notice back to a failure:
      // the tally is the only line reaching disk for repeats 2..N, so a storm of
      // 50 notices would read as 49 failures and one notice.
      ...(state.level === 'notice' ? { level: 'notice' } : {}),
      // A tally line stands for repeats only — it is not itself another
      // occurrence. Counting it as one is how a storm of 12 read as 13.
      tally: true,
      repeatedSince: state.count,
    });
  } catch {
    /* the next flush will try again; on exit there is nothing further to try */
  }
}

/**
 * Write out the tally for any signature whose window has closed.
 *
 * Called on every log write, which is the only clock this module has. A
 * failure that stops recurring gets its count recorded the next time anything
 * else fails; if nothing else ever fails, `summarizeErrors` still counts it
 * from memory.
 */
function flushExpired(now) {
  for (const [key, state] of recent) {
    if (now - state.at < REPEAT_WINDOW_MS) continue;
    if (state.count > 0) writeTally(state);
    recent.delete(key);
  }
}

const truncate = (value, max = MAX_DETAIL) => {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === 'string' ? value : (() => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  })();
  return text.length > max ? `${text.slice(0, max)}… [+${text.length - max} chars]` : text;
};

function rotate(file) {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
    fs.renameSync(file, `${file.replace(/\.jsonl$/, '')}.1.jsonl`);
  } catch {
    /* no file yet, or the rename raced another write */
  }
}

/**
 * Record a failure.
 *
 * @param {string} workspace
 * @param {object} entry
 * @param {keyof FLOWS} entry.flow - which part of the system failed
 * @param {string} entry.op - the operation, e.g. 'inject_prompt', 'poll'
 * @param {string} entry.message - one line, the thing that went wrong
 * @param {any} [entry.detail] - stack, payload, whatever helps
 * @param {object} [entry.meta] - small structured extras (taskId, prNumber…)
 * @param {'error'|'notice'} [entry.level] - `notice` for an expected state that
 *   is worth a record and is not a failure. Written only when it is `notice`,
 *   so an absent field means failure and every pre-existing line reads as one.
 * @returns {object|null} the entry written, or null if it was a collapsed repeat
 */
export function logError(workspace, entry) {
  try {
    if (!workspace || !entry?.flow || !entry?.message) return null;

    const now = Date.now();
    flushExpired(now);

    const message = String(entry.message).split('\n')[0].slice(0, 400);
    const op = entry.op || null;
    const level = entry.level === 'notice' ? 'notice' : 'error';
    // Keyed by workspace too: one process can serve more than one. Level is in
    // the key because collapsing across it would file one under the other, and
    // which one wins would depend on call order.
    const key = `${workspace}\u0000${entry.flow}\u0000${op}\u0000${level}\u0000${message}`;

    const previous = recent.get(key);
    if (previous && now - previous.at < REPEAT_WINDOW_MS) {
      previous.count++;
      previous.at = now;
      return null; // collapsed; the tally is written when the window closes
    }

    recent.set(key, { at: now, count: 0, workspace, flow: entry.flow, op, message, level });

    const record = {
      time: new Date(now).toISOString(),
      flow: entry.flow,
      op,
      message,
      // Only on notices. A `level: 'error'` on every line would be four bytes
      // per row saying what the absence of it already says, and it would make
      // the pre-level history look like a different kind of record.
      ...(level === 'notice' ? { level } : {}),
      detail: truncate(entry.detail),
      meta: entry.meta,
    };

    appendRecord(paths.errorLogPath(workspace), record);
    return record;
  } catch {
    return null; // logging must never be the thing that breaks
  }
}

/**
 * Record an expected state: worth keeping, not a failure.
 *
 * Use it when a reader should *not* act on the row. A background poll declining
 * because there is no tab yet, a build mismatch that needs a reload rather than
 * a diagnosis, a search falling back to an equivalent slower path — all three
 * were indistinguishable from real breakage in `/logs` and together made up
 * most of it.
 *
 * The bar is deliberately "should someone act on this?" and not "is this
 * interesting?". A row nobody can act on teaches people to stop reading the
 * log, which costs more than whatever the row was recording.
 */
export function logNotice(workspace, entry) {
  return logError(workspace, { ...entry, level: 'notice' });
}

/** A logger bound to one workspace and flow, for call sites that log a lot. */
export function flowLogger(workspace, flow) {
  return (op, message, detail, meta) => logError(workspace, { flow, op, message, detail, meta });
}

/**
 * The level of a record, for lines written before the field existed.
 *
 * Absent means failure. That is the honest default: those rows were written by
 * call sites that believed they were reporting breakage, and re-reading history
 * as calmer than it was would hide the very trend the level exists to expose.
 */
const levelOf = (record) => (record?.level === 'notice' ? 'notice' : 'error');

/**
 * Read recent entries, newest first.
 *
 * `level` filters; omitting it returns **both**, which is what drilling into a
 * flow wants. A notice beside the failure it preceded is most of what makes a
 * failure diagnosable — the point of demoting was to stop notices being
 * *counted* as failures, not to hide them from the person reading the detail.
 *
 * @param {{ flow?: string, limit?: number, level?: 'error'|'notice' }} [options]
 */
export function readErrors(workspace, { flow, limit = 50, level } = {}) {
  const out = [];
  for (const file of [paths.errorLogPath(workspace), paths.errorLogPath(workspace).replace(/\.jsonl$/, '.1.jsonl')]) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (flow && record.flow !== flow) continue;
        if (level && levelOf(record) !== level) continue;
        out.push(record);
      } catch {
        /* a truncated final line from a write in flight */
      }
    }
    if (out.length >= limit) break;
  }
  return out.reverse().slice(0, limit);
}

/**
 * What is breaking, by flow — the question `/logs` is actually answering.
 * @returns {{ total: number, since: string|null, byFlow: Array<{flow, label, count, last, lastMessage}> }}
 */
/**
 * Every failure, each carrying how many occurrences it stands for.
 *
 * Two sources, one accounting. Lines on disk each stand for themselves plus any
 * tally already written onto them; entries still inside their collapse window
 * have not reached disk at all and stand only for their repeat count. Getting
 * this wrong double-counts the first occurrence of every storm.
 *
 * Exported because anything counting failures has to get this right, and there
 * is no second way to do it — `channel-health.js` counts by `op` where
 * `summarizeErrors` counts by `flow`, and both need this weighting.
 *
 * `pending` marks the ones that have not reached disk, which is what `since`
 * has to exclude — "failures since <time>" is a claim about the log file.
 *
 * `level` filters both sources, so a caller counting failures cannot be handed
 * notices by the in-memory half after the on-disk half was filtered — which is
 * the shape of bug this whole module's pending/on-disk split keeps producing.
 *
 * @returns {Array<{record: object, weight: number, pending: boolean}>}
 */
export function weightedErrors(workspace, { limit = 1000, level } = {}) {
  const onDisk = readErrors(workspace, { limit, level })
    .map((r) => ({ record: r, weight: r.tally ? (r.repeatedSince || 0) : 1, pending: false }));

  const pending = [];
  for (const state of recent.values()) {
    if (state.workspace !== workspace || state.count === 0) continue;
    if (level && state.level !== level) continue;
    pending.push({
      record: {
        flow: state.flow,
        op: state.op,
        message: state.message,
        ...(state.level === 'notice' ? { level: 'notice' } : {}),
        time: new Date(state.at).toISOString(),
      },
      weight: state.count,
      pending: true,
    });
  }

  return [...pending, ...onDisk];
}

export function summarizeErrors(workspace) {
  /*
   * Failures only, and the notices counted separately beside them.
   *
   * This is the whole of "make the log honest". `total` drove a menu and a
   * heading that said *"N failures logged"*, and over 09-25 → 09-27 N was 274
   * of which roughly ten were failures. A number that is wrong by a factor of
   * twenty-five is not a number anyone can notice a regression in, and the
   * response it trained was to stop opening `/logs` at all.
   *
   * The notices are surfaced rather than dropped, because "quiet day, 40
   * notices" and "quiet day, 0 notices" are different days — the first one has
   * a background poll firing at a tab that never exists.
   */
  const entriesAll = weightedErrors(workspace, { level: 'error' });
  const onDisk = entriesAll.filter((e) => !e.pending);
  const noticeEntries = weightedErrors(workspace, { level: 'notice' });

  const byFlow = new Map();
  for (const { record, weight } of entriesAll) {
    const bucket = byFlow.get(record.flow)
      || { flow: record.flow, count: 0, last: null, lastMessage: null };
    bucket.count += weight;
    if (!bucket.last || record.time > bucket.last) {
      bucket.last = record.time;
      bucket.lastMessage = record.message;
    }
    byFlow.set(record.flow, bucket);
  }

  let noticeLast = null;
  let noticeMessage = null;
  for (const { record } of noticeEntries) {
    if (!noticeLast || record.time > noticeLast) {
      noticeLast = record.time;
      noticeMessage = record.message;
    }
  }

  return {
    total: entriesAll.reduce((n, e) => n + e.weight, 0),
    since: onDisk.length > 0 ? onDisk[onDisk.length - 1].record.time : null,
    byFlow: [...byFlow.values()]
      .map((b) => ({ ...b, label: FLOWS[b.flow] || b.flow }))
      .sort((a, b) => b.count - a.count),
    notices: {
      count: noticeEntries.reduce((n, e) => n + e.weight, 0),
      last: noticeLast,
      lastMessage: noticeMessage,
    },
  };
}

/**
 * Write out every pending repeat tally, whatever its window.
 *
 * Registered on process exit below. Without it the tail of a storm dies with
 * the process: the log would show "401 Bad credentials" once when it actually
 * happened five hundred times, and the number is the whole point.
 */
export function flushPending() {
  for (const [key, state] of recent) {
    if (state.count > 0) writeTally(state);
    recent.delete(key);
  }
}

// Only sync writes are legal in an exit handler, which is all appendRecord does.
process.once('exit', flushPending);

/** Delete the log. Returns how many entries went. */
export function clearErrors(workspace) {
  const cleared = readErrors(workspace, { limit: 100000 }).length;
  for (const file of [paths.errorLogPath(workspace), paths.errorLogPath(workspace).replace(/\.jsonl$/, '.1.jsonl')]) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
  recent.clear();
  return cleared;
}
