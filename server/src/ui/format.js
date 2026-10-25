/**
 * Turning tool results and markdown into terminal-shaped text.
 *
 * Kept out of App.jsx because none of it touches React: these are the functions
 * the transcript rows call while rendering, and they are worth testing directly.
 */

import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { normalizeQuestionSet } from '../core/question.js';

/**
 * `tab` indents lists *and* code blocks, and the two wanted different things.
 *
 * It was 2, and a drag-select over a fenced block took those two spaces with
 * it — so every code block had to be re-indented by hand after pasting it
 * anywhere. There is no clickable copy button here and there cannot be: that
 * needs mouse tracking, which suppresses drag-select and would take away the
 * thing being fixed. So it went to 0.
 *
 * **That flattened every nested list**, reported from use with the Gemini tab
 * and the CLI side by side: `marked` parsed the nesting correctly and
 * `marked-terminal` drew all of it at one level, because `tab` is what it
 * indents children by. Two levels of bullets is how Gemini writes anything
 * structured, so this was the more expensive half.
 *
 * It is back to 2, and the code blocks stay copy-clean, because they no longer
 * reach `marked` at all — `renderMarkdown` lifts fenced blocks out first and
 * `renderBlock` draws them, un-indented, with a dim rule marking the edges.
 * Fixing the second bug is what made the first fix unnecessary.
 */
marked.use(markedTerminal({
  tab: 2,
  width: 100,
  showSectionPrefix: false,
  tableOptions: {
    style: { head: ['cyan'] }
  }
}));

/**
 * Lists are drawn from the token tree, not from `marked-terminal`'s.
 *
 * Its list renderer is line-based: `listitem` prefixes every item with a `* `
 * marker, and `list` then rewrites those markers a line at a time — replacing
 * each one with `n. ` when the list is ordered. Nested lists are rendered
 * first, so by the time the outer list scans, its body already holds the
 * child's finished, indented lines, and `isPointedLine` matches those too
 * (`^(?:indent)*(?:\*|\d+\.)`). The parent therefore numbers its children as
 * if they were its own items, and keeps counting:
 *
 *     1. Install the deps        1. Install the deps
 *       * with npm         -->     * with npm
 *       2. with pnpm               * with pnpm
 *     3. Run it                  2. Run it
 *
 * Both wrong columns come from one counter. It only bites when the *outer*
 * list is ordered — the unordered path leaves an already-marked line alone —
 * which is why "numbered list with sub-points", the shape Gemini reaches for
 * whenever it explains steps, was the one that came out wrong.
 *
 * A token walk cannot have the bug: an item's children are rendered into that
 * item's body and never re-scanned by its parent. The indent is the item's own
 * content column, the same rule the content scripts use when they scrape a
 * list back out of the page — `- ` is two, `1. ` is three, `10. ` is four.
 */
