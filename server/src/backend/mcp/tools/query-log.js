/**
 * `query_log`: a large log export, asked questions (v6.20).
 *
 * The plan is `.agent/artifacts/plans/2026-10-30-log-query.md`. One pass over
 * the file per call (`log-records.js` streams it), and an answer of at most
 * `REPORT_MAX` characters of plain text, because every character is typed into
 * a browser tab next turn.
 *
 * With nothing to filter on it is the overview a person starts a debugging
 * session with: how many records over what time, which levels, when the
 * errors started (a histogram with errors per bucket), which fields there are,
 * and the messages that repeat — numbers, ids and quoted values replaced, so
 * ten thousand timeouts to different hosts are one line with a count.
 */
import { existsSync, openSync, readSync, closeSync, statSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { displayPath } from '../../core/workspace/paths.js';
import { detectFormat, readHead, readRecords } from './log-records.js';

export const REPORT_MAX = 6000;
const TIME_BUDGET_MS = 60_000;
const SAMPLE_FOR_ROLES = 200;
const MAX_TEMPLATES = 5000;
const MAX_DISTINCT = 1000;

const ROLE_NAMES = {
  time: ['@timestamp', 'timestamp', 'time', 'ts', 'date', 'datetime', '_time', 'eventtime', 'logged_at', 'created_at'],
  level: ['level', 'status', 'severity', 'loglevel', 'log.level', 'levelname', 'severity_text', 'detected_level', 'lvl'],
  message: ['message', 'msg', 'log', 'line', '@message', 'body', 'content', 'text', 'event', 'error.message'],
  source: ['service', 'app', 'application', 'container_name', 'container', 'logger', 'host', 'hostname', 'source', 'job'],
};
const ERRORISH = new Set(['error', 'err', 'fatal', 'critical', 'crit', 'emergency', 'emerg', 'alert', 'panic', 'severe']);

/** A path as typed: `~` expanded, relative to the workspace. */
function resolvePath(p, workspace) {
  const s = String(p || '').trim();
  if (s === '~' || s.startsWith('~/')) return resolve(homedir(), s.slice(2));
  return s.startsWith('/') ? s : resolve(workspace || process.cwd(), s);
}

/** Epoch seconds, ms, µs or ns by magnitude; ISO and `YYYY-MM-DD HH:MM:SS` strings. */
export function parseTime(v) {
  if (v === undefined || v === null || v === '') return NaN;
  let n = typeof v === 'number' ? v : /^\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : NaN;
  if (!Number.isNaN(n)) {
    if (n > 1e17) return n / 1e6;
    if (n > 1e14) return n / 1e3;
    if (n > 1e11) return n;
    if (n > 1e8) return n * 1000;
    return NaN; // a small number is not a time
  }
  let s = String(v).trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2').replace(/,(\d+)/, '.$1');
  // A time with no zone is read as UTC, so it is shown as the file wrote it
  // rather than shifted by wherever the agent happens to run.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  n = Date.parse(s);
  return Number.isNaN(n) ? NaN : n;
}

/** Errors, warnings and the rest under one spelling, whatever the shipper called them. */
export function normalLevel(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v); // pino/bunyan: 60 fatal, 50 error, 40 warn, 30 info, 20 debug
    return n >= 60 ? 'fatal' : n >= 50 ? 'error' : n >= 40 ? 'warn' : n >= 30 ? 'info' : n >= 20 ? 'debug' : 'trace';
  }
  const s = String(v).toLowerCase().trim();
  if (s === 'warning') return 'warn';
  if (s === 'err') return 'error';
  if (s === 'information') return 'info';
  return s.slice(0, 20);
}
export const isErrorLevel = (level) => ERRORISH.has(level);

/**
 * A message with what varies taken out, so repeats can be counted. Ten
 * thousand "timeout after 3012ms to 10.0.4.7" are one template.
 */
