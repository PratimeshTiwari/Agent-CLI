/**
 * A large log read with `read_file` is answered by `query_log` (v6.20).
 *
 * The tool description says to use `query_log` for any log, and the model
 * will still reach for `read_file` — the habit is older than the tool. An
 * unranged read of a large log pages 800 lines at a time into the browser tab,
 * and a one-line JSON export does not page at all. So the read is answered
 * with the overview a person would start from, headed so the model knows it
 * is not the file and how to narrow it.
 *
 * Only where the prompt offers `query_log` (`logQuery`, prompt v2): a model
 * that has never been told about the tool would be handed advice it cannot
 * follow. A ranged read always reads directly; a range is how exact lines are
 * fetched. It comes before the v6.16 subagent digest, which would only page
 * through the same file in another tab.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'fs';
import { homedir } from 'os';
import { basename, resolve } from 'path';
import { LARGE_BYTES } from '../subagents/delegated-read.js';

const LOG_EXT = /\.(?:log|jsonl|ndjson|csv|tsv)(?:\.gz)?$|\.log\.\d+$|\.json\.gz$/i;
const TIME_KEY = /"(?:@?timestamp|time|ts|date|datetime|_time)"\s*:/i;
const LOG_KEY = /"(?:message|msg|log|line|level|status|severity)"\s*:/i;

/**
 * Whether this call is a large log to answer with `query_log`, and its path if so.
 *
 * @returns {null | {absPath: string, bytes: number}}
 */
export function logReadRedirect(call, { workspace, offered } = {}) {
  if (!offered || call?.name !== 'read_file') return null;
  const args = call.args || {};
  if (args.startLine != null || args.endLine != null || typeof args.path !== 'string') return null;
  const p = args.path.trim();
  const absPath = p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p.startsWith('/') ? p : resolve(workspace, p);
  try {
    if (!existsSync(absPath)) return null;
    const st = statSync(absPath);
    if (!st.isFile() || st.size <= LARGE_BYTES) return null;
    if (LOG_EXT.test(basename(absPath))) return { absPath, bytes: st.size };
    // A `.json` is a log export only if its records look like log records:
    // a time and a message or level. package-lock.json is large and is not.
    if (/\.json$/i.test(absPath)) {
      const head = Buffer.alloc(Math.min(16384, st.size));
      const fd = openSync(absPath, 'r');
      try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
      const text = head.toString('utf8');
      if (TIME_KEY.test(text) && LOG_KEY.test(text)) return { absPath, bytes: st.size };
    }
  } catch {
    return null; // the ordinary read will say what is wrong
  }
  return null;
}

/** The read's answer: `query_log`'s overview, shaped as a read so the row and the prompt say what it is. */
export async function runLogRead(mcpServer, call, info, context) {
  const r = await mcpServer.executeTool('query_log', { path: call.args.path }, context);
  if (!r?.success || typeof r.result?.report !== 'string') {
    // The overview failed; read the file the ordinary way rather than lose the turn.
    return mcpServer.executeTool('read_file', call.args, context);
  }
  return {
    success: true,
    result: {
      path: r.result.path,
      size: `${(info.bytes / 1048576).toFixed(1)} MB`,
      records: r.result.records,
      delegated: 'query_log',
      content: r.result.report,
    },
  };
}
