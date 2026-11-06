import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  envLine, headerValue, nameProblem, parseServerInput, planEnv, shellSplit, suggestName, tryServer, valuesLine, withValues,
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
  const remote = parseServerInput('claude mcp add --transport http -H "X-Api-Key: abc" -s user x https://a.b/mcp');
  assert.equal(remote.name, 'x');
  assert.equal(remote.problem, undefined);
  assert.deepEqual(remote.entry, { type: 'http', url: 'https://a.b/mcp', headers: { 'X-Api-Key': 'abc' } });
  assert.match(parseServerInput('claude mcp add --transport sse x https://a.b').problem, /SSE/);
  assert.match(parseServerInput('claude mcp add --transport http x').problem, /no address/);
  assert.match(parseServerInput('claude mcp add --transport http x http://a.b').problem, /only for this machine/);
});

test('what cannot be used says why, and nothing guesses', () => {
  assert.match(parseServerInput('').problem, /Paste/);
  assert.match(parseServerInput('http://mcp.example.com/mcp').problem, /only for this machine/);
  assert.match(parseServerInput('{ "x": { "type": "sse", "url": "https://a.b" } }').problem, /SSE/);
  assert.match(parseServerInput('{ "x": { "url": "https://a.b", "headers": [] } }').problem, /headers/);
  assert.match(parseServerInput('{ "x": { "url": "https://a.b", "headers": { "a b": "c" } } }').problem, /header name/);
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

test('an address, bare or in JSON, is a server', () => {
  assert.deepEqual(parseServerInput('https://mcp.example.com/mcp').entry, { type: 'http', url: 'https://mcp.example.com/mcp' });
  assert.equal(parseServerInput('https://mcp.example.com/mcp').problem, undefined);
  const out = parseServerInput('{ "x": { "url": "https://a.b/mcp", "headers": { "Authorization": "Bearer ${T}" } } }');
  assert.equal(out.problem, undefined);
  assert.equal(out.name, 'x');
  assert.equal(suggestName({ url: 'https://mcp.linear.app/mcp' }), 'linear');
  assert.equal(suggestName({ url: 'http://localhost:3000/mcp' }), 'localhost');
  assert.equal(suggestName({ url: 'http://127.0.0.1:3000/mcp' }), 'local', 'never the last digit of an address');
  assert.equal(suggestName({ url: 'https://mcp.linear.app/mcp' }, ['linear']), 'linear-2');
});

test('a header placeholder is asked for, and the scheme stays out of the question', () => {
  const entry = { url: 'https://a.b', headers: { Authorization: 'Bearer <your-token>', 'X-Team': 'core', 'X-Api-Key': 'abc123', Other: 'Bearer ${UNSET_ONE}' } };
  const { ask, keep } = planEnv(entry, {});
  assert.deepEqual(ask.map((a) => a.key), ['Authorization', 'Other']);
  assert.equal(ask[0].hidden, true);
  assert.deepEqual(keep, ['X-Api-Key']);
});

test('typed values land in the header, keeping the scheme it had', () => {
  assert.equal(headerValue('Bearer <token>', 'abc'), 'Bearer abc');
  assert.equal(headerValue('Bearer <token>', 'Bearer abc'), 'Bearer abc', 'pasted whole');
  assert.equal(headerValue('<token>', 'abc'), 'abc');
  assert.equal(headerValue('kept'), 'kept');
  assert.deepEqual(withValues({ url: 'u', headers: { A: 'Bearer <t>', B: 'x' } }, { A: 'tok' }).headers, { A: 'Bearer tok', B: 'x' });
  assert.deepEqual(withValues({ command: 'c', env: { A: '' } }, { A: 'v' }).env, { A: 'v' }, 'control: a command keeps env');
});

test('the check step names a header and shows where a reference reads from', () => {
  assert.equal(valuesLine({ url: 'u', headers: { 'X-Team': 'core', Authorization: 'Bearer abc' } }), 'X-Team=core Authorization');
  assert.equal(valuesLine({ url: 'u', headers: { Authorization: 'Bearer ${AWS_SECRET}' } }), 'Authorization=Bearer ${AWS_SECRET}');
});
