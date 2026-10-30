/**
 * Log exports as a stream of flat records (v6.20), for `query_log`.
 *
 * Asked 2026-10-30: *"make this agent suitable for reading very large logs
 * file (json/csv) from grafana/datadog to debug issues"*. `read_file` pages
 * 800 lines and `grep_search` is line-based, and neither knows what a log is.
 * A Datadog JSON export is often one line, so a grep hit is the whole file;
 * its CSV export puts newlines inside quoted messages, so a hit is half a
 * record.
 *
 * Everything here streams: the file is read in chunks and never held whole,
 * so size costs time, not memory. Every format comes out as the same thing:
 * a flat object per record, nested keys joined with dots.
 *
 * Formats, decided from the first bytes and the extension:
 * - **ndjson**: one JSON object per line (most shippers, `docker logs`, pino);
 * - **json**: an array of records, or a wrapper holding one — Datadog's API
 *   (`{"data":[{"attributes":{…}}]}`), Loki (`data.result[].values`), Grafana
 *   data frames (`schema.fields` + columnar `data.values`). The first array of
 *   objects found is the records;
 * - **csv** / **tsv**: a header row, then RFC 4180 rows whose quoted fields
 *   may span lines;
 * - **text**: one record per line, a line that starts with whitespace (a
 *   stack trace) joined to the record above.
 * - any of them gzipped (`.gz`).
 */
import { createReadStream } from 'fs';
import { extname } from 'path';
import { createGunzip } from 'zlib';

const MAX_DEPTH = 6;
const MAX_KEYS = 200;
const MAX_VALUE = 2000;

/** Nested keys joined with dots; arrays of plain values joined, others kept as short JSON. */
export function flatten(value, prefix = '', out = {}, depth = 0) {
  if (value === null || typeof value !== 'object') {
    if (prefix) out[prefix] = typeof value === 'string' && value.length > MAX_VALUE ? value.slice(0, MAX_VALUE) : value;
    return out;
  }
  if (Array.isArray(value)) {
    const plain = value.every((v) => v === null || typeof v !== 'object');
    const text = plain ? value.join(', ') : JSON.stringify(value);
    if (prefix) out[prefix] = text.length > MAX_VALUE ? text.slice(0, MAX_VALUE) : text;
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    const key = prefix ? `${prefix}.${k}` : k;
    if (depth >= MAX_DEPTH && v && typeof v === 'object') out[key] = JSON.stringify(v).slice(0, MAX_VALUE);
    else flatten(v, key, out, depth + 1);
  }
  return out;
}

/**
 * One parsed JSON element as zero or more records. Shapes that hold many
 * records inside one element are opened up here; anything else is one record.
 */
export function expandElement(el) {
  if (!el || typeof el !== 'object' || Array.isArray(el)) return [{ message: typeof el === 'string' ? el : JSON.stringify(el) }];
  // Loki: a stream's labels, and [timestamp_ns, line] pairs.
  if (el.stream && typeof el.stream === 'object' && Array.isArray(el.values)) {
    return el.values.map((v) => {
      const rec = { timestamp: Array.isArray(v) ? v[0] : undefined, ...flatten(el.stream, 'labels') };
      const line = Array.isArray(v) ? v[1] : v;
      return Object.assign(rec, lineFields(line));
    });
  }
  // Grafana data frame: field names in the schema, values by column.
  const fields = el.schema?.fields;
  const columns = el.data?.values;
  if (Array.isArray(fields) && Array.isArray(columns)) {
    const rows = Math.max(0, ...columns.map((c) => (Array.isArray(c) ? c.length : 0)));
    const out = [];
    for (let r = 0; r < rows; r++) {
      const rec = {};
      fields.forEach((f, c) => {
        const v = columns[c]?.[r];
        if (v !== undefined) Object.assign(rec, flatten(v, f?.name || `field${c}`));
      });
      out.push(rec);
    }
    return out;
  }
  // Datadog API: { id, type: 'log', attributes: { timestamp, status, service, message, attributes } }.
  if (el.attributes && typeof el.attributes === 'object' && (el.type === 'log' || el.attributes.timestamp)) {
    return [{ ...(el.id ? { id: el.id } : {}), ...flatten(el.attributes) }];
  }
  return [flatten(el)];
}

