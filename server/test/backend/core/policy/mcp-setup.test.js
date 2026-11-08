/**
 * `mcp_setup` (v9.9.7): the model adds and tests a server when the person asks.
 * Through the real runner and handler against the real fixture process, so "it
 * ran", "nothing ran" and "the secret stayed out" are measured, not assumed.
 * A pidfile is the proof a process started.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentLoop } from '../../../../src/backend/core/turn/agent-loop.js';
import { MCPServer } from '../../../../src/backend/mcp/mcp-server.js';
import { McpServers } from '../../../../src/backend/mcp/client/servers.js';
import { loadMcpConfig, mcpConfigPath } from '../../../../src/backend/mcp/client/config.js';
import { issueApproval } from '../../../../src/backend/core/policy/approval-token.js';
import { runMcpSetup, setupPayload } from '../../../../src/backend/core/policy/mcp-setup-approval.js';
import { planSetup } from '../../../../src/backend/mcp/tools/mcp-setup.js';
import { renderToolDefinitions, TOOL_CATALOG } from '../../../../src/backend/core/prompt/tool-catalog.js';
import { PROMPT_VERSIONS, FEATURES } from '../../../../src/backend/core/prompt/prompt-versions.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '../../../fixtures/mcp-fixture-server.js');

let scratch;
let mcp;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'mcp-setup-'));
  mcp = new McpServers({ workspace: scratch, load: () => loadMcpConfig({ path: mcpConfigPath(), env: {} }), cachePath: join(scratch, 'cache.json') });
});
// A save starts the server in the background (as /mcp add does): wait for it,
// or a start that lands after the next test's reset is a child nobody closes.
const settled = () => Promise.all([...mcp.live.values()].map((e) => e.starting));

after(async () => {
  await settled();
  await mcp.dispose();
  rmSync(scratch, { recursive: true, force: true });
});
beforeEach(async () => {
  await settled();
  rmSync(mcpConfigPath(), { force: true });
  await mcp.configChanged();
});

/** The pasted JSON for the fixture, as a README would give it. */
function pasted(name, mode, { env, marker } = {}) {
  const entry = { command: process.execPath, args: [FIXTURE, mode, ...(marker ? [marker] : [])], ...(env ? { env } : {}) };
  return JSON.stringify({ mcpServers: { [name]: entry } });
}

function driven({ mode = 'plan', answer = 'send', values } = {}) {
  const dir = mkdtempSync(join(scratch, 'ws-'));
  mkdirSync(join(dir, '.agent'), { recursive: true });
  const panel = [];
  let resets = 0;
  const l = Object.create(AgentLoop.prototype);
  Object.assign(l, {
    workspace: dir,
    mode,
    _mcp: mcp,
    mcpServer: new MCPServer(dir, null),
    promptBuilder: { _toolFlags: () => ({ customMcp: true }), resetPromptState: () => { resets += 1; } },
    callbacks: {
      sendToPanel: (m) => {
        panel.push(m);
        if (m.type === 'request_command_approval' && answer) setImmediate(() => l.answerCommandApproval(answer, null, values));
      },
    },
  });
  return { l, panel, dir, resets: () => resets };
}

const boxes = (panel) => panel.filter((m) => m.type === 'request_command_approval');
const commandLog = (dir) => {
  const logs = join(dir, '.agent', 'logs', 'commands');
  return existsSync(logs) ? readdirSync(logs).map((f) => readFileSync(join(logs, f), 'utf8')).join('') : '';
};
const saved = () => (existsSync(mcpConfigPath()) ? JSON.parse(readFileSync(mcpConfigPath(), 'utf8')).mcpServers : {});

describe('planSetup', () => {
  it('reads what /mcp add reads, and names what is wrong', () => {
    assert.match(planSetup({}).problem, /Pass `input`/);
    assert.match(planSetup({ input: 'a | b' }).problem, /shell line/);
    const plan = planSetup({ input: 'npx -y @scope/server-github' });
    assert.equal(plan.name, 'github');
    assert.deepEqual(plan.ask, []);
    assert.equal(planSetup({ input: 'npx -y @scope/server-github', name: 'gh' }).name, 'gh');
    assert.match(planSetup({ input: 'npx x', name: 'gh' }, { taken: ['gh'] }).problem, /already a server called gh/);
    assert.match(planSetup({ input: 'npx x', name: 'bad name!' }).problem, /cannot be a server name/);
  });

  it('a token left empty is asked for, hidden; a set ${VAR} is not', () => {
    const plan = planSetup({ input: '{"gh":{"command":"npx","env":{"GITHUB_TOKEN":"","MODE":"x","HOME_KEY":"${HOME_KEY}"}}}' }, { env: { HOME_KEY: 'k' } });
    assert.deepEqual(plan.ask, [{ key: 'GITHUB_TOKEN', hidden: true }]);
  });
});