export function messageTemplate(msg) {
  return String(msg ?? '').slice(0, 400)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<ip>')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '<email>')
    .replace(/\b0x[0-9a-f]+\b|\b(?=[0-9a-f]*\d)[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/"[^"\n]{1,200}"|'[^'\n]{1,200}'/g, '"<str>"')
    .replace(/\b(?=\w*\d)[A-Za-z0-9_-]{16,}\b/g, '<id>')
    .replace(/-?\b\d+(?:\.\d+)?(?:ms|s|m|h|kb|mb|gb|b|%)?\b/gi, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * A field by the name the model used: exact, then case-insensitive, then by
 * its last part (`status_code` is `attributes.http.status_code`). Cached per
 * name, because records from one source share their keys.
 */
function fieldKeys() {
  const cache = new Map();
  const keyOf = (rec, name) => {
    const known = cache.get(name);
    if (known !== undefined && known in rec) return known;
    if (name in rec) { cache.set(name, name); return name; }
    const lower = name.toLowerCase();
    let hit;
    for (const k of Object.keys(rec)) {
      const kl = k.toLowerCase();
      if (kl === lower) { hit = k; break; }
      if (hit === undefined && kl.endsWith(`.${lower}`)) hit = k;
    }
    if (hit !== undefined) cache.set(name, hit);
    return hit;
  };
  return { keyOf, get: (rec, name) => { const k = keyOf(rec, name); return k === undefined ? undefined : rec[k]; } };
}

/** Which keys hold the time, level, message and source, judged on the first records. */
export function findRoles(sample) {
  const keys = new Map();
  for (const rec of sample) for (const k of Object.keys(rec)) keys.set(k, (keys.get(k) || 0) + 1);
  const roles = {};
  for (const [role, names] of Object.entries(ROLE_NAMES)) {
    let best = null;
    for (const name of names) {
      for (const [k, n] of keys) {
        const kl = k.toLowerCase();
        const last = kl.split('.').pop();
        if (kl !== name && last !== name && !kl.endsWith(`.${name}`)) continue;
        if (role === 'time' && !sample.some((r) => r[k] !== undefined && !Number.isNaN(parseTime(r[k])))) continue;
        // Prefer the shortest path among equal names: `status` over `http.status`.
        const score = names.indexOf(name) * 100 + k.split('.').length * 10 - n / sample.length;
        if (!best || score < best.score) best = { key: k, score };
      }
      if (best) break;
    }
    if (best) roles[role] = best.key;
  }
  // A level column that holds HTTP codes is not a level.
  if (roles.level && sample.every((r) => r[roles.level] === undefined || /^\d{3}$/.test(String(r[roles.level])))) {
    delete roles.level;
  }
  return roles;
}

const OPS = /^\s*([^=!<>~\s][^=!<>~]*?)\s*(!=|!~|>=|<=|=|~|>|<)\s*(.*?)\s*$/;

/** `status=error`, `service!=web`, `message~timeout|refused`, `status_code>=500`, `user.id=*`. */
export function parseWhere(clauses) {
  const list = Array.isArray(clauses) ? clauses : clauses ? [clauses] : [];
  return list.map((c) => {
    const m = OPS.exec(String(c));
    if (!m) throw new Error(`Cannot read the filter "${c}". Write field=value, field!=value, field~regex, field>=number.`);
    const [, field, op, rawValue] = m;
    const value = rawValue.replace(/^["']|["']$/g, '');
    let re = null;
    if (op === '~' || op === '!~') {
      try { re = new RegExp(value, 'i'); } catch (e) { throw new Error(`Bad regex in "${c}": ${e.message}`); }
    }
    return { field: field.trim(), op, value, re, num: Number(value) };
  });
}

function matches(clause, actual, roles) {
  const { op, value, re, num } = clause;
  if (op === '=' && value === '*') return actual !== undefined && actual !== null && actual !== '';
  if (op === '!=' && value === '*') return actual === undefined || actual === null || actual === '';
  const isLevel = roles.level && clause.key === roles.level;
  const s = actual === undefined || actual === null ? '' : String(actual);
  switch (op) {
    case '=': return isLevel ? normalLevel(s) === normalLevel(value) : s.toLowerCase() === value.toLowerCase();
    case '!=': return isLevel ? normalLevel(s) !== normalLevel(value) : s.toLowerCase() !== value.toLowerCase();
    case '~': return re.test(s);
    case '!~': return !re.test(s);
    default: {
      // Numbers compare as numbers; a time field compares as a time.
      let a = Number(s);
      let b = num;
      if (Number.isNaN(a) || Number.isNaN(b)) { a = parseTime(s); b = parseTime(value); }
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b;
    }
  }
}

const iso = (t) => (Number.isNaN(t) || t === undefined ? '?' : new Date(t).toISOString().replace('.000Z', 'Z'));
const n = (x) => Number(x).toLocaleString('en-US');
const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const oneLineText = (v) => String(v ?? '').replace(/\s*\n\s*/g, ' ⏎ ');

/** A record as one line: number, time, level, source, message, and the fields asked for. */
function recordLine(i, rec, roles, get, fields, timeOnlyClock) {
  const t = roles.time ? parseTime(rec[roles.time]) : NaN;
  const time = Number.isNaN(t) ? '' : timeOnlyClock ? iso(t).slice(11) : iso(t);
  const level = roles.level ? normalLevel(rec[roles.level]) : null;
  const source = roles.source ? rec[roles.source] : null;
  const msg = roles.message ? rec[roles.message] : null;
  const head = [`#${i + 1}`, time, level, source].filter(Boolean).join(' ');
  let extra = '';
  if (fields?.length) {
    if (fields.includes('*')) {
      const rest = Object.fromEntries(Object.entries(rec).filter(([k]) => ![roles.time, roles.level, roles.message, roles.source].includes(k)));
      extra = ` ${clip(JSON.stringify(rest), 700)}`;
    } else {
      extra = ` (${fields.map((f) => `${f}=${clip(oneLineText(get(rec, f) ?? '∅'), 120)}`).join(', ')})`;
    }
  }
  const body = msg !== null && msg !== undefined ? oneLineText(msg) : clip(JSON.stringify(rec), 400);
  return `${head} | ${clip(body, fields?.includes('*') ? 300 : 260)}${extra}`;
}

/** Counts in time order, `buckets` of them, with errors beside each. */
function histogram(times, errorTimes, buckets = 12) {
  if (!times.length) return [];
  let lo = Infinity; let hi = -Infinity;
  for (const t of times) { if (t < lo) lo = t; if (t > hi) hi = t; }
  if (hi === lo) return [`${iso(lo)}  ${n(times.length)}`];
  const width = (hi - lo) / buckets;
  const all = new Array(buckets).fill(0);
  const errs = new Array(buckets).fill(0);
  const at = (t) => Math.min(buckets - 1, Math.floor((t - lo) / width));
  for (const t of times) all[at(t)]++;
  for (const t of errorTimes) errs[at(t)]++;
  const peak = Math.max(...all);
  const sameDay = iso(lo).slice(0, 10) === iso(hi).slice(0, 10);
  return all.map((c, b) => {
    const start = iso(lo + b * width);
    const label = sameDay ? start.slice(11, 19) : start.slice(0, 16).replace('T', ' ');
    const bar = '█'.repeat(Math.round((c / peak) * 20)).padEnd(20, ' ');
    return `${label} ${bar} ${n(c).padStart(8)}${errorTimes.length ? `  err ${n(errs[b])}` : ''}`;
  });
}

/** Lines up to the budget, then a line saying what was left out. */
function fit(lines, max) {
  const out = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    if (used + lines[i].length + 1 > max - 80) {
      out.push(`… ${n(lines.length - i)} more lines not shown (narrow with where, from/to or limit)`);
      break;
    }
    out.push(lines[i]);
    used += lines[i].length + 1;
  }
  return out.join('\n');
}

/**
 * The tool. See the catalog entry for what the model is told.
 *
 * @returns {Promise<{path: string, format: string, records: number, matched: number|null, report: string}>}
 */
export async function queryLog(args = {}, context = {}) {
  if (!args.path) throw new Error('query_log needs a path.');
  const absPath = resolvePath(args.path, context.workspace);
  const relPath = displayPath(context.workspace || process.cwd(), absPath);
  if (!existsSync(absPath)) throw new Error(`File not found: ${relPath}`);
  const st = statSync(absPath);
  if (st.isDirectory()) throw new Error(`${relPath} is a directory. Give query_log one exported file.`);

  const where = parseWhere(args.where);
  let textRe = null;
  if (args.text) {
    try { textRe = new RegExp(args.text, 'i'); } catch { textRe = new RegExp(String(args.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
  }
  const from = args.from ? parseTime(args.from) : NaN;
  const to = args.to ? parseTime(args.to) : NaN;
  if (args.from && Number.isNaN(from)) throw new Error(`Cannot read the time "${args.from}". Use ISO, like 2026-10-29T14:05:00Z.`);
  if (args.to && Number.isNaN(to)) throw new Error(`Cannot read the time "${args.to}". Use ISO, like 2026-10-29T14:05:00Z.`);
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
  const offset = Math.max(0, Number(args.offset) || 0);
  const fields = Array.isArray(args.fields) ? args.fields.map(String) : args.fields ? [String(args.fields)] : null;
  const groupBy = args.groupBy ? String(args.groupBy) : null;
  const context_ = Math.max(0, Math.min(50, Number(args.context ?? 5)));
  const aroundIndex = args.around !== undefined && /^\d+$/.test(String(args.around).replace(/^#/, ''))
    ? Number(String(args.around).replace(/^#/, '')) - 1 : null;
  const aroundTime = args.around !== undefined && aroundIndex === null ? parseTime(args.around) : NaN;
  if (args.around !== undefined && aroundIndex === null && Number.isNaN(aroundTime)) {
    throw new Error(`around takes a record number (#1234) or a time; "${args.around}" is neither.`);
  }
  const filtering = where.length > 0 || textRe || !Number.isNaN(from) || !Number.isNaN(to);
  const around = aroundIndex !== null || !Number.isNaN(aroundTime);
  // A count is the answer to groupBy; records come too only when asked for.
  const listing = filtering && (!groupBy || args.limit !== undefined);

  // What the file is.
  const head = Buffer.alloc(Math.min(65536, st.size));
  if (!/\.gz$/i.test(absPath)) {
    const fd = openSync(absPath, 'r');
    try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
  }
  const headText = head.toString('utf8');
  let format = args.format || null;
  const stats = { head: headText };
  const signal = { stopped: false };
  const startedAt = Date.now();

  if (/\.gz$/i.test(absPath)) stats.head = await readHead(absPath); // the start of the decompressed text
  format = format || detectFormat(stats.head, absPath);
  const source = readRecords(absPath, stats, { format, signal });

  // One pass.
  const { keyOf, get } = fieldKeys();
  let seenKeys = [];
  let roles = null;
  const buffered = [];
  const fieldStats = new Map();
  const levels = new Map();
  const times = [];
  const errorTimes = [];
  const templates = new Map();
  const groups = new Map();
  const shown = [];
  const ring = []; // the records before an `around` target
  let aroundFound = -1;
  let afterLeft = 0;
  let matched = 0;
  let mMin = Infinity;
  let mMax = -Infinity;
  const roleKey = (name) => ({ level: roles.level, time: roles.time, timestamp: roles.time, message: roles.message, msg: roles.message, service: roles.source }[name.toLowerCase()]);
  let tMin = Infinity;
  let tMax = -Infinity;
  let index = -1;

  const consider = (rec) => {
    index++;
    const t = roles.time ? parseTime(rec[roles.time]) : NaN;
    if (!Number.isNaN(t)) { if (t < tMin) tMin = t; if (t > tMax) tMax = t; }

    if (around) {
      if (aroundFound === -1) {
        ring.push([index, rec]);
        if (ring.length > context_ + 1) ring.shift();
        const hit = aroundIndex !== null ? index === aroundIndex : !Number.isNaN(t) && t >= aroundTime;
        if (hit) { aroundFound = index; afterLeft = context_; }
      } else if (afterLeft > 0) {
        ring.push([index, rec]);
        afterLeft--;
      } else {
        signal.stopped = true;
      }
      return;
    }

    if (filtering) {
      if (!Number.isNaN(from) && !(t >= from)) return;
      if (!Number.isNaN(to) && !(t <= to)) return;
      for (const c of where) {
        // A key in the record, or a role's name: `level=error` works whatever
        // the shipper called the level.
        c.key = keyOf(rec, c.field) ?? roleKey(c.field);
        if (!matches(c, c.key === undefined ? undefined : rec[c.key], roles)) return;
      }
      if (textRe) {
        const msg = roles.message ? rec[roles.message] : undefined;
        if (!(msg !== undefined && textRe.test(String(msg))) && !textRe.test(JSON.stringify(rec))) return;
      }
    }
    matched++;

    const level = roles.level ? normalLevel(rec[roles.level]) : null;
    if (level) levels.set(level, (levels.get(level) || 0) + 1);
    if (!Number.isNaN(t)) {
      if (t < mMin) mMin = t;
      if (t > mMax) mMax = t;
      times.push(t);
      if (level && isErrorLevel(level)) errorTimes.push(t);
    }
    if (roles.message && rec[roles.message] !== undefined && templates.size < MAX_TEMPLATES) {
      const key = messageTemplate(rec[roles.message]);
      const tpl = templates.get(key) || { count: 0, errors: 0, first: index, firstT: t, lastT: t };
      tpl.count++;
      if (level && isErrorLevel(level)) tpl.errors++;
      if (!Number.isNaN(t)) { if (!(tpl.firstT <= t)) tpl.firstT = t; if (!(tpl.lastT >= t)) tpl.lastT = t; }
      templates.set(key, tpl);
    } else if (roles.message && rec[roles.message] !== undefined) {
      const tpl = templates.get(messageTemplate(rec[roles.message]));
      if (tpl) tpl.count++;
    }
    if (!filtering && !groupBy) {
      for (const [k, v] of Object.entries(rec)) {
        let f = fieldStats.get(k);
        if (!f) { f = { count: 0, values: new Map(), many: false, num: 0 }; fieldStats.set(k, f); }
        f.count++;
        if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)))) f.num++;
        if (!f.many) {
          const s = String(v).slice(0, 80);
          f.values.set(s, (f.values.get(s) || 0) + 1);
          if (f.values.size > MAX_DISTINCT) { f.many = true; f.values = new Map([...f.values].sort((a, b) => b[1] - a[1]).slice(0, 20)); }
        }
      }
    }
    if (groupBy && groupBy !== 'message' && groupBy !== 'time') {
      const v = get(rec, groupBy) ?? (groupBy === 'level' && level) ?? undefined;
      const key = v === undefined || v === null || v === '' ? '∅' : String(v).slice(0, 100);
      const g = groups.get(key) || { count: 0, errors: 0 };
      g.count++;
      if (level && isErrorLevel(level)) g.errors++;
      if (groups.size < 50_000 || groups.has(key)) groups.set(key, g);
    }
    if (listing && matched > offset && shown.length < limit) shown.push([index, rec]);
  };

  try {
    for await (const rec of source) {
      if (!roles) {
        buffered.push(rec);
        if (buffered.length < SAMPLE_FOR_ROLES) continue;
        roles = findRoles(buffered);
        seenKeys = [...new Set(buffered.flatMap((r) => Object.keys(r)))];
        buffered.splice(0).forEach(consider);
        continue;
      }
      consider(rec);
      if (signal.stopped) break;
      if ((index & 0x3fff) === 0 && Date.now() - startedAt > TIME_BUDGET_MS) { signal.stopped = 'time'; break; }
    }
  } catch (e) {
    throw new Error(`Could not read ${relPath} as ${format}: ${e.message}`);
  }
  if (!roles) {
    roles = findRoles(buffered);
    seenKeys = [...new Set(buffered.flatMap((r) => Object.keys(r)))];
    buffered.splice(0).forEach(consider);
  }

  // The report.
  const total = stats.records;
  const out = [];
  const roleLine = ['time', 'level', 'message', 'source'].filter((r) => roles[r]).map((r) => `${r}=${roles[r]}`).join(' ');
  // `around` stops reading once it has its context, so it knows only the start.
  const partial = signal.stopped === true;
  out.push(`${relPath} · ${format} · ${partial ? `read to #${n(total)}` : `${n(total)} records`} · ${(st.size / 1048576).toFixed(1)} MB`
    + (Number.isFinite(tMin) && !partial ? ` · ${iso(tMin)} → ${iso(tMax)}` : ''));
  out.push(`fields: ${roleLine || 'no time, level or message field recognised'}`
    + (stats.parseErrors ? ` · ${n(stats.parseErrors)} unparsable lines` : ''));
  if (signal.stopped === 'time') {
    out.push(`⚠ stopped after ${TIME_BUDGET_MS / 1000}s at record ${n(index + 1)}: narrow with from/to, or split the file`);
  }
  if (total === 0) {
    out.push(stats.noRecords ? 'No array of records was found in this JSON.' : 'No records.');
    return { path: relPath, format, records: 0, matched: 0, report: out.join('\n') };
  }

  const templateLines = (max) => [...templates.entries()]
    .sort((a, b) => (b[1].errors - a[1].errors) || (b[1].count - a[1].count))
    .slice(0, max)
    .map(([tpl, s]) => `${n(s.count).padStart(7)}× ${s.errors ? `(${n(s.errors)} err) ` : ''}${tpl}`
      + `  [#${s.first + 1}${Number.isNaN(s.firstT) || s.firstT === undefined ? '' : `, ${iso(s.firstT).slice(11, 19)}–${iso(s.lastT).slice(11, 19)}`}]`);

  if (around) {
    if (aroundFound === -1) {
      out.push(`Nothing at ${args.around}: the file has ${n(index + 1)} records${Number.isFinite(tMax) ? ` ending ${iso(tMax)}` : ''}.`);
    } else {
      out.push('', `Records around #${aroundFound + 1} (${context_} each side):`);
      out.push(...ring.map(([i, rec]) => `${i === aroundFound ? '▶ ' : '  '}${recordLine(i, rec, roles, get, fields, false)}`));
    }
    return { path: relPath, format, records: total, matched: null, report: fit(out, REPORT_MAX) };
  }

  const levelLine = [...levels.entries()].sort((a, b) => b[1] - a[1]).map(([l, c]) => `${l} ${n(c)}`).join(' · ');

  if (groupBy === 'time' || (!filtering && !groupBy)) {
    if (levelLine) out.push(`levels: ${levelLine}`);
    const h = histogram(times, errorTimes);
    if (h.length) out.push('', 'over time:', ...h);
  }

  if (filtering) {
    out.push(`matched ${n(matched)} of ${n(total)}${levelLine ? ` · ${levelLine}` : ''}`
      + (Number.isFinite(mMin) ? ` · ${iso(mMin)} → ${iso(mMax)}` : ''));
  }

  if (groupBy === 'message' || (!groupBy && templates.size)) {
    const lines = templateLines(groupBy === 'message' ? 40 : filtering ? 8 : 15);
    if (lines.length) out.push('', `repeated messages (${n(templates.size)}${templates.size >= MAX_TEMPLATES ? '+' : ''} distinct, errors first; [first record, time span]):`, ...lines);
  }

  if (groupBy && groupBy !== 'message' && groupBy !== 'time') {
    const rows = [...groups.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 40);
    out.push('', `by ${groupBy} (${n(groups.size)} values):`,
      ...rows.map(([k, g]) => `${n(g.count).padStart(9)}  ${errorTimes.length || g.errors ? `err ${n(g.errors).padStart(6)}  ` : ''}${clip(oneLineText(k), 100)}`));
  }

  if (!filtering && !groupBy) {
    const fieldLines = [...fieldStats.entries()]
      .filter(([k]) => k !== roles.message)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 30)
      .map(([k, f]) => {
        const share = Math.round((f.count / matched) * 100);
        const top = [...f.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const distinct = f.many ? `${MAX_DISTINCT}+` : n(f.values.size);
        const lowCard = !f.many && f.values.size <= 30;
        // Values that repeat are worth naming; ids and timestamps are not.
        const sample = top.length && top[0][1] > 1 && (lowCard || f.num < f.count)
          ? top.filter(([, c]) => c > 1).map(([v, c]) => `${clip(oneLineText(v), 40)} (${n(c)})`).join(', ')
          : '';
        return `${k} · ${share}% · ${distinct} values${sample ? ` · ${sample}` : ''}`;
      });
    out.push('', 'fields (share of records · distinct values · top):', ...fieldLines);
    out.push('', 'next: where=["level=error"] for the records, groupBy="<field>" to count, around=<#n> for what led up to one.');
  }

  if (listing) {
    if (shown.length) {
      const sameDay = Number.isFinite(tMin) && iso(tMin).slice(0, 10) === iso(tMax).slice(0, 10);
      out.push('', `records ${n(offset + 1)}–${n(offset + shown.length)} of ${n(matched)}:`,
        ...shown.map(([i, rec]) => recordLine(i, rec, roles, get, fields, sameDay)));
      if (matched > offset + shown.length) out.push(`… ${n(matched - offset - shown.length)} more: offset=${offset + shown.length}`);
    } else if (matched === 0) {
      out.push(where.length ? `No record matched. Fields include: ${clip(seenKeys.join(', ') || roleLine, 400)}` : 'No record matched.');
    }
  }

  return { path: relPath, format, records: total, matched: filtering ? matched : null, report: fit(out, REPORT_MAX) };
}
