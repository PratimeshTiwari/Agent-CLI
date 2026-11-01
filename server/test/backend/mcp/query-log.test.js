/**
 * `query_log` (v6.20): log files and exports, asked questions.
 *
 * Every fixture holds the same story — a payments outage that starts at
 * 12:30 — in each format a person might download it in, so each test can ask
 * whether the format was read, not whether the story differs.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  REPORT_MAX, findRoles, messageTemplate, normalLevel, parseTime, parseWhere, queryLog,
} from '../../../src/backend/mcp/tools/query-log.js';
import { detectFormat, flatten } from '../../../src/backend/mcp/tools/log-records.js';
import { logReadRedirect, runLogRead } from '../../../src/backend/core/log-read.js';
import { formatReadResult } from '../../../src/backend/core/result-budget.js';
import { summarizeResult } from '../../../src/frontend/transcript/tool-rows.js';

let ws;
const T0 = Date.parse('2026-10-29T10:00:00Z');
const N = 400;
const recs = Array.from({ length: N }, (_, i) => {
  const t = new Date(T0 + i * 36_000).toISOString(); // 10:00 → 13:59
  const outage = i >= 250 && i % 3 === 0; // from 12:30
  return {
    timestamp: t,
    status: outage ? 'error' : i % 50 === 7 ? 'warn' : 'info',
    service: outage ? 'payments' : ['api', 'web', 'worker'][i % 3],
    message: outage ? `upstream timeout after ${3000 + i}ms calling stripe at 10.0.${i % 9}.${i % 200}` : `GET /v1/orders/${i * 7} 200 in ${i % 90}ms`,
    attributes: { http: { status_code: outage ? 504 : 200 }, request_id: `req-${i}` },
  };
});
const ERRORS = recs.filter((r) => r.status === 'error').length;
const FIRST_ERROR = recs.findIndex((r) => r.status === 'error') + 1;
const FIRST_T = recs[FIRST_ERROR - 1].timestamp.replace('.000Z', 'Z'); // 12:31:12, the outage's first line
const ask = (args) => queryLog(args, { workspace: ws });

before(() => {
  ws = mkdtempSync(join(tmpdir(), 'qlog-'));
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  writeFileSync(join(ws, 'app.ndjson'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(ws, 'app.ndjson.gz'), gzipSync(recs.map((r) => JSON.stringify(r)).join('\n') + '\n'));
  // Datadog's API, on one line.
  writeFileSync(join(ws, 'dd.json'), JSON.stringify({
    data: recs.map((r, i) => ({ id: `AQ${i}`, type: 'log', attributes: r })), meta: { page: { after: 'x' } },
  }));
  // Datadog's UI export: an error's message spans lines, inside quotes.
  writeFileSync(join(ws, 'dd.csv'), 'Date,Host,Service,Status,Message\n' + recs.map((r) => [r.timestamp, 'i-1', r.service, r.status,
    r.status === 'error' ? `${r.message}\n  at Stripe.charge (pay.rb:42), "retry"` : r.message].map(q).join(',')).join('\n') + '\n');
  // Loki query_range: streams of [ns, line].
  const streams = {};
  for (const r of recs) (streams[r.service] ||= []).push([String(Date.parse(r.timestamp) * 1e6), JSON.stringify({ level: r.status, msg: r.message })]);
  writeFileSync(join(ws, 'loki.json'), JSON.stringify({ status: 'success', data: { resultType: 'streams',
    result: Object.entries(streams).map(([app, values]) => ({ stream: { app }, values })) } }, null, 2));
  // A Grafana data frame: columns, not rows.
  writeFileSync(join(ws, 'frame.json'), JSON.stringify([{ schema: { fields: [{ name: 'Time' }, { name: 'Line' }, { name: 'level' }] },
    data: { values: [recs.map((r) => Date.parse(r.timestamp)), recs.map((r) => r.message), recs.map((r) => r.status)] } }]));
  // Plain text, no zone on the time, with a stack trace under each error.
  writeFileSync(join(ws, 'app.log'), recs.map((r) => `${r.timestamp.replace('T', ' ').replace('Z', '')} ${r.status.toUpperCase()} ${r.message}`
    + (r.status === 'error' ? '\n    at Stripe.charge (pay.rb:42)' : '')).join('\n') + '\n');
  writeFileSync(join(ws, 'empty.json'), '{"ok": true}');
});
after(() => rmSync(ws, { recursive: true, force: true }));

describe('every format tells the same story', () => {
  for (const [file, format] of [['app.ndjson', 'ndjson'], ['app.ndjson.gz', 'ndjson'], ['dd.json', 'json'], ['dd.csv', 'csv'],
    ['loki.json', 'json'], ['frame.json', 'json'], ['app.log', 'text']]) {
    test(`${file}: ${N} records, ${ERRORS} errors, from ${FIRST_T.slice(11, 19)}`, async () => {
      const r = await ask({ path: file, where: ['level=error'], limit: 1 });
      assert.equal(r.format, format);
      assert.equal(r.records, N);
      assert.equal(r.matched, ERRORS);
      assert.match(r.report, /2026-10-29T10:00:00Z → 2026-10-29T13:59:24Z/, 'the time range, in UTC as written');
      assert.ok(r.report.includes(`matched ${ERRORS} of 400 · error ${ERRORS} · ${FIRST_T} →`), r.report);
      assert.match(r.report, /upstream timeout after <n> calling stripe at <ip>/, 'one template for every outage line');
    });
  }

  test('a CSV message with a newline and quotes stays one record', async () => {
    const r = await ask({ path: 'dd.csv', where: ['level=error'], limit: 1 });
    assert.match(r.report, new RegExp(`#${FIRST_ERROR} ${FIRST_T.slice(11)} error payments \\| upstream timeout after \\d+ms calling stripe at [\\d.]+ ⏎ at Stripe\\.charge \\(pay\\.rb:42\\), "retry"`));
  });

  test('a stack trace belongs to the line above it', async () => {
    const r = await ask({ path: 'app.log', where: ['level=error'], limit: 1 });
    assert.match(r.report, /ERROR upstream timeout .* ⏎ at Stripe\.charge/);
  });

  test('JSON that holds no records says so', async () => {
    const r = await ask({ path: 'empty.json' });
    assert.equal(r.records, 0);
    assert.match(r.report, /No array of records was found/);
  });
});

describe('the overview', () => {
  test('time range, levels, errors over time, repeated messages, fields — inside the budget', async () => {
    const r = await ask({ path: 'dd.json' });
    assert.equal(r.matched, null);
    assert.match(r.report, /fields: time=timestamp level=status message=message source=service/);
    assert.match(r.report, new RegExp(`levels: info \\d+ · error ${ERRORS} · warn \\d+`));
    const hist = r.report.split('\n').filter((l) => /^\d\d:\d\d:\d\d █/.test(l));
    assert.equal(hist.length, 12);
    assert.match(hist[0], /err 0$/, 'no errors at 10:00');
    assert.match(hist[11], /err [1-9]/, 'errors by the end');
    assert.match(r.report, /^ +\d+× \(\d+ err\) upstream timeout/m, 'errors first among the repeats');
    assert.match(r.report, /attributes\.http\.status_code · 100% · 2 values · 200 \(\d+\), 504 \(\d+\)/);
    assert.doesNotMatch(r.report, /request_id · .*req-1 \(1\)/, 'unique values are not listed as if they repeated');
    assert.ok(r.report.length <= REPORT_MAX);
  });
});

describe('narrowing', () => {
  test('a field by its last part, a number compared as a number', async () => {
    const r = await ask({ path: 'app.ndjson', where: ['status_code>=500', 'service=payments'], fields: ['request_id'], limit: 2 });
    assert.equal(r.matched, ERRORS);
    assert.match(r.report, new RegExp(`#${FIRST_ERROR} .*\\(request_id=req-${FIRST_ERROR - 1}\\)`));
    assert.match(r.report, /more: offset=2/);
  });

  test('text, from and to', async () => {
    const r = await ask({ path: 'app.ndjson', text: 'stripe', from: '2026-10-29T13:00:00Z', to: '2026-10-29T13:10:00Z' });
    const expected = recs.filter((x) => x.status === 'error' && x.timestamp >= '2026-10-29T13:00' && x.timestamp <= '2026-10-29T13:10:00.000Z').length;
    assert.equal(r.matched, expected);
  });

  test('groupBy counts, and lists records only when asked', async () => {
    const r = await ask({ path: 'app.ndjson', where: ['level=error'], groupBy: 'host' in recs[0] ? 'host' : 'service' });
    assert.match(r.report, new RegExp(`by service \\(1 values\\):\\n +${ERRORS} +err +${ERRORS} +payments`));
    assert.doesNotMatch(r.report, /records 1–/);
    assert.match((await ask({ path: 'app.ndjson', where: ['level=error'], groupBy: 'service', limit: 1 })).report, /records 1–1 of/);
  });

  test('around a record: what led up to it, unfiltered', async () => {
    const r = await ask({ path: 'app.ndjson', around: `#${FIRST_ERROR}`, context: 2 });
    const lines = r.report.split('\n').filter((l) => /^(▶ | {2})#/.test(l));
    assert.equal(lines.length, 5);
    assert.match(lines[2], new RegExp(`^▶ #${FIRST_ERROR} .* error payments`));
    assert.match(r.report, /read to #/, 'it stops reading, and says so');
    const byTime = await ask({ path: 'app.ndjson', around: FIRST_T, context: 0 });
    assert.match(byTime.report, new RegExp(`▶ #${FIRST_ERROR} `));
  });

  test('a filter it cannot read, and a field that is not there, say so', async () => {
    await assert.rejects(ask({ path: 'app.ndjson', where: ['level'] }), /Write field=value/);
    await assert.rejects(ask({ path: 'app.ndjson', where: ['message~(('] }), /Bad regex/);
    await assert.rejects(ask({ path: 'missing.log' }), /File not found/);
    const r = await ask({ path: 'app.ndjson', where: ['nosuch=1'] });
    assert.match(r.report, /No record matched\. Fields include: timestamp, status, service, message/);
  });
});

describe('the parts', () => {
  test('times: epoch by magnitude, no zone is UTC, small numbers are not times', () => {
    const iso = (v) => new Date(parseTime(v)).toISOString();
    assert.equal(iso(T0 / 1000), '2026-10-29T10:00:00.000Z');
    assert.equal(iso(T0), '2026-10-29T10:00:00.000Z');
    assert.equal(iso(`${T0}000000`), '2026-10-29T10:00:00.000Z', 'Loki\'s nanoseconds');
    assert.equal(iso('2026-10-29 10:00:00,250'), '2026-10-29T10:00:00.250Z');
    assert.ok(Number.isNaN(parseTime(504)));
  });

  test('levels: shippers\' spellings and pino\'s numbers', () => {
    assert.equal(normalLevel('WARNING'), 'warn');
    assert.equal(normalLevel(50), 'error');
    assert.equal(normalLevel('Error'), 'error');
  });

  test('a template takes out what varies, and keeps what does not', () => {
    assert.equal(messageTemplate('timeout after 3012ms to 10.0.4.7:443 for 5f0c2a1e-1111-4a4a-8b8b-0123456789ab'),
      'timeout after <n> to <ip> for <uuid>');
    assert.equal(messageTemplate('user "bob" not found'), messageTemplate('user "alice" not found'));
    assert.notEqual(messageTemplate('payment failed'), messageTemplate('payment refunded'));
  });

  test('roles: the shortest name wins, and an HTTP status is not a level', () => {
    assert.deepEqual(findRoles([{ ts: T0, 'http.status': 500, msg: 'x' }]), { time: 'ts', message: 'msg' });
    assert.equal(findRoles([{ status: 'error', 'attributes.status': 'x', timestamp: '2026-10-29T10:00:00Z' }]).level, 'status');
  });

  test('filters parse, and = * means present', () => {
    assert.deepEqual(parseWhere(['user.id=*']).map((c) => [c.field, c.op, c.value]), [['user.id', '=', '*']]);
    assert.deepEqual(parseWhere('code >= 500').map((c) => [c.field, c.op, c.value]), [['code', '>=', '500']]);
  });

  test('formats, from the first bytes', () => {
    assert.equal(detectFormat('{"a":1}\n{"a":2}\n', 'x.json'), 'ndjson');
    assert.equal(detectFormat('{\n  "data": [', 'x.json'), 'json');
    assert.equal(detectFormat('Date,Host,Status\n', 'export.txt'), 'csv');
    assert.equal(detectFormat('2026-10-29 10:00:00 INFO a, b, c', 'app.txt'), 'text');
    assert.deepEqual(flatten({ a: { b: 1, c: [1, 2] } }), { 'a.b': 1, 'a.c': '1, 2' });
  });
});

describe('read_file of a large log is answered with the overview, where the prompt offers query_log', () => {
  const big = () => {
    writeFileSync(join(ws, 'big.ndjson'), `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`.repeat(2));
    writeFileSync(join(ws, 'big.json'), JSON.stringify({ data: [...recs, ...recs] }));
    writeFileSync(join(ws, 'package-lock.json'), JSON.stringify({ packages: Object.fromEntries(recs.map((r, i) => [`p${i}`, { version: '1.0.0', resolved: r.message }])) }));
  };
  const read = (path, extra = {}) => ({ name: 'read_file', args: { path, ...extra } });

  test('the trigger', () => {
    big();
    const on = { workspace: ws, offered: true };
    assert.ok(logReadRedirect(read('big.ndjson'), on));
    assert.ok(logReadRedirect(read('big.json'), on), 'a .json whose records have a time and a message');
    assert.equal(logReadRedirect(read('package-lock.json'), on), null, 'a large .json that is not a log');
    assert.equal(logReadRedirect(read('app.log'), on), null, 'small: read it');
    assert.equal(logReadRedirect(read('big.ndjson', { startLine: 1, endLine: 40 }), on), null, 'a range reads directly');
    assert.equal(logReadRedirect(read('big.ndjson'), { workspace: ws, offered: false }), null, 'v1 never heard of query_log');
  });

  test('the answer says it is the overview, and how to narrow it', async () => {
    big();
    const { MCPServer } = await import('../../../src/backend/mcp/mcp-server.js');
    const server = new MCPServer(ws);
    const info = logReadRedirect(read('big.ndjson'), { workspace: ws, offered: true });
    const r = await runLogRead(server, read('big.ndjson'), info, {});
    assert.equal(r.result.delegated, 'query_log');
    const text = formatReadResult(r.result);
    assert.match(text, /^big\.ndjson is a log \([\d.]+ MB\), so this is query_log's overview, not the file\. Narrow it with query_log/);
    assert.match(text, /levels: info/);
    assert.equal(summarizeResult('read_file', r.result), '800 records · log overview');
    assert.equal(summarizeResult('query_log', { records: 850000, matched: 248 }), '248 of 850,000 records');
  });

  test('dispatch: the overview comes before the subagent digest, and only on a version that offers the tool', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../../src/backend/core/agent-loop.js', import.meta.url), 'utf8');
    assert.match(src, /const logRead = logReadRedirect\(call, \{[\s\S]*?offered: Boolean\(resolvePromptVersion\(this\.promptVersion\)\.flags\?\.logQuery\)/);
    assert.match(src, /const delegate = !logRead && shouldDelegateRead\(/);
    assert.match(src, /\} else if \(logRead\) \{\s*result = await runLogRead\(/);
  });
});
