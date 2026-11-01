/**
 * A large file is read by a subagent, and the main chat gets a digest (v6.16,
 * plan Phase 7).
 *
 * Asked 2026-10-28: *"if subagent is enabled then use subagent for task where
 * files are too large like more than 1200+ line … to keep the main chat noise
 * free … if that fails, main chat gets the thing to do it itself … only if
 * subagent window times out or fails."*
 *
 * `read_file` pages at 800 lines, so a 2,000-line file was three reads, every
 * page typed into the main chat and kept in its thread until compaction. Now
 * an unranged read of a large file goes to a `research` subagent in its own
 * tab, which reads it in pages out of the main chat's sight and returns an
 * outline, the passages that answer the purpose, and how to get exact text.
 *
 * What does **not** delegate, on purpose:
 * - a **ranged** read: a range means the model knows what it wants, and it is
 *   how exact text for an edit is fetched;
 * - a subagent's own reads (they never come through `_executeToolCalls`), so
 *   this cannot recurse;
 * - documents (PDF, Word, slides): their size on disk says nothing about their
 *   text, and counting lines means extracting them first;
 * - a file over 1 MB, which `read_file` refuses whole anyway.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'fs';
import { resolve } from 'path';
import { displayPath } from '../workspace/paths.js';
import { documentKind, looksBinary } from '../../mcp/tools/documents.js';
import { logNotice } from '../logs/error-log.js';

export const LARGE_LINES = 1200;
export const LARGE_BYTES = 80 * 1024;
/** Not the subagent's usual watchdog: a stuck tab should cost a minute and a half, not the turn. */
export const DELEGATE_TIMEOUT_MS = 90_000;
/** The digest's ceiling in the main prompt. The plan's check is "under 6k". */
export const DIGEST_MAX_CHARS = 6000;
const READ_LIMIT_BYTES = 1024 * 1024;

/**
 * Whether this call is a read to hand to a subagent, and what is known about
 * the file if so. Synchronous and cheap: it runs before dispatch, because a
 * delegated read runs in parallel with the rest of the batch.
 *
 * @returns {null | {absPath: string, relPath: string, lines: number, bytes: number}}
 */
export function shouldDelegateRead(call, { workspace, subagentsEnabled, largeFiles } = {}) {
  if (call?.name !== 'read_file' || !subagentsEnabled || largeFiles === 'direct') return null;
  const args = call.args || {};
  if (args.startLine != null || args.endLine != null) return null;
  if (typeof args.path !== 'string' || !args.path.trim()) return null;
  const absPath = args.path.startsWith('/') ? args.path : resolve(workspace, args.path);
  try {
    if (!existsSync(absPath) || documentKind(absPath)) return null;
    const st = statSync(absPath);
    if (!st.isFile() || st.size > READ_LIMIT_BYTES) return null;
    const head = Buffer.alloc(Math.min(8192, st.size));
    const fd = openSync(absPath, 'r');
    try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
    if (looksBinary(head)) return null;
    let lines = 1;
    if (st.size <= LARGE_BYTES) {
      const text = readFileSync(absPath, 'utf8');
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
      if (lines <= LARGE_LINES) return null;
    } else {
      // Over the byte line already (a minified file is few lines and huge);
      // the count is only for the row and the log.
      lines = readFileSync(absPath, 'utf8').split('\n').length;
    }
    return { absPath, relPath: displayPath(workspace, absPath), lines, bytes: st.size };
  } catch {
    return null; // the ordinary read will say what is wrong
  }
}

/** What the subagent is asked. It has no other context. */
export function delegationPrompt({ relPath, lines, purpose }) {
  return [
    `Read the file \`${relPath}\` (${lines.toLocaleString()} lines) for another agent, which will not see it.`,
    `What it is looking for: ${purpose || 'an overview of what this file contains and how it is organised.'}`,
    '',
    'read_file returns at most 800 lines per call; read it in pages with startLine/endLine until you have',
    'what is needed (the whole file if the question is about all of it). Then call return_result with',
    'exactly these three parts, in Markdown:',
    '',
    '## Outline',
    'One line per section, class or function that matters: its name and its line range, e.g.',
    '`- class Invoice (lines 40–312)`.',
    '',
    '## Passages',
    'The parts that answer what it is looking for, quoted exactly, each line prefixed with its line',
    'number (`  412: code`). At most 150 lines in all; prefer the passages over commentary.',
    '',
    '## Notes',
    'Two or three sentences: what the file is, and anything the quote does not show that matters.',
  ].join('\n');
}