/** A log line that is itself JSON is read as its fields; otherwise it is the message. */
function lineFields(line) {
  if (typeof line === 'string' && line.startsWith('{')) {
    try { return flatten(JSON.parse(line)); } catch { /* not JSON after all */ }
  }
  return { message: line };
}

/** What the file is, from its name and first bytes. */
export function detectFormat(head, name = '') {
  const ext = extname(String(name).replace(/\.gz$/i, '')).toLowerCase();
  const text = head.replace(/^﻿/, '').trimStart();
  if (ext === '.tsv') return 'tsv';
  if (ext === '.csv') return 'csv';
  if (text.startsWith('[')) return 'json';
  if (text.startsWith('{')) {
    // One object per line, or one object holding everything: if the first
    // line parses alone, and a second line starts another, it is ndjson.
    const nl = text.indexOf('\n');
    if (nl > 0) {
      try {
        JSON.parse(text.slice(0, nl));
        if (text.slice(nl + 1).trimStart().startsWith('{') || text.slice(nl + 1).trim() === '') return 'ndjson';
      } catch { /* not a whole object on its own line */ }
    }
    return 'json';
  }
  if (ext === '.jsonl' || ext === '.ndjson') return 'ndjson';
  if (ext === '.json') return 'json';
  // A header-looking first line with commas or tabs.
  const first = text.split('\n', 1)[0] || '';
  const tabs = (first.match(/\t/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  if (tabs >= 2 && !/^\d{4}-\d{2}-\d{2}/.test(first)) return 'tsv';
  if (commas >= 2 && /^"?[A-Za-z@_][\w .@-]*"?(?:,"?[A-Za-z@_][\w .@-]*"?)+\s*$/.test(first)) return 'csv';
  return 'text';
}

/** The raw text of a file, decompressed if it is gzipped, as string chunks. */
async function* chunks(absPath, signal) {
  const raw = createReadStream(absPath, { highWaterMark: 1 << 20 });
  const stream = /\.gz$/i.test(absPath) ? raw.pipe(createGunzip()) : raw;
  stream.setEncoding('utf8');
  try {
    for await (const chunk of stream) {
      if (signal?.stopped) break;
      yield chunk;
    }
  } finally {
    raw.destroy();
  }
}

/** The first `max` characters of the file's text, decompressed if gzipped. */
export async function readHead(absPath, max = 65536) {
  let text = '';
  const signal = { stopped: false };
  for await (const chunk of chunks(absPath, signal)) {
    text += chunk;
    if (text.length >= max) { signal.stopped = true; break; }
  }
  return text.slice(0, max);
}

/** Lines across chunks; the last partial line waits for the next chunk. */
async function* lines(source) {
  let rest = '';
  for await (const chunk of source) {
    const text = rest + chunk;
    let start = 0;
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', start)) {
      yield text.slice(start, i > start && text[i - 1] === '\r' ? i - 1 : i);
      start = i + 1;
    }
    rest = text.slice(start);
  }
  if (rest) yield rest;
}

/**
 * Top-level elements of the first array of objects, as parsed values, from
 * text arriving in chunks. A character scanner rather than `JSON.parse` of the
 * whole file, which would need the file in memory twice over.
 */
async function* jsonElements(source, stats) {
  let depth = 0;         // nesting at the scanner's position
  let inString = false;
  let escaped = false;
  let recordDepth = -1;  // depth of the chosen array's elements, -1 until one is chosen
  let pendingArray = -1; // an array just opened at this depth: is its first element an object?
  let buf = null;        // the element being collected
  for await (const chunk of source) {
    let from = 0; // where `buf` resumes in this chunk
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; pendingArray = -1; continue; }
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
      if (pendingArray !== -1) {
        // The first thing inside a fresh array decides whether it holds records.
        if (ch === '{' && recordDepth === -1) recordDepth = pendingArray + 1;
        pendingArray = -1;
      }
      if (ch === '{' || ch === '[') {
        depth++;
        if (ch === '{' && depth === recordDepth && buf === null) { buf = ''; from = i; }
        if (ch === '[' && recordDepth === -1) pendingArray = depth;
      } else if (ch === '}' || ch === ']') {
        if (ch === '}' && depth === recordDepth && buf !== null) {
          const text = buf + chunk.slice(from, i + 1);
          buf = null;
          try {
            yield JSON.parse(text);
          } catch {
            stats.parseErrors++;
          }
        }
        depth--;
        // The chosen array has closed: the next array of objects may hold more.
        if (ch === ']' && depth === recordDepth - 2) recordDepth = -1;
      }
    }
    if (buf !== null) buf += chunk.slice(from);
  }
  if (recordDepth === -1 && stats.records === 0) stats.noRecords = true;
}

