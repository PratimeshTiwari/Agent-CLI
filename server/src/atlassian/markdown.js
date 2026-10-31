/**
 * The Markdown the model writes, as blocks and runs of text (v8.1).
 *
 * The model reads and writes Markdown, never Jira's own formats: Cloud stores
 * text as ADF (JSON, `adf.js`) and Server/Data Center as wiki markup
 * (`wiki.js`). Both are produced from this one parse, so a construct is
 * either supported in both or in neither.
 *
 * Supported: headings, paragraphs, bold, italic, strikethrough, inline code,
 * links (and bare URLs), nested bullet and numbered lists, fenced code with its
 * language, quotes, rules and pipe tables. That is what Gemini writes. Anything
 * else is kept as the text it is.
 *
 * Runs are `{text, marks}` with `marks` a subset of
 * `{strong, em, strike, code, link}`; a hard break is `{text: '\n', marks: {}}`.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w#+.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isTableRow = (line) => /\|/.test(line) && line.trim() !== '|';

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** Does this line open a block of its own (so it ends a paragraph)? */
function startsBlock(line, next) {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || LIST_ITEM.test(line)
    || QUOTE.test(line) || (isTableRow(line) && TABLE_SEP.test(next || ''));
}

/** @returns {Array<object>} blocks */
export function parseMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines);
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(marker[0].repeat(marker.length)) && lines[i].trim().replace(/[`~]/g, '') === '')) {
        body.push(lines[i]);
        i++;
      }
      i++; // the closing fence, or the end
      blocks.push({ type: 'code', lang: fence[2] || '', text: body.join('\n') });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, runs: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && lines[i].trim() && QUOTE.test(lines[i])) {
        inner.push(lines[i].match(QUOTE)[1]);
        i++;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(inner) });
      continue;
    }

    if (isTableRow(line) && TABLE_SEP.test(lines[i + 1] || '')) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const width = header.length;
      blocks.push({
        type: 'table',
        header: header.map(parseInline),
        rows: rows.map((r) => Array.from({ length: width }, (_, c) => parseInline(r[c] ?? ''))),
      });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines[i], lines[i + 1]))) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', runs: paragraphRuns(para) });
  }
  return blocks;
}

/** Lines of one paragraph: joined by a space, or a hard break after two spaces or a backslash. */
function paragraphRuns(lines) {
  const runs = [];
  lines.forEach((raw, n) => {
    const hard = / {2,}$/.test(raw) || /\\$/.test(raw);
    const text = raw.trim().replace(/\\$/, '');
    runs.push(...parseInline(text));
    if (n < lines.length - 1) runs.push(hard ? { text: '\n', marks: {} } : { text: ' ', marks: {} });
  });
  return mergeRuns(runs);
}

/**
 * A list and everything nested in it. An item's own lines are those indented
 * past its marker; a deeper marker opens a nested list.
 */
function parseList(lines, start) {
  const first = lines[start].match(LIST_ITEM);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(LIST_ITEM);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const content = [m[3]];
    const contentIndent = m[1].length + m[2].length + 1;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        // A blank line continues the item only if the next line is indented into it.
        const nxt = lines[i + 1];
        if (nxt !== undefined && nxt.trim() && leading(nxt) > indent) { content.push(''); i++; continue; }
        break;
      }
      const lm = l.match(LIST_ITEM);
      if (lm && lm[1].length <= indent) break;
      if (!lm && leading(l) <= indent && startsBlock(l, lines[i + 1])) break;
      content.push(leading(l) >= contentIndent ? l.slice(contentIndent) : l.trimStart());
      i++;
    }
    items.push(parseBlocks(dedentNested(content)));
  }
  return { block: { type: 'list', ordered, start: ordered ? Number.parseInt(first[2], 10) || 1 : 1, items }, next: i };
}

const leading = (l) => l.length - l.trimStart().length;

/** An item's continuation lines, with nested markers kept relative to each other. */
function dedentNested(content) {
  const nested = content.slice(1).filter((l) => l.trim());
  const min = nested.length ? Math.min(...nested.map(leading)) : 0;
  return [content[0], ...content.slice(1).map((l) => (l.trim() ? l.slice(Math.min(min, leading(l))) : l))];
}

const URL_AT = /^https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_~]/;

/** Inline Markdown as runs. */
export function parseInline(src, marks = {}) {
  const s = String(src ?? '');
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ text: buf, marks: { ...marks } });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const rest = s.slice(i);

    if (c === '\\' && /[\\`*_{}[\]()#+\-.!~|>]/.test(s[i + 1] || '')) { buf += s[i + 1]; i += 2; continue; }

    if (c === '`') {
      const ticks = rest.match(/^`+/)[0];
      const end = s.indexOf(ticks, i + ticks.length);
      if (end > -1) {
        flush();
        let code = s.slice(i + ticks.length, end);
        if (/^ .* $/.test(code)) code = code.slice(1, -1);
        out.push({ text: code, marks: { ...marks, code: true } });
        i = end + ticks.length;
        continue;
      }
    }

    if (rest.startsWith('**') || rest.startsWith('__')) {
      const d = rest.slice(0, 2);
      const end = s.indexOf(d, i + 2);
      if (end > i + 2 && !/\s/.test(s[i + 2])) {
        flush();
        out.push(...parseInline(s.slice(i + 2, end), { ...marks, strong: true }));
        i = end + 2;
        continue;
      }
    }

    if (rest.startsWith('~~')) {
      const end = s.indexOf('~~', i + 2);
      if (end > i + 2) {
        flush();
        out.push(...parseInline(s.slice(i + 2, end), { ...marks, strike: true }));
        i = end + 2;
        continue;
      }
    }

    if ((c === '*' || c === '_') && s[i + 1] !== c && s[i + 1] && !/\s/.test(s[i + 1])
      && (c === '*' || i === 0 || !/\w/.test(s[i - 1]))) {
      let end = i + 1;
      while ((end = s.indexOf(c, end)) > -1) {
        const closes = s[end - 1] && !/\s/.test(s[end - 1]) && s[end + 1] !== c
          && (c === '*' || !/\w/.test(s[end + 1] || ''));
        if (closes) break;
        end++;
      }
      if (end > i + 1) {
        flush();
        out.push(...parseInline(s.slice(i + 1, end), { ...marks, em: true }));
        i = end + 1;
        continue;
      }
    }

    if (c === '!' && s[i + 1] === '[') {
      const img = rest.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
      if (img) {
        flush();
        out.push({ text: img[1] || img[2], marks: { ...marks, link: img[2] } });
        i += img[0].length;
        continue;
      }
    }

    if (c === '[') {
      const link = rest.match(/^\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
      if (link) {
        flush();
        const inner = parseInline(link[1], { ...marks, link: link[2] });
        out.push(...(inner.length ? inner : [{ text: link[2], marks: { ...marks, link: link[2] } }]));
        i += link[0].length;
        continue;
      }
    }

    if (c === '<') {
      const auto = rest.match(/^<(https?:\/\/[^>\s]+)>/);
      if (auto) {
        flush();
        out.push({ text: auto[1], marks: { ...marks, link: auto[1] } });
        i += auto[0].length;
        continue;
      }
    }

    if ((c === 'h') && !marks.link && (i === 0 || /[\s(]/.test(s[i - 1]))) {
      const url = rest.match(URL_AT);
      if (url) {
        flush();
        out.push({ text: url[0], marks: { ...marks, link: url[0] } });
        i += url[0].length;
        continue;
      }
    }

    buf += c;
    i++;
  }
  flush();
  return mergeRuns(out);
}

const sameMarks = (a, b) => {
  const ka = Object.keys(a).filter((k) => a[k]);
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && last.text !== '\n' && r.text !== '\n' && sameMarks(last.marks, r.marks)) last.text += r.text;
    else out.push({ text: r.text, marks: { ...r.marks } });
  }
  return out;
}

/** Plain text of some runs (for previews and length counts). */
export function runsText(runs) {
  return (runs || []).map((r) => r.text).join('');
}