/** The digest, cut by whole lines to its ceiling, with the way to the exact text. */
export function digestContent(text, { relPath, lines }) {
  const footer = `\n\nexact text: read_file "${relPath}" with startLine/endLine (the file has ${lines.toLocaleString()} lines; `
    + 'quote from a read, not from this digest, before editing).';
  let body = String(text || '').trim();
  const room = DIGEST_MAX_CHARS - footer.length;
  if (body.length > room) {
    const kept = [];
    let used = 0;
    for (const line of body.split('\n')) {
      if (used + line.length + 1 > room - 40) break;
      kept.push(line);
      used += line.length + 1;
    }
    body = `${kept.join('\n')}\n… digest cut to fit`;
  }
  return `${body}${footer}`;
}

/** A subagent answer worth handing over: something said, and not a tool call. */
export function usableDigest(text) {
  const t = String(text || '').trim();
  return t.length >= 40 && !/^```(json)?\s*[[{][\s\S]*"name"\s*:/.test(t);
}

/**
 * Hand the read to a subagent, and fall back to the ordinary first page if it
 * fails or times out — only then, as asked.
 *
 * @param {object} loop        the AgentLoop
 * @param {object} call        the read_file call
 * @param {object} info        from `shouldDelegateRead`
 * @param {function} readDirect  `() => Promise<{success, result}>`, the ordinary read
 */
export async function runDelegatedRead(loop, call, info, readDirect) {
  const startedAt = Date.now();
  const purpose = String(call.args?.purpose || loop.currentObjective || '').trim().slice(0, 600);
  let outcome;
  let answer = null;
  let rounds = 0;
  try {
    const r = await loop._runSubAgentSession('research', delegationPrompt({ ...info, purpose }),
      loop.mainModel, 'medium', { timeoutMs: DELEGATE_TIMEOUT_MS });
    rounds = r?.rounds || 0;
    if (r?.success && usableDigest(r.result)) {
      answer = r.result;
      outcome = 'digest';
    } else {
      outcome = r?.timedOut ? 'timeout' : r?.success ? 'empty' : 'failed';
    }
  } catch {
    outcome = 'failed';
  }
  const ms = Date.now() - startedAt;
  logNotice(loop.workspace, {
    flow: 'agent', op: 'delegated_read',
    message: outcome === 'digest'
      ? `${info.relPath} (${info.lines} lines) read by a subagent`
      : `${info.relPath}: the subagent ${outcome === 'timeout' ? 'timed out' : 'gave no digest'}; read directly`,
    meta: { lines: info.lines, bytes: info.bytes, ms, rounds, outcome },
  });

  if (answer) {
    return {
      success: true,
      result: {
        path: info.relPath,
        totalLines: info.lines,
        size: `${(info.bytes / 1024).toFixed(1)} KB`,
        delegated: 'subagent',
        content: digestContent(answer, info),
      },
    };
  }

  const direct = await readDirect();
  if (direct?.success && direct.result && typeof direct.result.content === 'string') {
    const why = outcome === 'timeout'
      ? `timed out after ${Math.round(DELEGATE_TIMEOUT_MS / 1000)}s`
      : outcome === 'empty' ? 'it returned nothing usable' : 'it failed';
    const next = direct.result.range?.end < info.lines ? ` continue with startLine=${direct.result.range.end + 1}.` : '';
    direct.result = {
      ...direct.result,
      content: `The subagent could not read this file (${why}). Read it yourself:${next}\n${direct.result.content}`,
    };
  }
  return direct;
}
