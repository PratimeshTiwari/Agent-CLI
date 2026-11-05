import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  envLine, nameProblem, parseServerInput, planEnv, shellSplit, suggestName, tryServer,
} from '../../../../src/backend/mcp/client/add-server.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/mcp-fixture-server.js', import.meta.url));

test('shellSplit keeps quoted words and refuses an open quote', () => {
  assert.deepEqual(shellSplit(`a "b c" 'd e' f\\ g`), ['a', 'b c', 'd e', 'f g']);
  assert.deepEqual(shellSplit('a ""'), ['a', '']);
  assert.equal(shellSplit('a "b'), null);
});

test('a command line, with its env in front', () => {
  const { entry } = parseServerInput('$ TOKEN=abc npx -y @x/server-foo --dir "/a b"');
  assert.deepEqual(entry, { command: 'npx', args: ['-y', '@x/server-foo', '--dir', '/a b'], env: { TOKEN: 'abc' } });
  assert.match(parseServerInput('cat a | grep b').problem, /no pipes/);
  assert.match(parseServerInput('TOKEN=abc').problem, /no command/);
  assert.equal(parseServerInput('"/a b/server" --flag').entry.command, '/a b/server', 'a quoted path is not JSON');
});

test('every JSON shape a README uses', () => {
  const inner = '{ "command": "npx", "args": ["-y", "foo"], "env": { "K": "v" } }';
  const shapes = [
    [`{ "mcpServers": { "gh": ${inner} } }`, 'gh'],
    [`{ "servers": { "gh": ${inner} } }`, 'gh'],
    [`{ "mcp": { "servers": { "gh": ${inner} } } }`, 'gh'],
    [`{ "gh": ${inner} }`, 'gh'],
    [`"gh": ${inner},`, 'gh'],
    [inner, undefined],
    ['```json\n' + `{ "gh": ${inner} }` + '\n```', 'gh'],
  ];
  for (const [text, name] of shapes) {
    const out = parseServerInput(text);
    assert.equal(out.problem, undefined, text);
    assert.equal(out.name, name, text);
    assert.equal(out.entry.command, 'npx', text);
  }
});

test('claude mcp add', () => {
  const out = parseServerInput('claude mcp add -s user -e A=1 --transport stdio gh -- npx -y foo');
  assert.equal(out.name, 'gh');
  assert.deepEqual(out.entry, { command: 'npx', args: ['-y', 'foo'], env: { A: '1' } });
  assert.match(parseServerInput('claude mcp add --transport http x https://a.b').problem, /remote/);
});

test('what cannot be used says why, and nothing guesses', () => {
  assert.match(parseServerInput('').problem, /Paste/);
  assert.match(parseServerInput('https://mcp.example.com/sse').problem, /not supported yet/);
  assert.match(parseServerInput('{ "x": { "url": "https://a.b" } }').problem, /not supported yet/);
  assert.match(parseServerInput('{ "a": { "command": "x" }, "b": { "command": "y" } }').problem, /2 servers .*a, b/);
  assert.match(parseServerInput('{ "a": { "args": [] } }').problem, /command/);
  assert.match(parseServerInput('{ "a": { "command": "x", "args": "y" } }').problem, /args/);
  assert.match(parseServerInput('{ bad').problem, /not valid JSON/);
  assert.match(parseServerInput('a "b').problem, /quote/);
});

test('an env key that is not a name stops at the door: it would reach the Keychain command line', () => {
  const evil = JSON.stringify({ a: { command: 'x', env: { 'K" -w "x\ndelete-keychain': 'v' } } });
  assert.match(parseServerInput(evil).problem, /not an environment variable name/);
});

test('suggestName', () => {
  const name = (command, ...args) => suggestName({ command, args });
  assert.equal(name('npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp'), 'filesystem');
  assert.equal(name('npx', '-y', 'mcp-server-foo@1.2'), 'foo');
  assert.equal(name('npx', '@scope/foo-mcp'), 'foo');
  assert.equal(name('docker', 'run', '-i', '--rm', 'ghcr.io/github/github-mcp-server'), 'github');
  assert.equal(name('uvx', 'mcp-server-git'), 'git');
  assert.equal(name('/usr/local/bin/node', '/a/b/mcp-fixture-server.js', 'ok'), 'fixture', 'a runner named by its path');
  assert.equal(name('python', '-m', 'mcp_server_time'), 'time');
  assert.equal(suggestName({ command: 'foo' }, ['foo', 'foo-2']), 'foo-3');
  assert.equal(nameProblem(suggestName({ command: '/a/b c!.js' })), null, 'always a legal name');
});

test('nameProblem', () => {
  assert.match(nameProblem('a b'), /Letters/);
  assert.match(nameProblem('a', ['a']), /already/);
  assert.equal(nameProblem('a-b_1'), null);
});

test('planEnv asks for what is missing, and hides what looks secret', () => {
  const entry = { env: {
    GITHUB_TOKEN: '<YOUR_TOKEN>', API_KEY: '', REGION: 'your-region', SET: '${HAS}', UNSET: '${NOPE}', PLAIN: 'x', SECRET_PASS: 'real',
  } };
  const { ask, keep } = planEnv(entry, { HAS: '1' });
  assert.deepEqual(ask, [
    { key: 'GITHUB_TOKEN', hidden: true },
    { key: 'API_KEY', hidden: true },
    { key: 'REGION', hidden: false },
    { key: 'UNSET', hidden: false },
  ]);
  assert.deepEqual(keep, ['SECRET_PASS'], 'a real value pasted in is not asked again');
});

test('envLine shows where a value comes from, and never a secret', () => {
  const line = envLine({ env: { A_TOKEN: 'sekret', B: '${AWS_SECRET_ACCESS_KEY}', C: 'plain' } }, { D: 'typed-value' });
  assert.equal(line, 'A_TOKEN B=${AWS_SECRET_ACCESS_KEY} C=plain D');
  assert.ok(!line.includes('sekret') && !line.includes('typed-value'));
});

test('tryServer starts a real process, lists its tools, and stops it', async () => {
  const { connection, result } = tryServer('t', { command: process.execPath, args: [FIXTURE, 'ok'] }, {});
  const out = await result;
  assert.equal(out.ok, true, out.error);
  assert.ok(out.tools.some((t) => t.name === 'echo'));
  assert.equal(connection.pid ?? null, null, 'nothing left running');
});

test('tryServer reports a failure with the typed value taken out', async () => {
  const { result } = tryServer('t', { command: process.execPath, args: ['-e', 'console.error(process.env.TOKEN); process.exit(1)'] }, { TOKEN: 'hunter2-value' });
  const out = await result;
  assert.equal(out.ok, false);
  assert.ok(!out.error.includes('hunter2-value'), out.error);
  assert.equal(out.error, '[hidden]', 'control: the line that said it did come back');
});

test('a command that does not exist is an answer, not a throw', async () => {
  const out = await tryServer('t', { command: 'no-such-command-here-x' }, {}).result;
  assert.equal(out.ok, false);
  assert.ok(out.error);
});
