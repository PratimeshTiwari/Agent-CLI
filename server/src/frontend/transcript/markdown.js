/**
 * A reply rendered for the terminal: marked + marked-terminal, configured here, plus the code
 * blocks, maths and tables it cannot draw on its own, and the last reply for /copy.
 *
 * Split out of `format.js` (v8.4) along the groups it already had.
 */

import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { fitColumns, fitLines, visibleWidth, wrapAnsi } from '../text.js';

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
 * Strikethrough needs two tildes (v6.25). GFM also takes one, so a reply
 * saying "~291.5 MB (~298,548 KB)" drew everything between the two as struck
 * out. Gemini writes `~` as "about" far more often than it strikes anything,
 * and its own page renders `~~` only. Returning nothing leaves the tildes as
 * text; returning false would hand the source back to the one-tilde rule.
 */
const DOUBLE_TILDE_DEL = /^~~(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))~~(?=[^~]|$)/;
marked.use({
  tokenizer: {
    del(src) {
      const m = DOUBLE_TILDE_DEL.exec(src);
      if (m) return { type: 'del', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
    },
  },
});

/**
 * Inline maths as text (v7.1). The tab now scrapes a formula as its TeX,
 * `$\ge 80\%$`, where it used to read it three times over. A formula made only
 * of symbols a terminal can draw is drawn (`≥80%`); anything else — a fraction
 * of expressions, a matrix — stays as the TeX the model wrote, which is exact.
 */
const TEX_SYMBOLS = {
  ge: '≥', geq: '≥', le: '≤', leq: '≤', neq: '≠', ne: '≠', approx: '≈', sim: '~', times: '×',
  div: '÷', pm: '±', cdot: '·', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒',
  infty: '∞', degree: '°', circ: '°', ldots: '…', dots: '…', cdots: '⋯', in: '∈', sum: 'Σ',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', lambda: 'λ', mu: 'μ',
  pi: 'π', sigma: 'σ', theta: 'θ', omega: 'ω', sqrt: '√', log: 'log', ln: 'ln', max: 'max', min: 'min',
  '%': '%', $: '$', '{': '{', '}': '}', _: '_', ',': ' ', ' ': ' ', ';': ' ', '!': '',
};
const SUPERSCRIPTS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', n: 'ⁿ', '-': '⁻' };

/** `\ge 80\%` → `≥ 80%`, or null when any part has no plain-text form. */
export function texToText(tex) {
  let s = String(tex)
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    .replace(/\^\{?([0-9n-]+)\}?/g, (m, p) => ([...p].every((c) => SUPERSCRIPTS[c]) ? [...p].map((c) => SUPERSCRIPTS[c]).join('') : m));
  let failed = false;
  s = s.replace(/\\([A-Za-z]+|.)/g, (m, name) => {
    if (name in TEX_SYMBOLS) return TEX_SYMBOLS[name];
    failed = true;
    return m;
  });
  if (failed || /[\\^{}]/.test(s)) return null;
  return s.replace(/\s+/g, ' ').trim();
}

const INLINE_MATH = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?![0-9])/;
marked.use({
  extensions: [{
    name: 'inlineMath',
    level: 'inline',
    start(src) { return src.indexOf('$'); },
    tokenizer(src) {
      const m = INLINE_MATH.exec(src);
      if (m) return { type: 'inlineMath', raw: m[0], tex: m[1] };
    },
    renderer(token) { return texToText(token.tex) ?? token.raw; },
  }],
});

/**
 * The last step `marked-terminal` applies to a paragraph, for inline text we
 * render ourselves (list items, table cells).
 *
 * Its `codespan` swaps every `:` for `*#COLON|*` and only its paragraph and
 * heading renderers swap it back, so a URL in backticks inside a list item
 * came out with the placeholder where its colon should be (#103). Entities are decoded in the same
 * step, or `&` shows as `&amp;`. Its emoji step is left out on purpose: it
 * turns `:word:` into a picture, which in a reply about code is a bug.
 */
const COLON_PLACEHOLDER = /\*#COLON\|\*/g;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
export function finishInline(text) {
  return String(text ?? '')
    .replace(COLON_PLACEHOLDER, ':')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);
}

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
      const cell = (c) => finishInline(this.parser.parseInline(c.tokens)).replace(/\n+/g, ' ').trim();
      const header = (token.header || []).map(cell);
      const rows = (token.rows || []).map((r) => r.map(cell));
      if (header.length === 0) return '';

      const natural = header.map((h, i) => Math.max(
        visibleWidth(h),
        ...rows.map((r) => visibleWidth(r[i] ?? '')),
      ));
      const widths = fitColumns(natural, renderWidth);

      const rule = (l, mid, r, ch = '─') => DIM + l + widths.map((w) => ch.repeat(w + 2)).join(mid) + r + RESET;
      const bar = `${DIM}│${RESET}`;
      const cellLines = (cells) => cells.map((c, i) => wrapAnsi(c ?? '', widths[i]));
      const line = (cells) => {
        const wrapped = cellLines(cells);
        const height = Math.max(1, ...wrapped.map((w) => w.length));
        const out = [];
        for (let i = 0; i < height; i += 1) {
          const parts = wrapped.map((w, c) => {
            const text = w[i] ?? '';
            return ` ${text}${' '.repeat(Math.max(0, widths[c] - visibleWidth(text)))} `;
          });
          out.push(`${bar}${parts.join(bar)}${bar}`);
        }
        return out.join('\n');
      };
      /*
       * Rows are told apart only when one of them wraps (v8.0, option C of
       * .agent/artifacts/plans/2026-10-31-table-rows.md, owner's pick): with
       * wrapped cells nothing showed where one row ended and the next began;
       * a table of one-line rows reads fine as it is and stays so. A dotted
       * rule between rows, and a double one under the header so it still
       * stands apart from them.
       */
      const wraps = rows.some((r) => cellLines(r).some((w) => w.length > 1));
      const body = rows.flatMap((r, i) => (wraps && i > 0 ? [rule('├', '┼', '┤', '┄'), line(r)] : [line(r)]));

      return [
        '',
        rule('┌', '┬', '┐'),
        line(header.map((h) => `${BOLD}${h}${RESET}`)),
        wraps ? rule('╞', '╪', '╡', '═') : rule('├', '┼', '┤'),
        ...body,
        rule('└', '┴', '┘'),
        '',
        '',
      ].join('\n');
    },

    // A list item's text, already rendered (see `list`). Anything else is real
    // HTML in a reply and goes to marked-terminal as before.
    html(token) {
      return token?.listText ? token.text : false;
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
        // children as inline markdown, the way a paragraph is — and finish
        // them the way a paragraph is. It went out as an `html` token, which
        // marked-terminal draws in grey with the colon placeholder left in:
        // every list item read dim, and a URL in backticks lost its colon (#103).
        // `listText` tells the `html` renderer below to pass it through as is.
        const tokens = item.tokens.map((t) => {
          if (!(t.type === 'text' && t.tokens)) return t;
          const text = finishInline(this.parser.parseInline(t.tokens));
          return { type: 'html', raw: text, text, block: true, pre: false, listText: true };
        });
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

    // Before the code blocks go back: those are copied, never re-wrapped.
    out = fitLines(out, renderWidth);
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
export function lastReply(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const t = history[i];
    if (t?.role === 'agent' && !t.parseError && typeof t.content === 'string' && t.content.trim()) {
      return t.content.trim();
    }
  }
  return null;
}
