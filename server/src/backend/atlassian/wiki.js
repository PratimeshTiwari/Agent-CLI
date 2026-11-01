/**
 * Jira Server / Data Center's text format, wiki markup, to and from the
 * Markdown the model uses (v8.1).
 *
 * The write side is exact for what `markdown.js` parses. The read side is a
 * line-by-line reading of the common markup; macros it does not know (`{panel}`,
 * `{color}`, `[~user]` mentions, `!image.png!`) are rendered as text and named
 * in `lost`, for the same reason `adf.js` names them.
 */
import { parseMarkdown } from './markdown.js';

/** Languages Jira's `{code}` macro formats; another name would render a warning box. */
const CODE_LANGS = new Map(Object.entries({
  actionscript: 'actionscript', ada: 'ada', applescript: 'applescript', bash: 'bash', sh: 'bash', shell: 'bash',
  zsh: 'bash', c: 'c', cs: 'c#', csharp: 'c#', 'c#': 'c#', cpp: 'c++', 'c++': 'c++', css: 'css', erlang: 'erlang',
  go: 'go', golang: 'go', groovy: 'groovy', haskell: 'haskell', html: 'html', java: 'java', js: 'javascript',
  javascript: 'javascript', jsx: 'javascript', json: 'json', lua: 'lua', objc: 'objc', perl: 'perl', php: 'php',
  python: 'python', py: 'python', r: 'r', ruby: 'ruby', rb: 'ruby', scala: 'scala', sql: 'sql', swift: 'swift',
  vb: 'visualbasic', xml: 'xml', yaml: 'yaml', yml: 'yaml',
}));

export function markdownToWiki(md) {
  return parseMarkdown(md).map((b) => blockToWiki(b, '')).filter(Boolean).join('\n\n');
}

function blockToWiki(b, listPrefix) {
  switch (b.type) {
    case 'heading': return `h${b.level}. ${runsToWiki(b.runs)}`;
    case 'paragraph': return runsToWiki(b.runs);
    case 'code': {
      const lang = CODE_LANGS.get(String(b.lang || '').toLowerCase());
      return `{code${lang ? `:${lang}` : ''}}\n${b.text}\n{code}`;
    }
    case 'quote': return `{quote}\n${b.blocks.map((x) => blockToWiki(x, '')).join('\n\n')}\n{quote}`;
    case 'rule': return '----';
    case 'list': {
      const prefix = listPrefix + (b.ordered ? '#' : '*');
      return b.items.map((blocks) => blocks.map((x, i) => {
        if (x.type === 'list') return blockToWiki(x, prefix);
        const text = x.type === 'paragraph' ? runsToWiki(x.runs).replace(/\n/g, ' ') : blockToWiki(x, '');
        return i === 0 ? `${prefix} ${text}` : text;
      }).join('\n')).join('\n');
    }
    case 'table': {
      const cellText = (runs) => runsToWiki(runs, { table: true }).replace(/\n/g, ' ') || ' ';
      return [
        `||${b.header.map(cellText).join('||')}||`,
        ...b.rows.map((r) => `|${r.map(cellText).join('|')}|`),
      ].join('\n');
    }
    default: return '';
  }
}

/**
 * Escaped where wiki markup would read it as formatting. Braces and brackets
 * always; `*_+^~-?!` only at one edge of a word — `-word` can open a
 * strikethrough, while `a - b` and `a-b` format nothing.
 */
function escapeWiki(text, { table = false } = {}) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('{}[]'.includes(c) || (table && c === '|')) { out += `\\${c}`; continue; }
    if ('*_+^~-?!'.includes(c)) {
      const before = i === 0 || /[\s(]/.test(text[i - 1]);
      const after = i === text.length - 1 || /[\s).,;:!?]/.test(text[i + 1]);
      if (before !== after) { out += `\\${c}`; continue; }
    }
    out += c;
  }
  return out;
}

function runsToWiki(runs, opts = {}) {
  return (runs || []).map((r) => {
    if (r.text === '\n') return '\\\\\n';
    let t;
    if (r.marks.code) t = `{{${r.text.replace(/}}/g, '} }')}}}`;
    else {
      t = escapeWiki(r.text, opts);
      if (r.marks.strike) t = `-${t}-`;
      if (r.marks.em) t = `_${t}_`;
      if (r.marks.strong) t = `*${t}*`;
    }
    if (r.marks.link) t = r.text === r.marks.link && !r.marks.code ? `[${r.marks.link}]` : `[${t}|${r.marks.link}]`;
    return t;
  }).join('');
}

/**
 * @param {string} wiki
 * @returns {{markdown: string, lost: string[]}}
 */
