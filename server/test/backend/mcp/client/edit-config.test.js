import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeServer, saveServer, setServerDisabled } from '../../../../src/backend/mcp/client/edit-config.js';
import { loadMcpConfig } from '../../../../src/backend/mcp/client/config.js';
import { readSecret, removeSecret, secretKey, secretRef, storeSecret } from '../../../../src/backend/mcp/client/secrets.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'mcp-edit-')), 'mcp.json');
const raw = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('a secret goes to the store and the file only names it', () => {
  const path = file();
  saveServer('gh', { command: 'npx', args: ['a'], env: { REGION: 'eu' } }, { API_TOKEN: 'real-value-1' }, { path });
  const text = readFileSync(path, 'utf8');
  assert.ok(!text.includes('real-value-1'), 'never in mcp.json');
  assert.equal(raw(path).mcpServers.gh.env.API_TOKEN, secretRef('gh', 'API_TOKEN'));
  assert.equal(raw(path).mcpServers.gh.env.REGION, 'eu', 'control: an ordinary value stays where it can be read');
  assert.equal(readSecret(secretKey('gh', 'API_TOKEN')), 'real-value-1');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const server = loadMcpConfig({ path }).servers[0];
  assert.equal(server.env.API_TOKEN, 'real-value-1', 'and it reaches the process');
  assert.equal(server.problem, undefined);
});

test('a value pasted in the JSON moves too, and a reference stays one', () => {
  const path = file();
  saveServer('p', { command: 'x', env: { API_KEY: 'pasted-value', OTHER_KEY: '${FROM_SHELL}' } }, {}, { path });
  assert.ok(!readFileSync(path, 'utf8').includes('pasted-value'));
  assert.equal(raw(path).mcpServers.p.env.OTHER_KEY, '${FROM_SHELL}');
});

test("another server's secret cannot be named: a pasted config must not be handed it", () => {
  storeSecret('victim/TOKEN', 'stolen-value');
  const path = file();
  writeFileSync(path, JSON.stringify({ mcpServers: {
    evil: { command: 'x', env: { X: '${secret:victim/TOKEN}' } },
    victim: { command: 'y', env: { TOKEN: '${secret:victim/TOKEN}' } },
  } }));
  const [evil, victim] = loadMcpConfig({ path }).servers;
  assert.match(evil.problem, /victim\/TOKEN/);
  assert.ok(!JSON.stringify(evil).includes('stolen-value'));
  assert.equal(victim.env.TOKEN, 'stolen-value', 'control: its own still reads');
  removeSecret('victim/TOKEN');
});

test('a missing secret is a problem named on the row', () => {
  const path = file();
  writeFileSync(path, JSON.stringify({ mcpServers: { a: { command: 'x', env: { T: '${secret:a/T}' } } } }));
  assert.match(loadMcpConfig({ path }).servers[0].problem, /a\/T/);
});

test('a key that is not a server and a name is refused before anything is written', () => {
  assert.throws(() => storeSecret('a" -w "x', 'v'), /not a name/);
  assert.throws(() => storeSecret('a/b\nc', 'v'), /not a name/);
});

test("keys this does not know are kept, and a server's others too", () => {
  const path = file();
  writeFileSync(path, JSON.stringify({ note: 'mine', mcpServers: { old: { command: 'y', custom: 1 } } }));
  saveServer('new', { command: 'x' }, {}, { path });
  assert.equal(raw(path).note, 'mine');
  assert.deepEqual(raw(path).mcpServers.old, { command: 'y', custom: 1 });
  assert.deepEqual(raw(path).mcpServers.new, { command: 'x', args: [] });
});

test('a broken file is refused, not replaced, and no secret is stored for it', () => {
  const path = file();
  writeFileSync(path, '{ not json');
  assert.throws(() => saveServer('b', { command: 'x', env: { A_TOKEN: 'v1' } }, {}, { path }), /nothing was changed/);
  assert.equal(readFileSync(path, 'utf8'), '{ not json');
  assert.equal(readSecret('b/A_TOKEN'), '', 'stored only once the file can take it');
  assert.throws(() => removeServer('b', { path }), /nothing was changed/);
  assert.throws(() => setServerDisabled('b', true, { path }), /nothing was changed/);
});

test('turning off and on', () => {
  const path = file();
  saveServer('a', { command: 'x' }, {}, { path });
  setServerDisabled('a', true, { path });
  assert.equal(loadMcpConfig({ path }).servers[0].disabled, true);
  setServerDisabled('a', false, { path });
  assert.equal(raw(path).mcpServers.a.disabled, undefined);
  assert.throws(() => setServerDisabled('zz', true, { path }), /no server called zz/);
});

test('remove takes the secrets with it, and only its own', () => {
  const path = file();
  saveServer('a', { command: 'x' }, { A_TOKEN: 'one' }, { path });
  saveServer('b', { command: 'x' }, { A_TOKEN: 'two' }, { path });
  removeServer('a', { path });
  assert.equal(raw(path).mcpServers.a, undefined);
  assert.equal(readSecret('a/A_TOKEN'), '');
  assert.equal(readSecret('b/A_TOKEN'), 'two');
});

test('the suite never touches the login Keychain', () => {
  assert.ok(process.env.AGENT_MCP_NO_KEYCHAIN, 'set by test/setup-home.js');
});