marked.use({
  renderer: {
    /**
     * Code blocks are drawn plainly, whichever way they were written.
     *
     * `renderMarkdown` lifts **fenced** blocks out before `marked` sees them
     * and draws them with `renderBlock` — no colour, dim rules top and
     * bottom, copy-clean. An **indented** block never matched that lift, so
     * it fell through to `marked-terminal`, which syntax-highlights it. The
     * result was backwards: the shape this project controls and has a
     * deliberate design for came out plain, while the rare untagged
     * four-space shape came out coloured, with auto-detected language.
     *
     * Measured with colour forced on: a fenced block rendered 6 ANSI spans,
     * all of them `renderBlock`'s rules with an uncoloured body; an indented
     * one rendered 14, with `42` green and `function` blue.
     *
     * Drawing it here rather than lifting it out is deliberate. Four-space
     * indentation is also how a list continues, and a regex that hunts for
     * indented blocks cannot tell the two apart — `marked` already can, so
     * the fix belongs where `marked` hands the block over.
     */
    code(token) {
      return renderBlock(String(token.lang || '').trim(), String(token.text ?? ''));
    },

    /**
     * Tables are drawn here, for the reason code blocks are.
     *
     * `marked-terminal` hands them to `cli-table3`, which sizes to **content**
     * and ignores the `width` option entirely. Measured on a three-column
     * table from a real reply: **158 visible columns**, whatever the terminal
     * is. At 90 columns every one of those lines wraps, and a wrapped border
     * is not a narrow table — it is the top-left corner of a box on one line
     * and the rest of it on the next, which is what was reported.
     *
     * Asking the model to emit a custom tag instead was considered and is the
     * wrong half of the system to change: it costs prompt budget on every
     * refresh turn, it is ignored some fraction of the time, and a markdown
     * table is what the model writes unprompted. **The renderer is ours to
     * control; the output format is not.** Same argument that moved code
     * blocks off `marked-terminal`.
     *
     * A table is also the one element that must never be wrapped by Ink —
     * `wrap="truncate"` would cut the right border off and `wrap="wrap"`
     * destroys the box — so this is the only renderer that has to know the
     * terminal width.
     */
    table(token) {
      const cell = (c) => this.parser.parseInline(c.tokens).replace(/\n+/g, ' ').trim();
      const header = (token.header || []).map(cell);
      const rows = (token.rows || []).map((r) => r.map(cell));
      if (header.length === 0) return '';

      const natural = header.map((h, i) => Math.max(
        visibleWidth(h),
        ...rows.map((r) => visibleWidth(r[i] ?? '')),
      ));
      const widths = fitColumns(natural, renderWidth);

      const rule = (l, mid, r) => DIM + l + widths.map((w) => '─'.repeat(w + 2)).join(mid) + r + RESET;
      const line = (cells) => {
        const wrapped = cells.map((c, i) => wrapAnsi(c ?? '', widths[i]));
        const height = Math.max(1, ...wrapped.map((w) => w.length));
        const out = [];
        for (let i = 0; i < height; i += 1) {
          const parts = wrapped.map((w, c) => {
            const text = w[i] ?? '';
            return ` ${text}${' '.repeat(Math.max(0, widths[c] - visibleWidth(text)))} `;
          });
          out.push(`${DIM}│${RESET}${parts.join(`${DIM}│${RESET}`)}${DIM}│${RESET}`);
        }
        return out.join('\n');
      };

      return [
        '',
        rule('┌', '┬', '┐'),
        line(header.map((h) => `${BOLD}${h}${RESET}`)),
        rule('├', '┼', '┤'),
        ...rows.map((r) => line(r)),
        rule('└', '┴', '┘'),
        '',
        '',
      ].join('\n');
    },

    list(token) {
      let n = Number(token.start || 1);
      const lines = token.items.map((item) => {
        // A hollow bullet, dimmed: `*` read as unrendered markdown (reported
        // with a screenshot). Width is counted from the visible marker, not the
        // escape codes around it.
        const shown = token.ordered ? `${n++}. ` : '◦ ';
        const marker = token.ordered ? shown : `${DIM}◦${RESET} `;
        const tick = item.task ? (item.checked ? '[X] ' : '[ ] ') : '';
        // A tight item's text is a `text` token holding inline children, and
        // marked-terminal's block `text` renderer returns it raw — which is how
        // `- \`docs/\`` came out with its backticks still on. Render those
        // children as inline markdown, the way a paragraph is.
        const tokens = item.tokens.map((t) => (t.type === 'text' && t.tokens
          ? { type: 'html', raw: this.parser.parseInline(t.tokens), text: this.parser.parseInline(t.tokens), block: true, pre: false }
          : t));
        const body = this.parser
          .parse(tokens, !!item.loose)
          // A loose item's first child is a block and opens with its own
          // newline, which would otherwise land straight after the marker.
          .replace(/^\s+/, '')
          .trimEnd()
          // Continuation lines — a nested list, a second paragraph, a fenced
          // block — sit under the text, not under the marker.
          .replace(/\n(?=[^\n])/g, `\n${' '.repeat(shown.length + tick.length)}`);
        return `${marker}${tick}${body}`;
      });
      // Leading newline so the list separates from the text above it; the
      // trailing pair is the blank line every block element ends with here.
      return `\n${lines.join('\n')}\n\n`;
    },
  },
});

/**
 * A fenced block: its indentation, its language, then the body.
 *
 * The indent is captured and the closing fence must match it, because a fence
 * inside a list item is indented to that item's content column — "1. Run
 * this:" followed by the block is a shape the model writes constantly. Anchored
 * at column 0 this missed all of them, so they reached `marked` as ordinary
 * code and came out without the rules that mark a block's edges, and `ctrl+y`
 * could not see them at all. An unindented fence captures an empty group and
 * behaves exactly as before.
 */