export function wikiToMarkdown(wiki) {
  const lost = new Set();
  const lines = String(wiki ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = line.match(/^\s*\{(code|noformat)(?::([^}|]*))?[^}]*\}\s*(.*)$/);
    if (code) {
      const lang = (code[2] || '').split('|')[0].replace(/^language=/, '').trim();
      const body = code[3] ? [code[3]] : [];
      const close = new RegExp(`\\{${code[1]}\\}`);
      i++;
      while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) {
        const before = lines[i].replace(close, '').replace(/\s+$/, '');
        if (before) body.push(before);
      }
      out.push(`\`\`\`${lang}`, ...body, '```');
      continue;
    }
    if (/^\s*\{quote\}\s*$/.test(line)) {
      i++;
      while (i < lines.length && !/^\s*\{quote\}\s*$/.test(lines[i])) out.push(`> ${inlineWiki(lines[i++], lost)}`.trimEnd());
      continue;
    }
    const macro = line.match(/^\s*\{(panel|info|note|warning|tip|expand|color)[^}]*\}\s*$/i);
    if (macro) { lost.add(macro[1].toLowerCase()); continue; }
    if (/^\s*\{(panel|info|note|warning|tip|expand|color)\}\s*$/i.test(line)) continue;

    const h = line.match(/^\s*h([1-6])\.\s+(.*)$/);
    if (h) { out.push(`${'#'.repeat(Number(h[1]))} ${inlineWiki(h[2], lost)}`); continue; }
    const bq = line.match(/^\s*bq\.\s+(.*)$/);
    if (bq) { out.push(`> ${inlineWiki(bq[1], lost)}`); continue; }
    if (/^\s*-{4,}\s*$/.test(line)) { out.push('---'); continue; }
    const li = line.match(/^\s*([*#-]+)\s+(.*)$/);
    if (li && (/^[*#]+$/.test(li[1]) || li[1] === '-')) {
      const marks = li[1];
      const depth = marks.length - 1;
      const marker = marks.endsWith('#') ? '1.' : '-';
      out.push(`${'  '.repeat(depth)}${marker} ${inlineWiki(li[2], lost)}`);
      continue;
    }
    if (/^\s*\|\|/.test(line)) {
      const cells = splitCells(line.trim().replace(/^\|\|/, '').replace(/\|\|$/, ''), '||').map((c) => cellWiki(c, lost));
      out.push(`| ${cells.join(' | ')} |`, `|${' --- |'.repeat(cells.length)}`);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const cells = splitCells(line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, ''), '|').map((c) => cellWiki(c, lost));
      out.push(`| ${cells.join(' | ')} |`);
      continue;
    }
    out.push(inlineWiki(line, lost));
  }
  return { markdown: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), lost: [...lost].sort() };
}

/** A row split on its separator, but not on `\\|` or a `|` inside `[text|url]`. */
function splitCells(row, sep) {
  const cells = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (row[i] === '[') depth++;
    if (row[i] === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && row.startsWith(sep, i)) { cells.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += row[i];
  }
  cells.push(cur);
  return cells;
}

/** A table cell: its escaped pipes stay escaped, as Markdown needs them. */
const cellWiki = (c, lost) => inlineWiki(c.trim(), lost).replace(/\|/g, '\\|');

function inlineWiki(text, lost) {
  let t = String(text);
  t = t.replace(/\{\{([^}]*)\}\}/g, '`$1`');
  t = t.replace(/\[~([^\]]+)\]/g, (_, u) => { lost.add('mention'); return `@${u}`; });
  t = t.replace(/!([^!\s][^!]*\.(?:png|jpe?g|gif|svg|webp|bmp))(\|[^!]*)?!/gi, (_, f) => { lost.add('image'); return `[image: ${f}]`; });
  t = t.replace(/\{color(?::[^}]*)?\}/g, () => { lost.add('color'); return ''; });
  t = t.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '[$1]($2)');
  t = t.replace(/\[(https?:\/\/[^\]\s]+)\]/g, '<$1>');
  t = t.replace(/(^|[\s(])\*(\S(?:[^*]*\S)?)\*(?=$|[\s).,;:!?])/g, '$1**$2**');
  t = t.replace(/(^|[\s(])_(\S(?:[^_]*\S)?)_(?=$|[\s).,;:!?])/g, '$1*$2*');
  t = t.replace(/(^|[\s(])-(\S(?:[^-]*\S)?)-(?=$|[\s).,;:!?])/g, '$1~~$2~~');
  t = t.replace(/\\\\$/, '');
  t = t.replace(/\\([{}[\]*_+^~\-?!|])/g, '$1');
  return t;
}
