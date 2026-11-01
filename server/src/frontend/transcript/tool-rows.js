/**
 * A tool call and its result as transcript rows: the subject, the one-line summary, the
 * clamped output, edit line counts, file-event and question rows.
 *
 * Split out of `format.js` (v8.4) along the groups it already had.
 */

import { normalizeQuestionSet } from '../../backend/core/turn/question.js';
import { oneLine, shortenPath } from '../text.js';

/**
 * One-line description of a tool result, for the collapsed transcript row.
 * Falls back to a hard-clamped snippet for tools without a specific shape.
 */
/**
 * What a tool row is *about*, from the arguments the model sent.
 *
 * `⏺ read_file · 134 lines · 4.9 KB` does not say which file, and two identical
 * rows in one turn are indistinguishable — reported from use, looking at a turn
 * with a 134-line read and a 1,155-line read and no way to tell what either was.
 *
 * From `args` rather than the result, because the request is the thing that is
 * always there: a call that failed has no result to name a path, and that is
 * exactly the row you most want to read.
 *
 * Paths truncate from the **left**, keeping the basename. A row in the live
 * frame is cut from the right by `wrap="truncate"`, so anything that must
 * survive goes on the left of the row — but within the path itself the end is
 * the informative half, and `…/ui/transcript.js` beats `server/src/ui/tra…`.
 *
 * @param {string} toolName
 * @param {object} args - what the model sent
 * @param {number} [max] - characters this may occupy
 * @returns {string} '' when there is nothing worth naming
 */
export function subjectOf(toolName, args, max = 44) {
  const a = args || {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = a[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (Array.isArray(v) && v.length) return v.filter(Boolean).join(', ');
    }
    return '';
  };

  let raw = '';
  let isPath = false;
  switch (toolName) {
    case 'read_file':
    case 'edit_file':
    case 'create_file':
    case 'list_directory':
    case 'undo_edit':
    case 'query_log':
      raw = pick('path', 'filePath', 'file');
      isPath = true;
      break;
    case 'grep_search':
      raw = pick('pattern', 'patterns', 'query');
      break;
    case 'jira_issue':
      // `comment PROJ-12`, `search project = X`: the action and what it is on.
      raw = [pick('action'), pick('key', 'project', 'jql')].filter(Boolean).join(' ');
      break;
    case 'search_files':
      raw = pick('query', 'pattern', 'name');
      break;
    case 'find_symbol':
    case 'find_references':
      raw = pick('symbol', 'name', 'query');
      break;
    case 'run_command':
    case 'run_background':
      raw = pick('command', 'cmd');
      break;
    case 'ask_subagent':
      // The role, not the prompt: the prompt is a paragraph and the role is
      // the thing that distinguishes two otherwise identical rows.
      raw = pick('role');
      break;
    default:
      return '';
  }

  if (!raw) return '';
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;

  // A path keeps its file name and as much of the front as fits; anything
  // else keeps its head, because a command or a pattern is read left to right
  // and its start is what identifies it.
  return isPath ? shortenPath(flat, max) : `${flat.slice(0, max - 1)}…`;
}

const READ_TOOLS = new Set(['read_file', 'grep_search', 'search_files', 'list_directory', 'find_symbol',
  'find_references', 'recall_history', 'get_diagnostics', 'get_editor_state']);
const EDIT_TOOLS = new Set(['edit_file', 'create_file', 'undo_edit']);
const RUN_TOOLS = new Set(['run_command', 'run_background']);

/**
 * What a turn did, by kind: `6 reads · 2 edits · 1 command`.
 *
 * The summary said `9 actions`, which is the same line for a turn that read
 * nine files and one that rewrote nine — the difference a reader scrolls back
 * to find. Empty when the turn ran nothing.
 */
