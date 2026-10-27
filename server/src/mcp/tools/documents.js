/**
 * Text out of documents, for `read_file` (v5.29).
 *
 * Owner, 2026-10-27: *"add pdf and .md and .doc file reading capability to the
 * agent"*. `.md` already read fine — it is text. A PDF or a Word file did not
 * fail, which was worse: `read_file` decoded it as UTF-8 and handed the model
 * thousands of characters of binary noise, typed into the browser tab.
 *
 * Extraction produces **Markdown, not JSON** (the owner suggested JSON). JSON
 * escapes every line break and quote in the text it carries, which v5.10
 * measured costing line structure and characters on reads; a document's
 * structure is headings, lists and tables, which is what Markdown is for and
 * what the model reads and writes best. Each PDF page starts with a
 * `--- page N ---` line, so a page can be found and asked for as a range.
 *
 * `read_file` then numbers and pages the result exactly as it does source, so
 * there is no second tool for the model to remember.
 */

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { inflateRawSync } from 'zlib';
import { extname } from 'path';

/** What `read_file` will open as a document, and how. */
export const DOCUMENT_TYPES = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.pptx': 'pptx',
  // Old binary Word, RTF and OpenDocument: macOS's `textutil` reads all three.
  '.doc': 'textutil',
  '.rtf': 'textutil',
  '.odt': 'textutil',
};

export function documentKind(path) {
  return DOCUMENT_TYPES[extname(String(path)).toLowerCase()] || null;
}

/**
 * Binary or text, from the first 8 KB: a NUL byte is the test git uses, and it
 * is what tells a PDF, an image or a database from source code.
 */
export function looksBinary(buffer) {
  const head = buffer.subarray(0, 8192);
  return head.includes(0);
}

// ── Zip ─────────────────────────────────────────────────────────────────────
// `.docx` and `.pptx` are zip files of XML. Reading one entry needs the central
// directory and an inflate, both in Node already, so no dependency for it.

/** @returns {Map<string, Buffer>} entry name → contents, for the names asked for */
export function readZipEntries(buffer, wanted = () => true) {
  // End of central directory: the last record, within 64 KB of the end.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no central directory)');
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('zip central directory is damaged');
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLen = buffer.readUInt16LE(at + 28);
    const extraLen = buffer.readUInt16LE(at + 30);
    const commentLen = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    // The local header repeats the name and has its own extra field length.
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(dataAt, dataAt + compressed);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`zip entry ${name} uses compression method ${method}, which is not supported`);
  }
  return out;
}

// ── Word ────────────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

/** One `<w:p>`'s text: runs, tabs and breaks, in order. */
function paragraphText(xml) {
  let text = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) text += decodeXml(m[1]);
    else text += m[0].startsWith('<w:tab') ? '\t' : '\n';
  }
  return text;
}

function paragraphMarkdown(xml) {
  const text = paragraphText(xml).trim();
  if (!text) return '';
  const style = /<w:pStyle w:val="([^"]+)"/.exec(xml)?.[1] || '';
  const heading = /^(?:Heading|heading)\s?(\d)$/.exec(style) || (style === 'Title' ? [null, '1'] : null);
  if (heading) return `${'#'.repeat(Math.min(6, Number(heading[1])))} ${text}`;
  if (/<w:numPr>/.test(xml) || /^List/.test(style)) {
    const level = Number(/<w:ilvl w:val="(\d+)"/.exec(xml)?.[1] || 0);
    return `${'  '.repeat(level)}- ${text}`;
  }
  return text;
}

/** The blocks directly under a parent: paragraphs and tables, in order. */
function* bodyBlocks(xml) {
  const re = /<w:tbl>|<w:tbl\s|<w:p>|<w:p\s|<w:p\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const start = m.index;
    if (m[0].startsWith('<w:tbl')) {
      // Tables nest; find the matching close by counting.
      let depth = 0;
      const tag = /<w:tbl[\s>]|<\/w:tbl>/g;
      tag.lastIndex = start;
      let t;
      while ((t = tag.exec(xml))) {
        depth += t[0] === '</w:tbl>' ? -1 : 1;
        if (depth === 0) break;
      }
      const end = t ? t.index + 8 : xml.length;
      yield { kind: 'table', xml: xml.slice(start, end) };
      re.lastIndex = end;
    } else if (m[0] === '<w:p/>') {
      yield { kind: 'p', xml: '' };
    } else {
      const end = xml.indexOf('</w:p>', start);
      const stop = end < 0 ? xml.length : end + 6;
      yield { kind: 'p', xml: xml.slice(start, stop) };
      re.lastIndex = stop;
    }
  }
}

