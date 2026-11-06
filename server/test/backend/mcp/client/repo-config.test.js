/**
 * A repo's `.mcp.json` and HTTP servers (v9.6). The repo half is a boundary: a
 * cloned folder decides what is in that file, so each test here is a thing it
 * must not be able to do, with a control showing the allowed path still works.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadServers, readServer, scrub, secretsOf, urlProblem } from '../../../../src/backend/mcp/client/config.js';
import { allowRepoServer, allowedFingerprint, forgetRepoServer } from '../../../../src/backend/mcp/client/repo-approval.js';
import { McpConnection } from '../../../../src/backend/mcp/client/connection.js';
import { McpServers } from '../../../../src/backend/mcp/client/servers.js';
import { setSwitch, switchFor } from '../../../../src/backend/mcp/client/switches.js';
import { mcpDescribe, mcpTool } from '../../../../src/backend/mcp/tools/mcp-tool.js';
import { startHttpFixture } from '../../../fixtures/mcp-http-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '../../../fixtures/mcp-fixture-server.js');

function repo(table, { mine = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-repo-'));
  const path = join(dir, 'mine.json');
  writeFileSync(path, JSON.stringify({ mcpServers: mine }));
  const write = (next) => writeFileSync(join(dir, '.mcp.json'), typeof next === 'string' ? next : JSON.stringify({ mcpServers: next }));
  if (table !== null) write(table);
  return { dir, path, write, load: (o = {}) => loadServers({ workspace: dir, path, env: {}, ...o }) };
}

function rig(r, t) {
  const started = [];
  const mcp = new McpServers({
    workspace: r.dir,
    load: () => r.load(),
    cachePath: join(r.dir, 'cache.json'),
    connection: (server, o) => { started.push(server.name); return new McpConnection(server, o); },
  });
  t.after(() => mcp.dispose());
  return { mcp, started };
}

const real = { command: process.execPath, args: [FIXTURE, 'calls'] };

test('a repo\'s server arrives unapproved, and nothing can start it', async (t) => {
  const r = repo({ evil: real });
  const { mcp, started } = rig(r, t);
  assert.equal(mcp.snapshot().servers[0].state, 'unapproved');
  assert.equal(mcp.usable('evil'), false);
  assert.equal(await mcp.connect('evil'), false);
  await mcp.connectAll();
  await mcp.reload();
  assert.deepEqual(mcp.offered(), [], 'the prompt never names it');
  await assert.rejects(mcpDescribe({ server: 'evil' }, { mcp }), /No MCP server named/);
  await assert.rejects(mcpTool({ server: 'evil', tool: 'echo' }, { mcp, mode: 'auto' }), /No MCP server named/);
  assert.deepEqual(started, [], 'no path reached a process');
});

test('allowed, it runs; an edit stops it and says so; forgetting asks again', async (t) => {
  const r = repo({ s: real });
  const { mcp, started } = rig(r, t);
  assert.equal(await mcp.allow('s'), true, 'control: the allowed path works');
  assert.equal(await mcp.connect('s'), true);
  assert.deepEqual(started, ['s']);

  r.write({ s: { ...real, env: { NODE_OPTIONS: '--require ./x.js' } } });
  await mcp.configChanged();
  const row = mcp.snapshot().servers[0];
  assert.equal(row.state, 'unapproved', 'an env change is a different thing to have agreed to');
  assert.equal(row.changed, true);
  assert.equal(await mcp.connect('s'), false);

  assert.equal(await mcp.allow('s'), true);
  await mcp.forget('s');
  assert.equal(mcp.usable('s'), false);
  assert.equal(mcp.snapshot().servers[0].changed, false);
});

test('an approval is for this folder, and in the person\'s settings', () => {
  const a = repo({ s: real });
  const b = repo({ s: real });
  const found = a.load().servers[0];
  allowRepoServer(a.dir, 's', found.fingerprint);
  assert.equal(a.load().servers[0].unapproved, false, 'control');
  assert.equal(b.load().servers[0].unapproved, true, 'the same text in another clone is another program');
  forgetRepoServer(a.dir, 's');
  assert.equal(allowedFingerprint(a.dir, 's'), null);
});

test('a repo cannot read a saved secret, even under the name that owns it', () => {
  const r = repo({ github: { command: 'x', env: { TOKEN: '${secret:github/TOKEN}' } } });
  let asked = false;
  const [server] = r.load({ secret: () => { asked = true; return 'the-real-token'; } }).servers;
  assert.match(server.problem, /cannot use saved secrets/);
  assert.equal(asked, false);
  assert.equal(readServer('github', { command: 'x', env: { T: '${secret:github/T}' } }, {}, () => 'v').env.T, 'v', 'control: your own file can');
});

test('on a shared name yours is used and the other is named', () => {
  const r = repo({ github: { command: 'evil' }, other: { command: 'x' } }, { mine: { github: { command: 'good' } } });
  const config = r.load();
  assert.deepEqual(config.servers.map((s) => [s.name, s.source, s.command]), [['github', 'user', 'good'], ['other', 'repo', 'x']]);
  assert.deepEqual(config.repo.shadowed, ['github']);
});

test('a switch you set for a name does not reach a repo\'s server of that name', (t) => {
  const r = repo({ tools: real });
  const { mcp } = rig(r, t);
  setSwitch('tools', 'echo', 'auto');
  assert.equal(switchFor(mcp.switchKey('tools'), 'echo'), 'ask');
  r.write({ tools: { ...real, args: [...real.args, 'x'] } });
  const before = mcp.switchKey('tools');
  mcp.config = r.load();
  assert.notEqual(mcp.switchKey('tools'), before, 'an edit does not keep what the old entry earned');
  assert.equal(new McpServers({ workspace: r.dir, load: () => ({ servers: [{ name: 'a' }] }), cachePath: join(r.dir, 'c') }).switchKey('a'), 'a', 'control: your own server keeps its name');
});

test('the question shows the entry as written, with no value expanded', (t) => {
  const r = repo({ s: { command: 'run', args: ['--go'], env: { A_TOKEN: '${HOME_SECRET}', B_TOKEN: 'literal-in-repo', C: 'plain' } } });
  r.load = () => loadServers({ workspace: r.dir, path: r.path, env: { HOME_SECRET: 'sekret-value' } });
  const { mcp } = rig(r, t);
  const text = JSON.stringify(mcp.snapshot());
  assert.ok(!text.includes('sekret-value'));
  const { review } = mcp.snapshot().servers[0];
  assert.equal(review.target, 'run --go');
  assert.match(review.values, /A_TOKEN=\$\{HOME_SECRET\}/, 'where it reads from is the point of asking');
  assert.ok(!review.values.includes('literal-in-repo'));
  assert.match(review.values, /C=plain/);
});

test('a broken .mcp.json costs its own row and none of yours', () => {
  const r = repo('{ nope', { mine: { ok: { command: 'x' } } });
  const config = r.load();
  assert.deepEqual(config.servers.map((s) => s.name), ['ok']);
  assert.match(config.repo.error, /not valid JSON/);
  assert.equal(repo(null).load().repo.exists, false);
});

test('no workspace reads only your file, wherever the process is', (t) => {
  const r = repo({ s: real });
  const was = process.cwd();
  t.after(() => process.chdir(was));
  process.chdir(r.dir);
  const config = loadServers({ path: r.path, env: {} });
  assert.deepEqual(config.servers, []);
  assert.equal(config.repo, null);
});

test('allow is for a repo\'s server, never one of your own', async (t) => {
  const r = repo(null, { mine: { m: { command: 'x' } } });
  const { mcp } = rig(r, t);
  assert.equal(await mcp.allow('m'), false);
  assert.equal(await mcp.forget('m'), false);
  assert.equal(allowedFingerprint(r.dir, 'm'), null, 'nothing was written');
});

test('a failed call is scrubbed before anything reads it', async (t) => {
  const r = repo(null);
  const server = readServer('h', { url: 'https://a.b/m?key=query-secret' }, {});
  const mcp = new McpServers({
    workspace: r.dir,
    load: () => ({ servers: [server] }),
    cachePath: join(r.dir, 'cache.json'),
    connection: () => ({
      connect: async () => {},
      listTools: async () => [],
      close: async () => {},
      callTool: async () => { throw new Error('POST https://a.b/m?key=query-secret failed'); },
    }),
  });
  t.after(() => mcp.dispose());
  await assert.rejects(mcp.call('h', 't', {}), (err) => !err.message.includes('query-secret') && err.message.includes('[hidden]'));
});

test('an address must be safe to send a token to', () => {
  assert.equal(urlProblem('https://mcp.example.com/mcp'), null);
  assert.equal(urlProblem('http://localhost:3000/mcp'), null);
  assert.equal(urlProblem('http://127.0.0.1:3000/mcp'), null);
  assert.equal(urlProblem('http://[::1]:3000/mcp'), null);
  assert.match(urlProblem('http://mcp.example.com/mcp'), /only for this machine/);
  assert.match(urlProblem('http://localhost.evil.com/mcp'), /only for this machine/);
  assert.match(urlProblem('https://u:p@example.com/'), /credentials/);
  assert.match(urlProblem('ftp://example.com/'), /https/);
  assert.match(urlProblem('nope'), /not a URL/);
});

test('an http entry reads its url and headers, and says why when it cannot', () => {
  const ok = readServer('x', { type: 'http', url: 'https://${H}/mcp', headers: { Authorization: 'Bearer ${T}' } }, { H: 'a.example', T: 'tok-1234' });
  assert.equal(ok.problem, undefined);
  assert.equal(ok.url, 'https://a.example/mcp');
  assert.equal(ok.headers.Authorization, 'Bearer tok-1234');
  assert.equal(ok.host, 'a.example');
  const problem = (raw) => readServer('x', raw, {}).problem;
  assert.match(problem({ type: 'http' }), /no `url`/);
  assert.match(problem({ url: 'https://a.b', headers: [] }), /must be an object/);
  assert.match(problem({ url: 'https://a.b', headers: { 'a b': 'c' } }), /not a name/);
  assert.match(problem({ url: 'https://a.b', headers: { A: 'Bearer ${NOPE}' } }), /NOPE is not set/);
  assert.match(problem({ type: 'sse', url: 'https://a.b' }), /SSE/);
  assert.match(problem({ url: 'http://a.b/' }), /only for this machine/);
});

test('scrub takes a header\'s token, whole or alone, and a query value', () => {
  const server = { headers: { Authorization: 'Bearer tok-12345' }, url: 'https://a.b/m?key=query-secret' };
  assert.deepEqual(scrub('got Bearer tok-12345 and tok-12345 and query-secret', server), 'got [hidden] and [hidden] and [hidden]');
  assert.ok(!secretsOf(server).some((s) => /^bearer$/i.test(s)), 'the word itself is not a secret');
  assert.equal(expand('a', {}, new Set()), 'a');
});

const httpServer = (url, headers = {}) => readServer('remote', { type: 'http', url, headers }, {});

test('http: a real handshake, the header on every request, and a call', async (t) => {
  const f = await startHttpFixture();
  t.after(() => f.close());
  const c = new McpConnection(httpServer(f.url, { 'X-Api-Key': 'abcd-1234' }));
  t.after(() => c.close());
  await c.connect();
  assert.equal(c.pid, null, 'no child');
  assert.deepEqual((await c.listTools()).map((x) => x.name), ['echo']);
  const r = await c.callTool('echo', { q: 'hi' });
  assert.equal(r.content[0].text, 'echo:hi');
  assert.ok(f.seen.filter((s) => s.method === 'POST').every((s) => s.headers['x-api-key'] === 'abcd-1234'));
});

test('http: a redirect within the address still works', async (t) => {
  const f = await startHttpFixture({ movedFrom: '/old' });
  t.after(() => f.close());
  const c = new McpConnection(httpServer(f.url.replace('/mcp', '/old')), { timeoutMs: 5000 });
  t.after(() => c.close());
  await c.connect();
  assert.deepEqual((await c.listTools()).map((x) => x.name), ['echo']);
});

test('http: a redirect to another origin is refused, so a header never follows it', async (t) => {
  const elsewhere = await startHttpFixture();
  const f = await startHttpFixture({ redirectTo: elsewhere.url });
  t.after(async () => { await f.close(); await elsewhere.close(); });
  const c = new McpConnection(httpServer(f.url, { 'X-Api-Key': 'abcd-1234' }), { timeoutMs: 5000 });
  await assert.rejects(c.connect());
  assert.ok(f.seen.length > 0, 'control: it was tried');
  assert.equal(elsewhere.seen.length, 0, 'nothing reached the other address');
});

test('http: 401 says what to do, and a failure never quotes a token', async (t) => {
  const f = await startHttpFixture({ status: 401 });
  t.after(() => f.close());
  const c = new McpConnection(httpServer(`${f.url}?key=query-secret`), { timeoutMs: 5000 });
  await assert.rejects(c.connect(), /wants a sign-in/);
  const down = new McpConnection(httpServer('http://127.0.0.1:9/mcp?key=query-secret'), { timeoutMs: 5000 });
  await assert.rejects(down.connect(), (err) => !err.message.includes('query-secret'));
});

test('http: a forgotten session fails that call and the next one starts fresh, never repeating it', async (t) => {
  const f = await startHttpFixture();
  t.after(() => f.close());
  const r = repo(null, { mine: { remote: { type: 'http', url: f.url } } });
  const { mcp } = rig(r, t);
  assert.equal(await mcp.connect('remote'), true);
  f.forgetSessions();
  const calls = () => f.seen.filter((s) => s.method === 'POST').length;
  const before = calls();
  await assert.rejects(mcp.call('remote', 'echo', {}));
  assert.equal(calls(), before + 1, 'the call was not repeated');
  assert.equal(mcp.snapshot().servers[0].state, 'failed');
  assert.equal((await mcp.call('remote', 'echo', { q: 'again' })).content[0].text, 'echo:again');
});

test('a stdio failure is not treated as a lost session', () => {
  const c = new McpConnection({ name: 'x', transport: 'stdio' });
  assert.equal(c.isGone(new TypeError('x')), false);
  assert.equal(new McpConnection({ name: 'x', transport: 'http' }).isGone(new TypeError('x')), true);
  assert.equal(new McpConnection({ name: 'x', transport: 'http' }).isGone(new Error('tool said no')), false);
});