describe('the handler is the third lock', () => {
  it('refuses without the box\'s token: nothing runs, nothing is written', async () => {
    const marker = join(scratch, 'pid-nolock');
    const server = new MCPServer(scratch, null);
    const r = await server.executeTool('mcp_setup', { input: pasted('fx', 'ok', { marker }) }, { mcp });
    assert.equal(r.success, false);
    assert.match(r.error, /needs the user's yes/);
    assert.equal(existsSync(marker), false, 'no process started');
    assert.deepEqual(saved(), {});
    // Control: the same call with a token runs.
    const ok = await server.executeTool('mcp_setup', { input: pasted('fx', 'ok', { marker }) }, { mcp, approval: issueApproval() });
    assert.equal(ok.success, true, ok.error);
    assert.equal(existsSync(marker), true, 'control: it does start with a token');
  });
});

describe('the box', () => {
  it('Don\'t add: nothing runs or is saved, and the log says rejected', async () => {
    const marker = join(scratch, 'pid-reject');
    const { l, panel, dir } = driven({ answer: 'reject' });
    const r = await runMcpSetup(l, { name: 'mcp_setup', args: { input: pasted('fx', 'ok', { marker }) } });
    assert.equal(r.success, false);
    assert.match(r.error, /^User rejected: nothing was run or saved/);
    assert.equal(boxes(panel).length, 1);
    const p = boxes(panel)[0].payload;
    assert.equal(p.title, 'Add MCP server fx?');
    assert.ok(p.lines[0].includes(FIXTURE), 'the command is shown');
    assert.deepEqual(p.choices.map((c) => c.value), ['send', 'reject']);
    assert.equal(existsSync(marker), false);
    assert.deepEqual(saved(), {});
    assert.match(commandLog(dir), /"outcome":"rejected"/);
  });

  it('Test and add: it starts, is saved, the model gets its tools and the chat is re-taught', async () => {
    const marker = join(scratch, 'pid-add');
    const { l, panel, dir, resets } = driven();
    const r = await runMcpSetup(l, { name: 'mcp_setup', args: { input: pasted('fx', 'ok', { marker }) } });
    assert.equal(r.success, true, r.error);
    assert.equal(boxes(panel).length, 1);
    assert.equal(existsSync(marker), true);
    assert.match(r.result, /^Added fx to ~\/\.agent\/mcp\.json and tested it: it answered with \d+ tools?: /);
    assert.match(r.result, /mcp_tool \{"server": "fx"/);
    assert.deepEqual(saved().fx.args, [FIXTURE, 'ok', marker]);
    assert.ok(mcp.usable('fx'), 'usable at once');
    assert.equal(resets(), 1, 'the next prompt names the server');
    assert.match(commandLog(dir), /"command":"mcp add fx: [^"]*","cwd":"mcp.json","risk":"mcp","outcome":"ran"/);
  });

  it('auto mode asks too', async () => {
    const { l, panel } = driven({ mode: 'auto', answer: 'reject' });
    await runMcpSetup(l, { name: 'mcp_setup', args: { input: pasted('fx', 'ok') } });
    assert.equal(boxes(panel).length, 1);
  });

  it('one box, then auto: the same command again runs unasked; a changed one asks', async () => {
    const { l, panel } = driven();
    const first = await runMcpSetup(l, { name: 'mcp_setup', args: { input: pasted('fx', 'crash') } });
    assert.equal(first.success, false);
    assert.match(first.error, /did not start, so nothing was saved/);
    assert.deepEqual(saved(), {});
    await runMcpSetup(l, { name: 'mcp_setup', args: { input: pasted('fx', 'crash') } });
    assert.equal(boxes(panel).length, 1, 'the retry did not ask');
    const fixed = await runMcpSetup(l, { name: 'mcp_setup', args: { input: pasted('fx', 'ok') } });
    assert.equal(boxes(panel).length, 2, 'a changed command asks');
    assert.equal(fixed.success, true, fixed.error);
  });

  it('a parse problem asks nothing and runs nothing', async () => {
    const { l, panel } = driven();
    const r = await runMcpSetup(l, { name: 'mcp_setup', args: { input: 'npx a && rm -rf ~' } });
    assert.match(r.error, /shell line/);
    assert.equal(boxes(panel).length, 0);
  });
});

describe('secrets never pass through the model', () => {
  it('a token is typed in the box, kept out of mcp.json, out of the result and out of an error', async () => {
    const { l, panel } = driven({ values: { FIXTURE_TOKEN: 'typed-secret-123' } });
    // The fixture's crash mode prints the token on stderr, as a real server might.
    const bad = await runMcpSetup(l, { name: 'mcp_setup', args: { input: pasted('fx', 'crash', { env: { FIXTURE_TOKEN: '' } }) } });
    assert.deepEqual(boxes(panel)[0].payload.ask, [{ key: 'FIXTURE_TOKEN', hidden: true }]);
    assert.equal(bad.success, false);
    assert.match(bad.error, /\[hidden\]/, 'control: the server did print it');
    assert.doesNotMatch(bad.error, /typed-secret-123/);
    // The same command again still asks: the box is where the secret is typed.
    await runMcpSetup(l, { name: 'mcp_setup', args: { input: pasted('fx', 'crash', { env: { FIXTURE_TOKEN: '' } }) } });
    assert.equal(boxes(panel).length, 2, 'a retry of a server that needs a secret asks again');

    const good = await runMcpSetup(l, { name: 'mcp_setup', args: { input: pasted('fx', 'ok', { env: { FIXTURE_TOKEN: '' } }) } });
    assert.equal(good.success, true, good.error);
    assert.equal(boxes(panel).length, 3, 'and a changed one');
    assert.equal(saved().fx.env.FIXTURE_TOKEN, '${secret:fx/FIXTURE_TOKEN}');
    assert.doesNotMatch(readFileSync(mcpConfigPath(), 'utf8'), /typed-secret-123/);
    assert.doesNotMatch(good.result, /typed-secret-123/);
    assert.ok(!JSON.stringify(boxes(panel)).includes('typed-secret-123'), 'nor in what the panels are sent');
  });

  it('a screen that cannot ask (a side panel) gets a refusal, and nothing runs', async () => {
    const marker = join(scratch, 'pid-panel');
    const { l } = driven(); // answers Send with no values, as a panel does
    const r = await runMcpSetup(l, { name: 'mcp_setup', args: { input: pasted('fx', 'ok', { marker, env: { FIXTURE_TOKEN: '' } }) } });
    assert.equal(r.success, false);
    assert.match(r.error, /needs FIXTURE_TOKEN, which only the user types/);
    assert.equal(existsSync(marker), false);
  });
});

describe('the prompt', () => {
  it('offers it on current with no server set up, never on v1', () => {
    const v7 = { ...PROMPT_VERSIONS.v7.flags, ...FEATURES, customMcp: false };
    const v1 = { ...PROMPT_VERSIONS.v1.flags, ...FEATURES, customMcp: false };
    for (const tier of ['lite', 'flash', 'pro']) {
      assert.match(renderToolDefinitions(tier, true, {}, v7), /## mcp_setup/, tier);
      assert.doesNotMatch(renderToolDefinitions(tier, true, {}, v1), /## mcp_setup/, tier);
    }
    const doc = TOOL_CATALOG.find((t) => t.name === 'mcp_setup');
    assert.match(doc.flash, /Only when the user asks/);
    assert.match(doc.pro, /only when the user asks you to/);
  });

  it('the box payload says what testing does', () => {
    const http = setupPayload(planSetup({ input: 'https://mcp.example.com/mcp' }));
    assert.equal(http.riskReason, 'Testing it connects to this address');
    const cmd = setupPayload(planSetup({ input: 'npx x' }));
    assert.equal(cmd.riskReason, 'Testing it runs this command on your computer');
    assert.equal(cmd.ask, undefined);
  });
});