function tableMarkdown(xml) {
  const rows = [...xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(([row]) =>
    [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(([cell]) =>
      [...bodyBlocks(cell)].map((b) => paragraphText(b.xml).trim()).filter(Boolean).join(' ')
        .replace(/\|/g, '\\|').replace(/\n/g, ' ')));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

export function docxToMarkdown(buffer) {
  const xml = readZipEntries(buffer, (n) => n === 'word/document.xml').get('word/document.xml');
  if (!xml) throw new Error('not a Word document (no word/document.xml)');
  const body = xml.toString('utf8');
  let out = '';
  let lastWasItem = false;
  for (const block of bodyBlocks(body)) {
    const md = block.kind === 'table' ? tableMarkdown(block.xml) : paragraphMarkdown(block.xml);
    if (!md) continue;
    // A list is consecutive lines; everything else is a paragraph apart.
    const isItem = /^\s*- /.test(md);
    out += out ? (isItem && lastWasItem ? '\n' : '\n\n') : '';
    out += md;
    lastWasItem = isItem;
  }
  return out;
}

export function pptxToMarkdown(buffer) {
  const number = (name) => Number(/(\d+)\.xml$/.exec(name)[1]);
  const slides = [...readZipEntries(buffer, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))]
    .sort(([a], [b]) => number(a) - number(b));
  if (!slides.length) throw new Error('not a PowerPoint file (no slides)');
  // Numbered by the file, which is the slide's own number, not by position.
  return slides.map(([name, xml]) => {
    const paras = [...xml.toString('utf8').matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map(([p]) =>
      [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1])).join('').trim()).filter(Boolean);
    return [`--- slide ${number(name)} ---`, ...paras].join('\n');
  }).join('\n\n');
}

// ── PDF ─────────────────────────────────────────────────────────────────────

export async function pdfToMarkdown(buffer) {
  // Loaded on first use: pdf.js is the largest thing in the process, and most
  // sessions never open a PDF.
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = text.map((t) => String(t || '').trim());
  return {
    pages: totalPages,
    // No text on any page: a scan, or a PDF of images. Said rather than
    // returned as an empty file, which reads as "this file is blank".
    scanned: pages.every((t) => !t),
    text: pages.map((t, i) => `--- page ${i + 1} ---\n${t}`).join('\n\n'),
  };
}

// ── textutil (macOS) ────────────────────────────────────────────────────────

export function textutilToText(absPath, platform = process.platform) {
  if (platform !== 'darwin') {
    throw new Error(`${extname(absPath)} files can only be read on macOS (textutil). `
      + 'Save it as .docx or .pdf and read that instead.');
  }
  // stderr ignored: a child's stderr is Ink's terminal (CLAUDE.md, v5.24).
  return execFileSync('textutil', ['-convert', 'txt', '-stdout', absPath], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
  // A page break comes out as a form feed, a control byte nobody wants typed
  // into the tab.
  }).replace(/\f/g, '\n');
}

// ── The entry point, cached ─────────────────────────────────────────────────

const cache = new Map();
const CACHE_SIZE = 8;

/**
 * A document as Markdown, plus what to say about it in the result's header.
 *
 * Cached by path, size and mtime: paging a 200-page PDF is many range reads,
 * and extracting it again for each would cost seconds every time.
 *
 * @returns {Promise<{text: string, label: string, pages?: number, scanned?: boolean}>}
 */
export async function extractDocument(absPath, stat, kind = documentKind(absPath)) {
  const key = `${absPath}\u0000${stat.size}\u0000${stat.mtimeMs}`;
  if (cache.has(key)) return cache.get(key);

  let result;
  if (kind === 'pdf') {
    const pdf = await pdfToMarkdown(readFileSync(absPath));
    result = { ...pdf, label: `markdown, from PDF (${pdf.pages} page${pdf.pages === 1 ? '' : 's'})` };
  } else if (kind === 'docx') {
    result = { text: docxToMarkdown(readFileSync(absPath)), label: 'markdown, from Word' };
  } else if (kind === 'pptx') {
    result = { text: pptxToMarkdown(readFileSync(absPath)), label: 'markdown, from PowerPoint' };
  } else if (kind === 'textutil') {
    result = { text: textutilToText(absPath), label: `text, from ${extname(absPath).slice(1).toUpperCase()}` };
  } else {
    throw new Error(`not a document type read_file knows: ${extname(absPath)}`);
  }

  cache.set(key, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return result;
}

/** For tests: forget everything extracted. */
export function clearDocumentCache() {
  cache.clear();
}
