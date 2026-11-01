import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logsHomeItems, failureItems } from '../../src/frontend/logs-view.js';
import { handleSlashCommand } from '../../src/frontend/hooks/use-slash-commands.js';
import { AgentLoop } from '../../src/backend/core/agent-loop.js';
import { logError, logNotice, flushPending } from '../../src/backend/core/error-log.js';
import { logTrace, summariseTraces } from '../../src/backend/core/trace-log.js';
import { logToolUsage } from '../../src/backend/core/tool-usage.js';

/*
 * The `/logs` picker (v5.35): every question the log answers, each row with
 * its answer, and the typed forms still printing the full one.
 */

const time = () => '4:12 PM';

test('an empty log: every row still answers, and there is nothing to clear', () => {
  const items = logsHomeItems({}, { time });
  assert.deepEqual(items.map((i) => i.value), ['failures', 'speed', 'tools', 'rates', 'notices']);
  assert.match(items[0].detail, /nothing has failed/);
  assert.match(items[1].detail, /no timings yet/);
  assert.match(items[2].detail, /nothing recorded yet/);
  assert.match(items[3].detail, /no turns recorded yet/);
  assert.equal(items[4].detail, 'none logged');
  assert.equal(items[0].colour, undefined, 'nothing to alarm about');
});

test('a full log: the answers are on the rows, versions only when there are two', () => {
  const T = { danger: 'red' };
  const data = {
    summary: {
      total: 3,
      byFlow: [
        { flow: 'tool', count: 1, label: 'MCP tool execution', last: '2026-10-28T10:00:00Z' },
        { flow: 'extension', count: 2, label: 'Chrome extension', last: '2026-10-28T11:00:00Z' },
      ],
      notices: { count: 4 },
    },
    traces: {
      stages: [{ stage: 'complete', n: 12, median: 6004, p90: 18981 }],
      versions: [{ version: 'v1', n: 8, complete: 6000 }, { version: 'v2', n: 4, complete: 5100 }],
    },
    usage: { turns: 5, calls: 14, rounds: { median: 2, p90: 4 }, versions: [{ version: 'v1', rounds: { median: 2 } }] },
    channel: { turns: 30, enough: true, total: 2, rows: [{ label: 'unparsed reply', count: 2, rate: 2 / 30 }] },
  };
  const [failures, speed, tools, rates, notices, clear] = logsHomeItems(data, { T, time });
  assert.equal(failures.detail, '3 failures since cleared · last extension at 4:12 PM', 'the newest flow');
  assert.equal(failures.colour, 'red');
  assert.equal(speed.detail, 'reply 6.0s median, p90 19.0s · 12 round trips · v1 6.0s, v2 5.1s');
  assert.equal(tools.detail, '14 calls over 5 turns · rounds median 2, p90 4', 'one version: no split');
  assert.equal(rates.detail, '2 failures in 30 turns · most: unparsed reply 6.7%');
  assert.match(notices.detail, /^4 expected states/);
  assert.deepEqual([clear.value, clear.detail], ['clear', '7 entries']);
});

test('failure rows name the flow and when it last failed', () => {
  const rows = failureItems({ byFlow: [{ flow: 'tool', count: 12, label: 'MCP tool execution', last: 'x' }] }, { T: { danger: 'red' }, time });
  assert.deepEqual(rows, [{ label: ' 12  tool', detail: 'MCP tool execution · last 4:12 PM', value: 'tool', colour: 'red' }]);
});

test('traces record the prompt version; older rows count as v1', (t) => {
  const ws = fs.mkdtempSync(join(tmpdir(), 'lv-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  logTrace(ws, { stages: { complete: 4000 } });
  logTrace(ws, { stages: { complete: 3000 }, promptVersion: 'v2' });
  logTrace(ws, { stages: { complete: 5000 }, promptVersion: 'v2' });
  logTrace(ws, { stages: { send: 400 }, promptVersion: 'v2' }); // no reply time: not counted
  assert.deepEqual(summariseTraces(ws).versions.map((v) => [v.version, v.n, v.complete]),
    [['v1', 1, 4000], ['v2', 2, 3000]]);
});

function harness(t) {
  const ws = fs.mkdtempSync(join(tmpdir(), 'lv-'));
  fs.mkdirSync(join(ws, '.agent'), { recursive: true });
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const loop = Object.create(AgentLoop.prototype);
  Object.assign(loop, { workspace: ws, modelConfig: { effort: 'high' }, conversationHistory: [] });
  const out = { menu: null, history: [] };
  const run = (q) => handleSlashCommand(q, {
    agentLoop: loop,
    setActiveMenu: (m) => { out.menu = m; },
    setHistory: (f) => out.history.push(typeof f === 'function' ? f([]) : f),
    setIsProcessing() {},
  });
  const last = () => String(out.history.at(-1)?.at(-1)?.content ?? '');
  return { ws, out, run, last };
}

test('bare /logs opens the picker even when nothing has failed', async (t) => {
  const h = harness(t);
  await h.run('/logs');
  assert.equal(h.out.menu?.type, 'logs');
  assert.equal(h.out.menu.view, 'home');
  assert.deepEqual(Object.keys(h.out.menu.data).sort(), ['channel', 'summary', 'traces', 'usage']);
  assert.equal(h.out.history.length, 0, 'nothing printed: the picker is the answer');
});

test('the picker reads what is on disk', async (t) => {
  const h = harness(t);
  logError(h.ws, { flow: 'tool', op: 'x', message: 'it broke' });
  logNotice(h.ws, { flow: 'extension', op: 'y', message: 'expected' });
  flushPending();
  logTrace(h.ws, { stages: { complete: 2500 }, promptVersion: 'v2' });
  logToolUsage(h.ws, { read_file: 2 }, { rounds: 3 });
  await h.run('/logs');
  const items = logsHomeItems(h.out.menu.data, { time });
  assert.match(items[0].detail, /^1 failure since cleared · last tool/);
  assert.match(items[1].detail, /reply 2\.5s median/);
  assert.match(items[2].detail, /2 calls over 1 turn · rounds median 3/);
  assert.match(items[4].detail, /^1 expected state/);
});

test('/logs speed prints the timings; /logs failures the summary; a wrong word says so', async (t) => {
  const h = harness(t);
  await h.run('/logs speed');
  assert.match(h.last(), /No turn timings recorded yet/);
  logTrace(h.ws, { stages: { complete: 4000 }, promptVersion: 'v1' });
  logTrace(h.ws, { stages: { complete: 3000 }, promptVersion: 'v2' });
  await h.run('/logs speed');
  assert.match(h.last(), /\*\*Browser timings\*\*/);
  assert.match(h.last(), /\*\*By prompt version\*\* — reply time\n {2}v1 .*\n {2}v2 /);
  await h.run('/logs failures');
  assert.match(h.last(), /^\*\*Failures\*\* {2}nothing has failed/);
  await h.run('/logs extension');
  assert.match(h.last(), /\*\*Failures · extension\*\*[\s\S]*Browser timings/, 'the flow still carries its timings');
  await h.run('/logs nonsense');
  assert.match(h.last(), /^No log view \*\*nonsense\*\* — the flows are bridge, extension/);
  assert.equal(h.out.menu, null, 'a typed form never opens the picker');
});
