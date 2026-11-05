/** `~/.agent/mcp.json`: read, checked, and never a failed launch (v9.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMcpConfig, expand, scrub, secretsOf } from '../../../../src/backend/mcp/client/config.js';

function file(body) {
  const path = join(mkdtempSync(join(tmpdir(), 'mcp-config-')), 'mcp.json');
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  return path;
}

test('no file is no servers, and says so', () => {
  const c = loadMcpConfig({ path: join(tmpdir(), 'nothing-here', 'mcp.json') });
  assert.deepEqual([c.exists, c.error, c.servers], [false, null, []]);
});

test("Claude Code's shape reads as it is", () => {
  const { servers } = loadMcpConfig({
    path: file({ mcpServers: { files: { command: 'npx', args: ['-y', 'pkg'], env: { A: 'b' } } } }),
    env: {},
  });
  assert.deepEqual(
    [servers[0].name, servers[0].transport, servers[0].command, servers[0].args, servers[0].env],
    ['files', 'stdio', 'npx', ['-y', 'pkg'], { A: 'b' }],
  );
});

test('a file that cannot be read costs a row, never a throw', () => {
  assert.match(loadMcpConfig({ path: file('{ nope') }).error, /not valid JSON/);
  assert.match(loadMcpConfig({ path: file({}) }).error, /no `mcpServers`/);
  assert.match(loadMcpConfig({ path: file({ mcpServers: [] }) }).error, /must be an object/);
});

test('one bad entry does not cost the good one', () => {
  const { servers } = loadMcpConfig({
    path: file({ mcpServers: {
      good: { command: 'x' },
      nocmd: {},
      'bad name': { command: 'x' },
      args: { command: 'x', args: 'not-a-list' },
      env: { command: 'x', env: [] },
      hosted: { url: 'https://example.com/mcp' },
    } }),
    env: {},
  });
  const byName = Object.fromEntries(servers.map((s) => [s.name, s.problem]));
  assert.equal(byName.good, undefined);
  assert.match(byName.nocmd, /no `command`/);
  assert.match(byName['bad name'], /letters, digits/);
  assert.match(byName.args, /list of strings/);
  assert.match(byName.env, /must be an object/);
  assert.match(byName.hosted, /HTTP servers are not supported/);
});

test('${VAR} and ${VAR:-default} come from the environment', () => {
  const missing = new Set();
  assert.equal(expand('a-${X}-${Y:-fallback}-${Z}', { X: '1' }, missing), 'a-1-fallback-');
  assert.deepEqual([...missing], ['Z']);
});

test('an unset variable names the variable, and the server does not start', () => {
  const { servers } = loadMcpConfig({
    path: file({ mcpServers: { s: { command: 'x', env: { TOKEN: '${MY_TOKEN}' } } } }),
    env: {},
  });
  assert.equal(servers[0].problem, 'MY_TOKEN is not set');
  assert.equal(servers[0].command, undefined, 'nothing to start');
});

test('the fingerprint moves with the config and holds no expanded value', () => {
  const config = (cmd) => ({ mcpServers: { s: { command: cmd, env: { T: '${SECRET_ONE}' } } } });
  const a = loadMcpConfig({ path: file(config('x')), env: { SECRET_ONE: 'sekrit-value' } }).servers[0];
  const b = loadMcpConfig({ path: file(config('x')), env: { SECRET_ONE: 'other-value' } }).servers[0];
  const c = loadMcpConfig({ path: file(config('y')), env: { SECRET_ONE: 'sekrit-value' } }).servers[0];
  assert.equal(a.fingerprint, b.fingerprint, 'a rotated token is not a changed config');
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test('scrub takes a server\'s env values out of text', () => {
  const server = { env: { TOKEN: 'sekrit-value', SHORT: 'ab' } };
  assert.equal(scrub('failed with sekrit-value here', server), 'failed with [hidden] here');
  assert.deepEqual(secretsOf(server), ['sekrit-value'], 'a two-letter value would shred ordinary text');
});
