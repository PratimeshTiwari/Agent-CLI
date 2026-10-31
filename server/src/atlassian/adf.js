/**
 * Jira Cloud's text format, ADF (Atlassian Document Format), to and from the
 * Markdown the model uses (v8.1).
 *
 * Writing goes through `parseMarkdown`, so only what `markdown.js` supports can
 * be written. Reading renders more than that (a mention, a status, a panel)
 * and says what it rendered that a write could not put back: `lost` names
 * those node and mark types. The approval for an update shows it, because
 * replacing a description that had a panel with Markdown removes the panel.
 */
import { parseMarkdown } from './markdown.js';

/** @returns {object} an ADF doc */
export function markdownToAdf(md) {
  const content = parseMarkdown(md).map(blockToAdf).filter(Boolean);
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

function blockToAdf(b) {
  switch (b.type) {
    case 'heading':
      return { type: 'heading', attrs: { level: b.level }, content: runsToAdf(b.runs) };
    case 'paragraph':
      return { type: 'paragraph', content: runsToAdf(b.runs) };
    case 'code': {
      const node = { type: 'codeBlock', attrs: b.lang ? { language: b.lang } : {}, content: [] };
      if (b.text) node.content.push({ type: 'text', text: b.text });
      return node;
    }
    case 'quote':
      return { type: 'blockquote', content: b.blocks.map(blockToAdf).filter((n) => n && n.type !== 'rule' && n.type !== 'table') };
    case 'rule':
      return { type: 'rule' };
    case 'list':
      return {
        type: b.ordered ? 'orderedList' : 'bulletList',
        ...(b.ordered ? { attrs: { order: b.start || 1 } } : {}),
        content: b.items.map((blocks) => {
          const inner = blocks.map(blockToAdf).filter((n) => n && ['paragraph', 'bulletList', 'orderedList', 'codeBlock'].includes(n.type));
          // A listItem must open with a paragraph (ADF's schema); an item that
          // is only a nested list gets an empty one.
          if (!inner.length || inner[0].type !== 'paragraph') inner.unshift({ type: 'paragraph', content: [] });
          return { type: 'listItem', content: inner };
        }),
      };
    case 'table':
      return {
        type: 'table',
        content: [
          { type: 'tableRow', content: b.header.map((runs) => cell('tableHeader', runs)) },
          ...b.rows.map((row) => ({ type: 'tableRow', content: row.map((runs) => cell('tableCell', runs)) })),
        ],
      };
    default:
      return null;
  }
}

const cell = (type, runs) => ({ type, content: [{ type: 'paragraph', content: runsToAdf(runs) }] });

function runsToAdf(runs) {
  const out = [];
  for (const r of runs || []) {
    if (r.text === '\n') { out.push({ type: 'hardBreak' }); continue; }
    if (!r.text) continue;
    const marks = [];
    // `code` combines only with `link` in ADF's schema; bold code is code.
    if (r.marks.code) marks.push({ type: 'code' });
    else {
      if (r.marks.strong) marks.push({ type: 'strong' });
      if (r.marks.em) marks.push({ type: 'em' });
      if (r.marks.strike) marks.push({ type: 'strike' });
    }
    if (r.marks.link) marks.push({ type: 'link', attrs: { href: r.marks.link } });
    out.push(marks.length ? { type: 'text', text: r.text, marks } : { type: 'text', text: r.text });
  }
  return out;
}

/** What a write can reproduce; anything else read back is reported as lost. */
const WRITABLE_NODES = new Set([
  'doc', 'paragraph', 'heading', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem',
  'codeBlock', 'blockquote', 'rule', 'table', 'tableRow', 'tableHeader', 'tableCell',
]);
const WRITABLE_MARKS = new Set(['strong', 'em', 'strike', 'code', 'link']);

/**
 * @param {object} doc - ADF, or null
 * @returns {{markdown: string, lost: string[]}}
 */
export function adfToMarkdown(doc) {
  const lost = new Set();
  if (!doc || typeof doc !== 'object') return { markdown: typeof doc === 'string' ? doc : '', lost: [] };
  const md = blocks(doc.content || [], lost).trim();
  return { markdown: md, lost: [...lost].sort() };
}

function blocks(nodes, lost, indent = '') {
  return nodes.map((n) => block(n, lost, indent)).filter((s) => s !== '').join('\n\n');
}

function block(n, lost, indent) {
  if (!WRITABLE_NODES.has(n.type)) lost.add(n.type);
  switch (n.type) {
    case 'paragraph':
      return indent + inline(n.content, lost).replace(/\n/g, `\n${indent}`);
    case 'heading':
      return `${indent}${'#'.repeat(n.attrs?.level || 1)} ${inline(n.content, lost)}`;
    case 'codeBlock':
      return `${indent}\`\`\`${n.attrs?.language || ''}\n${(n.content || []).map((t) => t.text || '').join('')}\n${indent}\`\`\``;
    case 'blockquote':
      return blocks(n.content || [], lost).split('\n').map((l) => `${indent}> ${l}`.trimEnd()).join('\n');
    case 'rule':
      return `${indent}---`;
    case 'bulletList':
    case 'orderedList': {
      let k = n.attrs?.order || 1;
      return (n.content || []).map((item) => {
        const marker = n.type === 'orderedList' ? `${k++}. ` : '- ';
        return listItem(item, marker, lost, indent);
      }).join('\n');
    }
    case 'taskList':
      return (n.content || []).map((item) => listItem(item, item.attrs?.state === 'DONE' ? '- [x] ' : '- [ ] ', lost, indent)).join('\n');
    case 'table':
      return table(n, lost, indent);
    case 'panel':
      return blocks(n.content || [], lost).split('\n')
        .map((l, i) => `${indent}> ${i === 0 ? `**${n.attrs?.panelType || 'note'}:** ` : ''}${l}`.trimEnd()).join('\n');
    case 'expand':
    case 'nestedExpand':
      return `${indent}**${n.attrs?.title || 'Details'}**\n\n${blocks(n.content || [], lost, indent)}`;
    case 'mediaSingle':
    case 'mediaGroup':
      return (n.content || []).map((m) => `${indent}[attachment: ${m.attrs?.alt || m.attrs?.id || 'file'}]`).join('\n');
    case 'blockCard':
    case 'embedCard':
      return `${indent}${n.attrs?.url || ''}`;
    default:
      if (Array.isArray(n.content)) return blocks(n.content, lost, indent);
      return n.text ? indent + n.text : '';
  }
}

function listItem(item, marker, lost, indent) {
  if (!WRITABLE_NODES.has(item.type)) lost.add(item.type);
  const pad = `${indent}${' '.repeat(marker.length)}`;
  const parts = item.content || [];
  // A taskItem holds inline content directly; a listItem holds blocks.
  if (item.type === 'taskItem') return `${indent}${marker}${inline(parts, lost)}`;
  const [first, ...rest] = parts;
  const head = first?.type === 'paragraph' ? inline(first.content, lost) : first ? block(first, lost, '').trim() : '';
  const tail = (first?.type === 'paragraph' ? rest : parts.slice(1))
    .map((n) => block(n, lost, pad)).filter(Boolean).join('\n');
  return `${indent}${marker}${head}${tail ? `\n${tail}` : ''}`;
}

function table(n, lost, indent) {
  const rows = (n.content || []).map((row) => (row.content || []).map((c) =>
    blocks(c.content || [], lost).replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  const line = (r) => `${indent}| ${pad(r).join(' | ')} |`;
  return [line(rows[0]), `${indent}|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}

function inline(nodes, lost) {
  return (nodes || []).map((n) => {
    if (!WRITABLE_NODES.has(n.type)) lost.add(n.type);
    switch (n.type) {
      case 'text': return applyMarks(n.text || '', n.marks, lost);
      case 'hardBreak': return '\n';
      case 'mention': return `@${String(n.attrs?.text || n.attrs?.id || 'someone').replace(/^@/, '')}`;
      case 'emoji': return n.attrs?.text || n.attrs?.shortName || '';
      case 'inlineCard': return n.attrs?.url || '';
      case 'status': return `[${n.attrs?.text || ''}]`;
      case 'date': {
        const t = Number(n.attrs?.timestamp);
        return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
      }
      case 'placeholder': return n.attrs?.text || '';
      default: return Array.isArray(n.content) ? inline(n.content, lost) : (n.text || '');
    }
  }).join('');
}

function applyMarks(text, marks, lost) {
  let t = text;
  let link = null;
  const kinds = new Set();
  for (const m of marks || []) {
    if (!WRITABLE_MARKS.has(m.type)) lost.add(`${m.type} (formatting)`);
    if (m.type === 'link') link = m.attrs?.href;
    else kinds.add(m.type);
  }
  if (kinds.has('code')) t = `\`${t}\``;
  else {
    if (kinds.has('strike')) t = `~~${t}~~`;
    if (kinds.has('em')) t = `*${t}*`;
    if (kinds.has('strong')) t = `**${t}**`;
  }
  if (!link) return t;
  // A bare URL reads back bare, as it was written.
  return t === link ? link : `[${t}](${link})`;
}