const FENCE = /^([ \t]*)```([^\n`]*)\n([\s\S]*?)^\1```[ \t]*$/gm;

/** Give back the lines of a lifted block without the indent that held it. */
const dedent = (code, indent) => (indent
  ? code.replace(new RegExp(`^${indent}`, 'gm'), '')
  : code);

/**
 * The fenced code blocks in a reply, in the order they appear.
 *
 * Exported because `/copy code` copies the last one, and reaching into a rendered
 * string to find it again would mean parsing the rules back out of prose that
 * may legitimately contain them.
 *
 * @returns {Array<{lang: string, code: string}>}
 */
export function extractCodeBlocks(content) {
  const out = [];
  for (const m of String(content || '').matchAll(FENCE)) {
    out.push({ lang: (m[2] || '').trim(), code: dedent(m[3], m[1]).replace(/\n$/, '') });
  }
  return out;
}

/** Dim, so the rules read as furniture rather than as part of the code. */
const DIM = '\x1b[2m';
const RESET = '\x1b[22m';
// `22m` is "normal intensity", which ends bold and dim alike — one reset for
// both, and it does not clobber a colour the way `0m` would.
const BOLD = '\x1b[1m';

/**
 * A block, bounded by rules that a drag does not pick up.
 *
 * The rule is as wide as the block's own longest line, capped at 60: it can
 * never be wider than the code beside it, so it cannot wrap a frame that the
 * code itself fits in. Widening it to the terminal would need the width passed
 * down through every caller, to draw a line nobody needs longer.
 */
function renderBlock(lang, code) {
  const lines = code.split('\n');
  const width = Math.min(60, Math.max(8, ...lines.map((l) => l.length)));
  const label = lang ? `\u2500 ${lang} ` : '';
  const top = label + '\u2500'.repeat(Math.max(2, width - label.length));
  const bottom = '\u2500'.repeat(width);
  return `${DIM}${top}${RESET}\n${code}\n${DIM}${bottom}${RESET}`;
}

/**
 * How many columns a string occupies, ignoring the escapes that colour it.
 *
 * Every alignment bug in this file has been the same one: `padEnd` counts
 * code units, and a coloured string is mostly escape bytes. The box was drawn
 * by padding strings that carried chalk's output, so every row came out a
 * different width and the right border zig-zagged.
 */
/**
 * The width the next render should fit into.
 *
 * Module state rather than a threaded parameter because `marked.use` installs
 * the renderers once, at import, and they take only their token. Set by
 * `renderMarkdown` before it parses; the render cache is keyed on it, so two
 * widths cannot serve each other's output.
 */
let renderWidth = 80;

const ANSI = /\x1b\[[0-9;]*m/g;
export const visibleWidth = (s) => String(s).replace(ANSI, '').length;

/**
 * Wrap to `width` columns without cutting an escape sequence in half.
 *
 * Walks the string rather than wrapping the stripped copy, because a cell can
 * contain an inline code span and re-emitting it uncoloured to make the
 * arithmetic easy would lose the one thing that marks it as code. Escapes
 * cost zero columns and travel with the text.
 *
 * Breaks at the last space that fits; a token longer than the column is cut,
 * because the alternative is a row wider than the table claims to be.
 */
export function wrapAnsi(text, width) {
  const w = Math.max(1, width);
  const out = [];
  let line = '';
  let col = 0;
  let lastSpace = -1;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*m/.exec(text.slice(i));
      if (m) { line += m[0]; i += m[0].length - 1; continue; }
    }
    const ch = text[i];
    if (ch === '\n') { out.push(line); line = ''; col = 0; lastSpace = -1; continue; }
    if (ch === ' ') lastSpace = line.length;
    // A break can land just before a space — the hard-cut path especially —
    // and a continuation line that opens with one is off by a column against
    // every other row in the cell.
    if (ch === ' ' && col === 0) continue;
    line += ch;
    col += 1;
    if (col >= w) {
      // Break at the last space if there was one, so words stay whole.
      if (lastSpace > 0) {
        out.push(line.slice(0, lastSpace));
        line = line.slice(lastSpace + 1);
        col = visibleWidth(line);
      } else {
        out.push(line);
        line = '';
        col = 0;
      }
      lastSpace = -1;
    }
  }
  if (line.length > 0 || out.length === 0) out.push(line);
  return out;
}

/**
 * Fit column widths into the terminal, taking from the widest first.
 *
 * Proportional shrinking is the obvious approach and is wrong here: it takes
 * as much from a 6-column `Status` as from a 70-column `Verdict`, and the
 * narrow columns are the ones that cannot afford it. Taking from the widest
 * each round converges on "every column as wide as it needs, and the prose
 * column absorbs the shortfall", which is what a person does by hand.
 */
export function fitColumns(natural, budget, min = 6) {
  const cols = [...natural];
  // Two border columns per cell (`│ ` and ` `), plus the closing `│`.
  const chrome = cols.length * 3 + 1;
  let total = cols.reduce((a, b) => a + b, 0) + chrome;
  // A guard, not a loop bound: every round removes a column from the widest,
  // so it terminates — but a bug here would hang the renderer, and this is on
  // the path that draws every reply.
  for (let guard = 0; total > budget && guard < 10000; guard += 1) {
    const widest = cols.indexOf(Math.max(...cols));
    if (cols[widest] <= min) break;
    cols[widest] -= 1;
    total -= 1;
  }
  return cols;
}

/** Collapse any value to a single line of at most `max` characters. */
export function oneLine(value, max = 60) {
  const text = String(typeof value === 'string' ? value : JSON.stringify(value ?? {}))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

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
      raw = pick('path', 'filePath', 'file');
      isPath = true;
      break;
    case 'grep_search':
      raw = pick('pattern', 'patterns', 'query');
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

/**
 * `app/models/billing/invoice.rb` in `max` characters as `app/…/invoice.rb`.
 *
 * It was the last `max - 1` characters with `…` in front, which in a monorepo
 * is `…ling/invoices/line_item.rb` — the first directory, which says *which*
 * part of the repo, was always the part removed. Keeps the first segment and
 * the most trailing segments that fit; falls back to the tail when even the
 * file name does not fit.
 */
export function shortenPath(p, max) {
  if (p.length <= max) return p;
  const parts = p.split('/');
  if (parts.length < 3) return `…${p.slice(-(max - 1))}`;
  // '' for an absolute path, so it comes out `/…/tail` — `'/'` here gave `//…/`.
  const head = parts[0];
  let tail = parts[parts.length - 1];
  for (let i = parts.length - 2; i > 0; i--) {
    const next = `${parts[i]}/${tail}`;
    if (`${head}/…/${next}`.length > max) break;
    tail = next;
  }
  const out = `${head}/…/${tail}`;
  return out.length <= max ? out : `…${p.slice(-(max - 1))}`;
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
        // { path, totalLines, size, content }
        if (typeof r?.totalLines === 'number') {
          return `${plural(r.totalLines, 'line')}${r.size ? ` · ${r.size}` : ''}`;
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
 * The status bar's context field.
 *
 * Far from the threshold it is `18% of 96k`. Within twenty points it says
 * how far is left, in Claude Code's words — `18% until auto-compact`, down to
 * `0% until auto-compact`, when your next message compacts before it is sent —
 * and drops the budget, which is the part nobody acts
 * on. It used to append ` · 18% to auto-compact` / ` · compacts after this
 * turn` to the full field, and the right side of the bar does not shrink, so
 * the hint pushed the left side (`agent · scope · /help`) off the row.
 */
export function contextField(pct, limit, compactAtPct) {
  const toGo = compactAtPct - pct;
  // Claude Code's words. At 0% the next message you send compacts first.
  if (toGo <= 20) return `${Math.max(0, toGo)}% until auto-compact`;
  return `${pct}% of ${limit >= 1000 ? `${Math.round(limit / 1000)}k` : limit}`;
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
export function clampForDisplay(value, maxLines = 15, maxChars = 1200) {
  let text = typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
  if (typeof text !== 'string') return '';

  let clipped = false;
  const lines = text.split('\n');
  if (lines.length > maxLines) {
    text = lines.slice(0, maxLines).join('\n');
    clipped = true;
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    clipped = true;
  }
  return clipped ? `${text}\n... [truncated]` : text;
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
export function formatCommandResult(result, maxLines = 20) {
  if (!result || typeof result !== 'object') return null;
  const isShellResult = typeof result.exitCode === 'number'
    && ('stdout' in result || 'stderr' in result);
  if (!isShellResult) return null;

  const lines = [];
  if (result.command) lines.push(`$ ${result.command}`);

  const body = [result.stdout, result.stderr].filter((p) => p && p.trim()).join('\n').trimEnd();
  if (body) {
    lines.push(clampForDisplay(body, maxLines, maxLines * 200));
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
 * Markdown for a transcript row, memoised by source text.
 *
 * `marked.parse` is not cheap and a turn re-renders whenever anything in the
 * live frame ticks, so parsing the same reply on every frame showed up as
 * tearing. The cache is bounded and keyed on the raw content — the same string
 * always produces the same rendering.
 *
 * The two regexes run before marked because `marked-terminal` mangles inline
 * bold inside list items, so bold is pre-baked as raw SGR (see CLAUDE.md).
 */
const RENDER_CACHE = new Map();
const RENDER_CACHE_MAX = 200;

export function renderMarkdown(content, width = 80) {
  const source = content || '';
  // Keyed on the width too: the table renderer fits itself to it, so the same
  // markdown has a different correct answer at 72 columns and at 200.
  const key = `${width}\u0000${source}`;
  const hit = RENDER_CACHE.get(key);
  if (hit !== undefined) return hit;
  renderWidth = Math.max(20, width);

  let out;
  try {
    /**
     * Fenced blocks are lifted out before marked sees them, and put back after.
     *
     * Rendering each segment separately instead would break anything spanning a
     * block — a list with code in an item stops being one list. A sentinel on
     * its own line survives as a paragraph, so marked still parses one document
     * and the block still gets drawn by `renderBlock` rather than by
     * `marked-terminal`, which has no way to mark an edge.
     *
     * The token is deliberately plain: marked escapes and rewrites punctuation,
     * and a sentinel that does not come back out is a code block deleted.
     */
    const blocks = [];
    const stashed = source.replace(FENCE, (_m, indent, lang, code) => {
      blocks.push(renderBlock((lang || '').trim(), dedent(code, indent).replace(/\n$/, '')));
      // The sentinel drops the indent, so the restored block sits flush left
      // even inside a list item. Carrying the indent would put it back only on
      // the block's *first* line — the restored text is several lines and the
      // sentinel is one — and indenting all of them is the thing this file
      // decided against at the top: a drag-select takes the leading spaces
      // with it, and there is no copy button to fall back on. Flush left also
      // closes the list, which costs nothing: the item after it carries its
      // own `start`, so the numbering continues.
      return `x0codeblock${blocks.length - 1}x0`;
    });

    out = marked
      .parse(stashed
        .replace(/\*\*(.*?)\*\*/g, '\x1b[1m$1\x1b[22m')
        .replace(/^###\s+(.*$)/gm, '\x1b[1;32m$1\x1b[0m'))
      .trim()
      // Every block here ends in a blank line and the list renderer opens with
      // one, so a list after a paragraph is separated twice. Safe to collapse
      // at this point and not after: the fenced blocks, the one place a run of
      // blank lines is content, are still standing in as sentinels.
      .replace(/\n{3,}/g, '\n\n');

    out = out.replace(/x0codeblock(\d+)x0/g, (m, i) => blocks[Number(i)] ?? m);
  } catch {
    out = source;
  }

  // Oldest-first eviction: Map preserves insertion order, so the first key is
  // the least recently added.
  if (RENDER_CACHE.size >= RENDER_CACHE_MAX) {
    RENDER_CACHE.delete(RENDER_CACHE.keys().next().value);
  }
  RENDER_CACHE.set(key, out);
  return out;
}


/**
 * Lay text out as a full-width block, for the user's own message.
 *
 * Ink's `backgroundColor` paints the *characters*, not the line, so a
 * background applied to ordinary text stops where the words stop — a ragged
 * highlight rather than the bar Claude Code draws. Getting a bar means wrapping
 * and padding here rather than letting Ink wrap, because only the side doing
 * the wrapping can pad each resulting line.
 *
 * Padded to `width - 1`, not `width`. Filling the final column leaves the
 * cursor in a deferred-wrap state that some terminals resolve by moving to the
 * next line — which would insert a blank row per line of the block, and rows
 * that appear without being budgeted are how the live frame outgrows the
 * viewport.
 *
 * Long words are broken rather than allowed to overhang: a path or a URL wider
 * than the terminal would otherwise push past the padding and break the bar on
 * exactly the messages most likely to contain one.
 *
 * @param {string} text
 * @param {number} width - the terminal's column count
 * @param {number} [indent] - columns the caller draws before the text
 * @returns {string[]} one padded line per rendered row
 */
export function blockLines(text, width, indent = 0) {
  const inner = Math.max(8, (Number(width) || 80) - 1 - indent);
  const out = [];

  for (const paragraph of String(text ?? '').split('\n')) {
    if (paragraph === '') { out.push(''.padEnd(inner)); continue; }
    let line = '';
    for (const word of paragraph.split(' ')) {
      let w = word;
      // A single word longer than the line gets broken, not overhung.
      while (w.length > inner) {
        if (line) { out.push(line.padEnd(inner)); line = ''; }
        out.push(w.slice(0, inner));
        w = w.slice(inner);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= inner) line += ` ${w}`;
      else { out.push(line.padEnd(inner)); line = w; }
    }
    out.push(line.padEnd(inner));
  }
  return out;
}

/**
 * The agent's reply, bounded while the turn is still in the live frame.
 *
 * **This row was unbounded, and it is the one rule this directory has.** A
 * live turn lives in Ink's repainted frame, and a frame taller than the
 * viewport makes Ink write `ESC[2J ESC[3J` and repaint on *every* render —
 * which destroys the terminal's scrollback. `shown` in `TranscriptTurn`
 * carefully caps the action rows at `liveBudget`; the reply underneath then
 * rendered in full regardless.
 *
 * Reported as "it gave me much more output but I received only a portion of
 * it". The text was never lost — `history.jsonl` held all of it and
 * `renderMarkdown` returns all of it, both checked — it was never drawn.
 *
 * **The first version of this counted `\n`, and that was the same bug again.**
 * A 1,450-character reply is 18 source lines and **26 rendered rows at 100
 * columns**, so an 18-line clamp against a 14-row budget passed untouched
 * while the frame still overflowed by twelve rows. This file's own rule says
 * it: a row that wraps is two. So the budget is spent in *wrapped* rows, at
 * the width the terminal actually is.
 *
 * Clamped only while live. The committed copy goes to `<Static>`, is written
 * once and never repainted, and is the one the user reads — so it stays
 * whole, and the rest of the reply appears there a moment later.
 */
export function liveMessageText(text, budget, width = 80) {
  const maxRows = Math.max(3, (Number(budget) || 12) - 2);
  const cols = Math.max(20, Number(width) || 80);
  const source = String(text ?? '');
  const lines = source.split('\n');

  // How many rows each source line will actually occupy once wrapped.
  const rowsFor = (line) => Math.max(1, Math.ceil(line.length / cols));

  let used = 0;
  let kept = 0;
  for (const line of lines) {
    const next = used + rowsFor(line);
    // The marker costs a row of its own, so stop while there is room for it.
    if (kept > 0 && next > maxRows - 1) break;
    used = next;
    kept += 1;
  }
  if (kept >= lines.length) return source;

  return `${lines.slice(0, kept).join('\n')}\n… +${lines.length - kept} more lines`;
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

/**
 * The command list, grouped, for `/help` and for "no such command".
 *
 * **One renderer because there were two lists.** `/help` built its own and the
 * unknown-command path built another, three characters different in the
 * padding. That is the shape of the drift this list has already suffered:
 * CLAUDE.md records a hand-kept copy advertising `/init-skills` and
 * `/paste-image` after both were gone. Generating from `SLASH_COMMANDS` fixed
 * the *data* drifting; two renderers left the *presentation* free to.
 *
 * Unknown groups are printed under a trailing heading rather than dropped. A
 * command added with a `group` nobody put in `COMMAND_GROUPS` would otherwise
 * work perfectly and be invisible on the one screen that exists to list it —
 * failing silently, in the direction that is hardest to notice.
 *
 * @param {Array<{name: string, desc: string, group?: string}>} commands
 * @param {Array<[string, string]>} groups - `[key, heading]`, in print order
 * @returns {string}
 */
export function renderCommandList(commands, groups) {
  const width = Math.max(...commands.map((c) => c.name.length));
  const known = new Set(groups.map(([key]) => key));
  const sections = [...groups, ['', 'Other']]
    .map(([key, heading]) => [heading, commands.filter((c) => (key
      ? c.group === key
      : !known.has(c.group)))])
    .filter(([, list]) => list.length > 0);

  const out = [];
  for (const [heading, list] of sections) {
    // A blank row between sections, not above the first: the caller has
    // already printed a heading above this.
    if (out.length) out.push('');
    /*
     * Bold at column 0, rows indented four.
     *
     * Both halves are what markdown does rather than what looks tidy in the
     * source. A heading's own leading spaces are insignificant and get
     * stripped, so indenting it achieves nothing — which is also why the flat
     * list this replaces was written with two spaces and drew at column 0.
     * Four spaces *are* preserved, so they are what actually nests the
     * commands under their heading.
     */
    out.push(`**${heading}**`);
    for (const c of list) out.push(`    /${c.name.padEnd(width)}   ${c.desc}`);
  }
  return out.join('\n');
}

/**
 * The transcript's one row for a compaction, Claude Code style.
 *
 * It used to be a paragraph from the assistant (`🗜 Context compacted — ✓
 * Compacted 14 turns, summarised by this chat; continuing in a fresh chat,
 * with the full history still searchable.`), drawn as a reply with a `●` — so
 * a notice read as an answer. The summary is behind ctrl+e, which already
 * means "show me the detail of every step".
 */
export function compactionRow(turns, verbose = false) {
  const n = Number.isFinite(turns) && turns > 0 ? ` · ${turns} turn${turns === 1 ? '' : 's'} summarised` : '';
  return `✻ Conversation compacted${n}${verbose ? '' : ' · ctrl+e for the summary'}`;
}

/** The port the extension dials; it has no setting for another (extension/src/background/policy.js). */
export const EXTENSION_PORT = 7777;

/**
 * The "extension not connected" row, naming the fix that applies.
 *
 * It said "Open a Gemini tab in Chrome" whatever the cause, and two of the
 * three causes are not that: an agent started with `--port` can never be
 * reached, because the extension only dials 7777; and one that was connected
 * and dropped needs Chrome back, not a first-time setup. Each fits 72
 * columns: the row truncates from the right, where the fix is.
 */
export function disconnectedHint({ port = EXTENSION_PORT, everConnected = false } = {}) {
  if (port !== EXTENSION_PORT) {
    return `! Extension dials ${EXTENSION_PORT}, this agent is on ${port} — restart without --port`;
  }
  if (everConnected) {
    return '! Extension disconnected — bring Chrome back; it reconnects by itself';
  }
  return '! Extension not connected — open gemini.google.com in Chrome';
}

/**
 * `{done, total}` for a task.md checklist, or null when it has none. Counted
 * from the file, which is the only copy either the user or the model sees.
 */
export function taskProgress(text) {
  if (!text) return null;
  const items = String(text).match(/^\s*[-*]\s*\[[ xX]\]/gm) || [];
  if (items.length === 0) return null;
  return { done: items.filter((l) => /\[[xX]\]/.test(l)).length, total: items.length };
}

/**
 * The row for a reply whose tool call could not be parsed. It was the broken
 * JSON drawn as prose, then `ERROR PARSING TOOL CALLS: …` as a paragraph —
 * ten rows saying "the model will try again".
 */
export function parseErrorRow(attempt, maxAttempts, verbose = false) {
  const n = Number.isFinite(attempt) && Number.isFinite(maxAttempts) ? ` (${attempt}/${maxAttempts})` : '';
  return `✗ Could not read its tool call — asked it to resend${n}${verbose ? '' : ' · ctrl+e for details'}`;
}

/**
 * A five-cell meter for the status bar: `▰▰▱▱▱`. Rounded to the nearest cell,
 * with any context at all showing one, so "almost empty" is not drawn as empty.
 */
export function contextMeter(pct, cells = 5) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const on = p === 0 ? 0 : Math.max(1, Math.round((p / 100) * cells));
  return '▰'.repeat(on) + '▱'.repeat(cells - on);
}

/**
 * The mode, said the way Claude Code says it, for the status line, with
 * Claude Code's glyphs: `⏸ plan mode on`, `⏵⏵ auto mode on`, `⏹ strict plan
 * mode on`. Replaced a label on the input border, which read as floating above
 * the box.
 *
 * v5.20 dropped the glyphs — `⏸` drew as a thick `▮▮` in the owner's font and
 * was reported as looking bad. They came back by choice on 2026-10-25 (Look A
 * with M2, `.agent/artifacts/plans/2026-10-25-startup-look.md`), risk known.
 * If they are rejected again, the plan's M3 set (`‖`, `⏵⏵`, `■`) has no emoji
 * forms; change `MODE_GLYPHS` only.
 */
export const MODE_GLYPHS = { plan: '⏸', auto: '⏵⏵', strict: '⏹' };

export function modeLine(mode) {
  if (mode === 'auto') return `${MODE_GLYPHS.auto} auto mode on`;
  if (mode === 'strict') return `${MODE_GLYPHS.strict} strict plan mode on`;
  return `${MODE_GLYPHS.plan} plan mode on`;
}

/** How many output lines a running command shows under its row. */
export const RUNNING_OUTPUT_LINES = 5;

/**
 * The block of calls still running, and what it costs the live frame.
 *
 * The calls share the turn's rows: the turn keeps two (its newest step and the
 * `so far` tally) and this block is the first thing to shrink. A running
 * `run_command` also shows the last lines of its output under its row, as
 * Claude Code's Bash rows do — and those lines come out of the same budget,
 * after the call rows, so a short terminal drops the output before it drops a
 * call and never draws a row it has not paid for. An unbounded live row is the
 * flicker bug (CLAUDE.md, "The live frame must never outgrow the viewport").
 *
 * @param {object[]} calls - running calls, oldest first; `output` is the tail
 * @param {number} liveBudget - rows the live frame may use for the turn and this
 * @returns {{calls: object[], outputFor: (number|null), output: string[], rows: number}}
 */
export function runningLayout(calls = [], liveBudget = 0, { compact = false, maxOutput = RUNNING_OUTPUT_LINES } = {}) {
  const margin = compact ? 0 : 1;
  const fits = Math.min(calls.length, Math.floor(liveBudget / 2), liveBudget - 2 - margin);
  const shown = fits > 0 ? calls.slice(-fits) : [];
  // The newest call with output: commands run one at a time, but a subagent
  // started beside one must not take its lines.
  const watched = [...shown].reverse().find((c) => Array.isArray(c.output) && c.output.length);
  const spare = liveBudget - 2 - margin - shown.length;
  const output = watched && spare > 0 ? watched.output.slice(-Math.min(maxOutput, spare)) : [];
  const rows = shown.length === 0 ? 0 : shown.length + output.length + margin;
  return { calls: shown, outputFor: output.length ? watched.id : null, output, rows };
}

/** `4s`, `1m 05s` — a running command's age, on its row. */
export function elapsedLabel(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * The last thing the agent said, as the markdown it wrote — what `/copy` puts
 * on the clipboard. The rendered transcript is ANSI and wrapped, so a drag-
 * select over a long reply copies escape-free text broken at the terminal's
 * width; this is the source instead. Skips a reply that failed to parse (it is
 * the model's broken JSON, not an answer) and empty prose.
 *
 * @param {object[]} history - the loop's `conversationHistory`
 * @returns {string|null}
 */
/**
 * The last code block the agent wrote, for `/copy code` (which replaced
 * `ctrl+y`, 2026-10-26: a command is something `/` lists, a chord is something
 * you have to remember).
 *
 * Searched backwards through the agent's replies, newest block first, because
 * a reply is commonly followed by tool rounds with no code in them. A fenced
 * tool call is skipped: the reply's raw text still holds it, and copying the
 * call the agent made instead of the code it showed would read as broken.
 *
 * @returns {{lang: string, code: string} | null}
 */
export function lastCodeBlock(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const t = history[i];
    if (t?.role !== 'agent' || t.parseError || typeof t.content !== 'string') continue;
    const blocks = extractCodeBlocks(t.content)
      .filter((b) => !(/^json$/i.test(b.lang) && /"name"\s*:/.test(b.code)));
    if (blocks.length) return blocks[blocks.length - 1];
  }
  return null;
}

export function lastReply(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const t = history[i];
    if (t?.role === 'agent' && !t.parseError && typeof t.content === 'string' && t.content.trim()) {
      return t.content.trim();
    }
  }
  return null;
}