/** RFC 4180 rows across chunks: quotes may hold delimiters, newlines and `""`. */
async function* csvRows(source, delim) {
  let field = '';
  let row = [];
  let quoted = false;
  let afterQuote = false;
  for await (const chunk of source) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (quoted) {
        if (ch === '"') {
          if (chunk[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; }
        } else field += ch;
        continue;
      }
      if (ch === '"' && field === '' && !afterQuote) { quoted = true; continue; }
      if (ch === delim) { row.push(field); field = ''; afterQuote = false; continue; }
      if (ch === '\n') {
        row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
        yield row;
        row = []; field = ''; afterQuote = false;
        continue;
      }
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); yield row; }
}

const TEXT_TIME = /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\]?\s*/;
const TEXT_LEVEL = /\b(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|ERR|FATAL|CRITICAL|PANIC|SEVERE)\b/;

/** A plain log line as a record: its timestamp and level, if it leads with them. */
function textRecord(line) {
  const rec = { message: line };
  const t = TEXT_TIME.exec(line);
  if (t) { rec.timestamp = t[1]; rec.message = line.slice(t[0].length); }
  const lv = TEXT_LEVEL.exec(rec.message.slice(0, 80));
  if (lv) rec.level = lv[1].toLowerCase();
  return rec;
}

/**
 * Every record in the file, in order. `stats` is filled in as it goes:
 * format, records, parseErrors, bytes read (approximately, as characters).
 *
 * @param {string} absPath
 * @param {{format?: string, signal?: {stopped: boolean}}} [opts]
 * @returns {AsyncGenerator<object>}
 */
export async function* readRecords(absPath, stats, { format, signal } = {}) {
  const counted = async function* (source) {
    for await (const c of source) { stats.chars += c.length; yield c; }
  };
  const source = counted(chunks(absPath, signal));
  stats.format = format;
  stats.records = 0;
  stats.parseErrors = 0;
  stats.chars = 0;

  if (format === 'json') {
    for await (const el of jsonElements(source, stats)) {
      for (const rec of expandElement(el)) { stats.records++; yield rec; }
    }
    return;
  }
  if (format === 'ndjson') {
    for await (const line of lines(source)) {
      if (!line.trim()) continue;
      let rec;
      try { rec = expandElement(JSON.parse(line)); } catch { stats.parseErrors++; rec = [textRecord(line)]; }
      for (const r of rec) { stats.records++; yield r; }
    }
    return;
  }
  if (format === 'csv' || format === 'tsv') {
    let header = null;
    for await (const row of csvRows(source, format === 'tsv' ? '\t' : detectDelimiter(stats.head))) {
      if (!header) { header = row.map((h, i) => h.trim().replace(/^﻿/, '') || `column${i + 1}`); continue; }
      if (row.length === 1 && row[0] === '') continue;
      const rec = {};
      header.forEach((h, i) => { if (row[i] !== undefined && row[i] !== '') rec[h] = row[i]; });
      // A JSON column (Datadog puts the event's attributes in one) is opened up.
      for (const [k, v] of Object.entries(rec)) {
        if (typeof v === 'string' && v.startsWith('{') && v.endsWith('}')) {
          try { Object.assign(rec, flatten(JSON.parse(v), k)); delete rec[k]; } catch { /* a brace in a message */ }
        }
      }
      stats.records++;
      yield rec;
    }
    return;
  }
  // text: a stack trace line belongs to the record above it.
  let held = null;
  for await (const line of lines(source)) {
    if (held && line && (/^\s/.test(line) || /^(?:Caused by|\.\.\. \d+ more)/.test(line))) {
      if (held.message.length < MAX_VALUE) held.message += `\n${line}`;
      continue;
    }
    if (held) { stats.records++; yield held; }
    held = line.trim() ? textRecord(line) : null;
  }
  if (held) { stats.records++; yield held; }
}

/** Comma, semicolon or tab, whichever the header has most of. */
function detectDelimiter(head = '') {
  const first = head.split('\n', 1)[0] || '';
  const count = (c) => first.split(c).length - 1;
  return [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
}
