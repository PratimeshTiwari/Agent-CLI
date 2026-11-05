/** The set of servers: lazy, cached by config, and gone when we are (v9.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { McpServers } from '../../../../src/backend/mcp/client/servers.js';
import { McpConnection } from '../../../../src/backend/mcp/client/connection.js';
import { loadMcpConfig } from '../../../../src/backend/mcp/client/config.js';
import { listIntegrations, mcpReport, statusLine } from '../../../../src/backend/mcp/client/integrations.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '../../../fixtures/mcp-fixture-server.js');

function rig(table, t, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-servers-'));
  const path = join(dir, 'mcp.json');
  const write = (next) => writeFileSync(path, JSON.stringify({ mcpServers: next }));
  write(table);
  const started = [];
  const mcp = new McpServers({
    workspace: dir,
    load: () => loadMcpConfig({ path, env: {} }),
    cachePath: join(dir, 'cache.json'),
    connection: (server, o) => { started.push(server.name); return new McpConnection(server, o); },
    ...opts,
  });
  t.after(() => mcp.dispose());
  return { mcp, started, write, dir };
}

const fixture = (mode) => ({ command: process.execPath, args: [FIXTURE, mode] });

test('nothing starts until something asks', (t) => {
  const { mcp, started } = rig({ a: fixture('ok') }, t);
  assert.deepEqual(started, []);
  assert.equal(mcp.snapshot().servers[0].state, 'idle');
});

test('asked, it connects and lists; twice is one process', async (t) => {
  const { mcp, started } = rig({ a: fixture('ok') }, t);
  const states = [];
  mcp.onChange(() => states.push(mcp.snapshot().servers[0].state));
  await Promise.all([mcp.connect('a'), mcp.connect('a')]);
  await mcp.connect('a');
  assert.deepEqual(started, ['a']);
  assert.deepEqual(states, ['connecting', 'ready'], 'an open menu redraws on each');
  assert.deepEqual(mcp.snapshot().servers[0].tools.map((x) => x.name), ['echo', 'add']);
});

test('one failure does not hold up the others, and is a row', async (t) => {
  const { mcp } = rig({ bad: fixture('crash'), good: fixture('ok') }, t);
  await mcp.connectAll();
  const [bad, good] = mcp.snapshot().servers;
  assert.equal(bad.state, 'failed');
  assert.match(bad.error, /bad token/);
  assert.equal(good.state, 'ready');
});

test('an invalid or disabled entry is never started', async (t) => {
  const { mcp, started } = rig({ off: { ...fixture('ok'), disabled: true }, nocmd: {} }, t);
  await mcp.connectAll();
  assert.deepEqual(started, []);
  assert.deepEqual(mcp.snapshot().servers.map((s) => s.state), ['disabled', 'invalid']);
});

test('a server that stops later says so', async (t) => {
  const { mcp } = rig({ a: fixture('dies-after-list') }, t);
  await mcp.connect('a');
  await new Promise((r) => setTimeout(r, 400));
  const [a] = mcp.snapshot().servers;
  assert.equal(a.state, 'failed');
  assert.match(a.error, /stopped/);
});

test('the cache shows the last tools, only for the same config', async (t) => {
  const { mcp, write, dir } = rig({ a: fixture('ok') }, t);
  await mcp.connect('a');
  await mcp.closeAll();
  assert.equal(existsSync(join(dir, 'cache.json')), true);
  const after = mcp.snapshot().servers[0];
  assert.equal(after.state, 'idle');
  assert.deepEqual(after.tools.map((x) => x.name), ['echo', 'add']);
  assert.equal(after.toolsStale, true);

  write({ a: { ...fixture('ok'), args: [FIXTURE, 'ok', 'changed'] } });
  mcp.config = mcp.load();
  assert.deepEqual(mcp.snapshot().servers[0].tools, [], 'an edited entry must not show the old tools');
});

test('the cache file holds no env', async (t) => {
  const { mcp, dir } = rig({ a: { ...fixture('ok'), env: { OTHER: 'sekrit-value' } } }, t);
  await mcp.connect('a');
  assert.doesNotMatch(readFileSync(join(dir, 'cache.json'), 'utf8'), /sekrit-value/);
  assert.doesNotMatch(JSON.stringify(mcp.snapshot()), /sekrit-value/, 'nor does what a screen reads');
});

test('reload reads the file again', async (t) => {
  const { mcp, write } = rig({ a: fixture('ok') }, t);
  await mcp.connect('a');
  write({ b: fixture('pages') });
  await mcp.reload();
  assert.deepEqual(mcp.snapshot().servers.map((s) => [s.name, s.state]), [['b', 'ready']]);
});

test('children die with the agent, however it leaves', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-exit-'));
  const pidfile = join(dir, 'pid');
  const config = join(dir, 'mcp.json');
  writeFileSync(config, JSON.stringify({ mcpServers: { a: { command: process.execPath, args: [FIXTURE, 'hang-free', pidfile] } } }));
  const url = (p) => pathToFileURL(join(here, '../../../../src/backend/mcp/client', p)).href;
  const script = join(dir, 'run.mjs');
  writeFileSync(script, `
    import { McpServers } from ${JSON.stringify(url('servers.js'))};
    import { loadMcpConfig } from ${JSON.stringify(url('config.js'))};
    const mcp = new McpServers({ load: () => loadMcpConfig({ path: ${JSON.stringify(config)}, env: {} }), cachePath: ${JSON.stringify(join(dir, 'c.json'))} });
    await mcp.connect('a');
    process.exit(0);
  `);
  await promisify(execFile)(process.execPath, [script]);
  const pid = Number(readFileSync(pidfile, 'utf8'));
  assert.ok(pid > 0, 'control: the child started');
  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'still running after the agent left');
});

test('one list: custom servers and Jira', async (t) => {
  const { mcp } = rig({ a: fixture('ok') }, t);
  await mcp.connect('a');
  const list = listIntegrations(mcp);
  assert.deepEqual(list.rows.map((r) => r.name), ['a', 'jira']);
  assert.equal(statusLine(list.rows[0]), 'connected · 2 tools');
  assert.match(statusLine(list.rows[1]), /built in/);
  assert.match(mcpReport(list), /- a · connected · 2 tools/);
});