export function workBreakdown(actions = []) {
  let reads = 0; let edits = 0; let runs = 0; let other = 0; let rounds = 0;
  for (const a of actions) {
    if (a.type !== 'tool') continue;
    // Stamped by the loop on each call (agent-loop, callTurn.round).
    if (Number.isFinite(a.msg?.round)) rounds = Math.max(rounds, a.msg.round);
    const name = a.toolName;
    if (READ_TOOLS.has(name)) reads += 1;
    else if (EDIT_TOOLS.has(name)) edits += 1;
    else if (RUN_TOOLS.has(name)) runs += 1;
    else other += 1;
  }
  const n = (count, one, many) => (count ? [`${count} ${count === 1 ? one : many}`] : []);
  return [...n(rounds, 'round', 'rounds'), ...n(reads, 'read', 'reads'), ...n(edits, 'edit', 'edits'), ...n(runs, 'command', 'commands'),
    ...n(other, 'other', 'other')].join(' · ');
}

export function summarizeResult(toolName, result) {
  const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + 's'}`;
  try {
    const r = result;
    switch (toolName) {
      case 'list_directory': {
        // { path, children, totalFiles, totalDirs }
        if (typeof r?.totalFiles === 'number' || typeof r?.totalDirs === 'number') {
          const parts = [];
          if (r.totalDirs) parts.push(plural(r.totalDirs, 'dir'));
          if (r.totalFiles) parts.push(plural(r.totalFiles, 'file'));
          if (parts.length) return parts.join(', ');
        }
        if (Array.isArray(r?.children)) return plural(r.children.length, 'entry', 'entries');
        break;
      }
      case 'read_file':
        // v6.20: a large log answered with query_log's overview.
        if (r?.delegated === 'query_log') return `${plural(Number(r.records || 0).toLocaleString(), 'record')} · log overview`;
        // { path, totalLines, size, content }
        if (typeof r?.totalLines === 'number') {
          // v6.16: a large file read in a subagent's tab.
          if (r.delegated) return `${plural(r.totalLines.toLocaleString(), 'line')} · summarised by a subagent`;
          return `${plural(r.totalLines, 'line')}${r.size ? ` · ${r.size}` : ''}`;
        }
        break;
      case 'query_log':
        // { records, matched } — v6.20
        if (typeof r?.records === 'number') {
          return r.matched === null || r.matched === undefined
            ? plural(r.records.toLocaleString(), 'record')
            : `${r.matched.toLocaleString()} of ${plural(r.records.toLocaleString(), 'record')}`;
        }
        break;
      case 'find_symbol':
        // { found, definitions } — v6.21: it drew its raw JSON until then.
        if (typeof r?.found === 'number') return plural(r.found, 'definition');
        break;
      case 'find_references':
        // { found, files: [{ file, count, lines }] }
        if (typeof r?.found === 'number') {
          const files = Array.isArray(r.files) ? r.files.length : 0;
          return `${plural(r.found, 'reference')}${files ? ` in ${plural(files, 'file')}` : ''}`;
        }
        break;
      case 'grep_search':
      case 'search_files': {
        // { pattern, matchCount, matches } | { query, count, files }
        const n = r?.matchCount ?? r?.count ?? (Array.isArray(r?.matches) ? r.matches.length : null)
          ?? (Array.isArray(r?.files) ? r.files.length : null) ?? (Array.isArray(r?.results) ? r.results.length : null);
        if (typeof n === 'number') return plural(n, 'match', 'matches');
        break;
      }
      case 'run_command':
      case 'run_background': {
        const out = String(typeof r === 'string' ? r : r?.stdout || r?.output || '').trim();
        if (out) return oneLine(out.split('\n')[0]);
        break;
      }
      case 'ask_subagent':
        // v8.4: a subagent that could not run said so only inside a JSON line.
        if (r?.fellBack) return `subagent failed${r.reason ? ` · ${oneLine(r.reason)}` : ''} · doing it in this chat`;
        break;
      case 'jira_issue':
        // v8.1: the first line is the answer (`Created PROJ-45 · …`); a hand-off
        // says whose step it is now.
        if (typeof r === 'string') {
          if (/^HANDED OFF/.test(r)) return '✋ yours to do · Jira did not allow it';
          return oneLine(r.split('\n')[0]);
        }
        break;
      case 'edit_file':
      case 'create_file': {
        /*
         * The approval outcome, when there is one.
         *
         * A rejected edit used to summarise as the whole sentence the *model*
         * was sent — "User REJECTED the edit to AGENT.md. Do not retry the same
         * edit — ask what they want changed." That is an instruction to the
         * model, not a description for the person who just pressed reject and
         * knows perfectly well what they did.
         */
        if (typeof r === 'string') {
          if (/REJECTED/.test(r)) return 'rejected — nothing written';
          if (/APPROVED/.test(r)) return 'approved — written to disk';
        }
        // { diffId, filePath, hunkCount, patch, status }
        if (r?.filePath) {
          const name = String(r.filePath).split('/').pop();
          // Lines, like Claude Code's "3 additions and 1 removal": what a
          // reader wants to know about an edit is how big it is, and a hunk
          // count says nothing about that.
          // Just the counts: the row already names the file it edited, and
          // `docs/billing.md · billing.md · +6 −0` said it twice.
          const delta = lineDelta(r.patch);
          if (delta) return `+${delta.added} −${delta.removed}`;
          return r.hunkCount ? `${plural(r.hunkCount, 'hunk')} in ${name}` : name;
        }
        break;
      }
      default:
        break;
    }
  } catch {
    /* fall through to the generic snippet */
  }
  // Generic fallback: compact, single line. clampForDisplay is not usable here —
  // it appends a newline marker, which would break the row.
  return oneLine(result);
}

/**
 * Lines added and removed in a unified diff, or null without one. The `+++`
 * and `---` file headers are not lines of the file.
 */
export function lineDelta(patch) {
  if (typeof patch !== 'string' || !patch) return null;
  let added = 0;
  let removed = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}

/**
 * Clamp arbitrary tool output for terminal display.
 *
 * Ink can only redraw the dynamic region if it fits the viewport, so output is
 * capped by BOTH line count and total characters — long single lines wrap into
 * many rows and are the real cause of tearing.
 */
export function clampForDisplay(value, maxLines = 15, maxChars = 1200, { hint = '' } = {}) {
  let text = typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
  if (typeof text !== 'string') return '';

  let clipped = false;
  const total = text.split('\n').length;
  const lines = text.split('\n');
  if (lines.length > maxLines) {
    text = lines.slice(0, maxLines).join('\n');
    clipped = true;
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    clipped = true;
  }
  if (!clipped) return text;
  // Claude Code's marker: how much is hidden, and the key that shows it. It
  // said `... [truncated]`, which reads as gone — ctrl+e always had the rest.
  const hidden = total - text.split('\n').length;
  const what = hidden > 0 ? `… +${hidden} line${hidden === 1 ? '' : 's'}` : '… cut';
  return `${text}\n${what}${hint ? ` (${hint})` : ''}`;
}

/**
 * A shell result as a terminal block rather than a JSON dump.
 *
 * `run_command` returns `{exitCode, stdout, stderr, command, cwd}`, and the
 * expanded row used to print that object verbatim — escaped newlines, quoted
 * keys and all, so a page of output arrived as one unreadable line. What the
 * user wants to see is what they would have seen in a shell.
 *
 * @returns {string|null} null when this is not a shell result, so the caller
 *   can fall back to the generic renderer.
 */
export function formatCommandResult(result, maxLines = 20, { hint = '' } = {}) {
  if (!result || typeof result !== 'object') return null;
  const isShellResult = typeof result.exitCode === 'number'
    && ('stdout' in result || 'stderr' in result);
  if (!isShellResult) return null;

  const lines = [];
  if (result.command) lines.push(`$ ${result.command}`);

  const body = [result.stdout, result.stderr].filter((p) => p && p.trim()).join('\n').trimEnd();
  if (body) {
    lines.push(clampForDisplay(body, maxLines, maxLines * 200, { hint }));
  } else if (!result.timedOut) {
    lines.push('(no output)');
  }

  if (result.timedOut) {
    lines.push('⏱ timed out');
  } else if (result.exitCode !== 0) {
    // The exit code is the whole point of showing this expanded, and it is the
    // easiest thing to lose in a wall of output.
    lines.push(`✗ exit ${result.exitCode}`);
  }

  return lines.join('\n');
}

/**
 * The `∙` row for files that changed on disk under the turn.
 *
 * It used to read `∙ 3 files changed on disk — a.js, b.js, c.js` directly
 * beneath a summary line already reading `Worked for 8.1s · 2 actions · 3
 * files changed on disk`. The same count, twice, four rows apart — and the
 * count is the half the summary is *for*, aggregated across every group in
 * the turn, while the paths are the half only this row can carry.
 *
 * So the row drops the number and keeps the names. It is also shorter, which
 * matters more here than it looks: the row is drawn `wrap="truncate"` inside
 * the live frame, cut from the right, and the characters it stops spending on
 * a number it is repeating are characters a path gets instead.
 *
 * With no path parsed there is nothing to name and the summary shows nothing
 * either — `touched` counts paths, not events — so the row has to be
 * self-sufficient in that one case, and says so in words.
 *
 * @param {string[]} paths
 */
export function fsEventRow(paths) {
  const named = (Array.isArray(paths) ? paths : []).filter(Boolean);
  if (named.length === 0) return '∙ a file changed on disk';
  return `∙ changed on disk — ${named.join(', ')}`;
}

/**
 * An answered `ask_question`, drawn the way Claude Code draws one:
 *
 *     ● User answered the agent's questions:
 *       ⎿  · Which database? → Postgres
 *          · Keep the old table? → No
 *
 * It used to be drawn twice and say half of it both times — `⏺ ask_question ·
 * User answered: Postgres` from the loop's record, and a `[System: You
 * answered: Postgres]` row the screen added on its own, which a reprint or a
 * resume never had. Neither showed the question, so a scrollback of answers
 * read as a list of words.
 *
 * The pairs come from the result turn (`answers`, since v5.24). Older history
 * has only the string the model was sent, so they are recovered from that and
 * the call's own arguments: the single shape names no question, and the batch
 * shape carries each one beside its answer.
 *
 * @param {object} args the call's arguments, as the model sent them
 * @param {*} result the result the model was sent
 * @param {{answers?: Array<{question: string, answer: string}>, declined?: boolean}} [turn]
 * @returns {{head: string, rows: string[]}}
 */
export function questionRows(args, result, turn = {}) {
  const text = typeof result === 'string' ? result : '';
  if (turn.declined || /dismissed the question without answering/.test(text)) {
    return { head: 'User declined to answer', rows: [] };
  }
  // A stop while the question was up (App's esc path).
  if (text === 'Cancelled by user') return { head: 'Question cancelled', rows: [] };

  let pairs = Array.isArray(turn.answers) && turn.answers.length ? turn.answers : null;
  if (!pairs) {
    const batch = [...text.matchAll(/^\d+\.\s+(.*)\n\s*→\s*(.*)$/gm)];
    if (batch.length) {
      pairs = batch.map((m) => ({ question: m[1], answer: m[2] }));
    } else {
      const single = /^User answered:\s*([\s\S]*)$/.exec(text);
      const asked = normalizeQuestionSet(args || {})[0];
      // `normalizeQuestion` invents a placeholder for a question with no text;
      // naming that would be naming nothing.
      const named = clean(args?.question) || clean(args?.questions?.[0]?.question)
        || clean(args?.questions?.[0]);
      const question = named ? asked.question : '';
      pairs = [{ question, answer: single ? single[1] : text }];
    }
  }

  const line = (value) => oneLine(value, 400);
  const rows = pairs.map((p) => (p.question
    ? `· ${line(p.question)} → ${line(p.answer)}`
    : `· ${line(p.answer)}`));
  return {
    head: `User answered the agent's question${pairs.length === 1 ? '' : 's'}:`,
    rows,
  };
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
