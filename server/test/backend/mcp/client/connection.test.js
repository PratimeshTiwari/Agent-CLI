/**
 * The client against a real process (v9.0). A stub of the protocol can lie the
 * way the harness has; the fixture is a server the SDK really talks to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { McpConnection, McpSdkMissing } from '../../../../src/backend/mcp/client/connection.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '../../../fixtures/mcp-fixture-server.js');
const server = (mode, extra = {}) => ({
  name: 'fixture', command: process.execPath, args: [FIXTURE, mode], env: {}, transport: 'stdio', ...extra,
});

test('a real server: handshake, then its tools', async (t) => {
  const c = new McpConnection(server('ok'));
  t.after(() => c.close());
  await c.connect();
  assert.ok(c.pid > 0, 'control: there is a child process');
  const tools = await c.listTools();
  assert.deepEqual(tools.map((x) => x.name), ['echo', 'add']);
  assert.equal(tools[0].inputSchema.type, 'object');
});

test('tools across pages', async (t) => {
  const c = new McpConnection(server('pages'));
  t.after(() => c.close());
  await c.connect();
  assert.deepEqual((await c.listTools()).map((x) => x.name), ['one', 'two']);
});

test('a server that dies says why, with its token hidden', async () => {
  const c = new McpConnection(server('crash', { env: { FIXTURE_TOKEN: 'sekrit-value' } }));
  await assert.rejects(c.connect(), (err) => {
    assert.match(err.message, /^cannot start: bad token/, 'first, because a row is cut from the right');
    assert.doesNotMatch(err.message, /sekrit-value/);
    return true;
  });
});

test('a command that does not exist says so', async () => {
  const c = new McpConnection({ ...server('ok'), command: '/nonexistent/server', args: [] });
  await assert.rejects(c.connect(), /ENOENT|nonexistent/);
});

test('a server that never answers is given up on, and stopped', async () => {
  const pidfile = join(mkdtempSync(join(tmpdir(), 'mcp-hang-')), 'pid');
  const c = new McpConnection(server('hang', { args: [FIXTURE, 'hang', pidfile] }), { timeoutMs: 400 });
  await assert.rejects(c.connect(), /starting took more than/);
  const pid = Number(readFileSync(pidfile, 'utf8'));
  assert.ok(pid > 0, 'control: it really was running');
  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'left running');
});

test('a tool description cannot carry a token back out', async (t) => {
  const c = new McpConnection(server('ok', { env: { FIXTURE_TOKEN: 'sekrit-value' } }));
  t.after(() => c.close());
  await c.connect();
  const [echo] = await c.listTools();
  assert.equal(echo.description, 'uses [hidden]');
});

test('without the SDK, the failure names the package', async () => {
  const c = new McpConnection(server('ok'), {
    sdk: async () => { throw new McpSdkMissing('@modelcontextprotocol/sdk is not installed'); },
  });
  await assert.rejects(c.connect(), McpSdkMissing);
});

test('a server\'s stderr never reaches ours, which is Ink\'s terminal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-stderr-'));
  const script = join(dir, 'run.mjs');
  const url = pathToFileURL(join(here, '../../../../src/backend/mcp/client/connection.js')).href;
  writeFileSync(script, `
    import { McpConnection } from ${JSON.stringify(url)};
    const c = new McpConnection({ command: process.execPath, args: [${JSON.stringify(FIXTURE)}, 'noisy'], env: {} });
    await c.connect();
    await new Promise((r) => setTimeout(r, 200));
    process.stdout.write(c.stderrTail.includes('banner') ? 'kept' : 'lost');
    await c.close();
  `);
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [script]);
  assert.equal(stdout, 'kept', 'control: the server did print, and it was kept');
  assert.equal(stderr, '');
});
