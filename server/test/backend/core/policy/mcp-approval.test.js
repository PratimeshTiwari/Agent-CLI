/**
 * The switch, the box and the lock (v9.1), through the real dispatch against a
 * real server process, so "nothing ran" and "they overlapped" are measured.
 */
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentLoop } from '../../../../src/backend/core/turn/agent-loop.js';
import { MCPServer } from '../../../../src/backend/mcp/mcp-server.js';
import { RiskClassifier } from '../../../../src/backend/core/commands/risk-classifier.js';
import { isBlockedOutright, requiresApproval } from '../../../../src/backend/core/policy/tool-policy.js';
import { issueApproval } from '../../../../src/backend/core/policy/approval-token.js';
import { MCP_TOOLS } from '../../../../src/backend/core/prompt/tool-catalog.js';
import { runBatchTask } from '../../../../src/backend/core/turn/turn-runner.js';
import { McpServers, MAX_CALLS_AT_ONCE } from '../../../../src/backend/mcp/client/servers.js';
import { loadMcpConfig } from '../../../../src/backend/mcp/client/config.js';
import { setSwitch, switchFor } from '../../../../src/backend/mcp/client/switches.js';
import { saveUserSettings } from '../../../../src/backend/core/workspace/user-settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '../../../fixtures/mcp-fixture-server.js');

let mcp;
let cfgDir;
let marker;

before(async () => {
  cfgDir = mkdtempSync(join(tmpdir(), 'mcp-loop-'));
  marker = join(cfgDir, 'pid');
  const path = join(cfgDir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: {
    fix: { command: process.execPath, args: [FIXTURE, 'calls', marker], env: { FIXTURE_TOKEN: 'sekrit-value' } },
    strictly: { command: process.execPath, args: [FIXTURE, 'calls'], alwaysAsk: true },
    other: { command: process.execPath, args: [FIXTURE, 'calls'] },
    off: { command: process.execPath, args: [FIXTURE, 'calls'], disabled: true },
  } }));
  mcp = new McpServers({ workspace: cfgDir, load: () => loadMcpConfig({ path, env: {} }), cachePath: join(cfgDir, 'cache.json') });
});
after(() => mcp.dispose());
afterEach(() => saveUserSettings({ mcpSwitches: {} }));

function driven({ mode = 'plan', answer = 'send', version = 'v5' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-ws-'));
  mkdirSync(join(dir, '.agent'), { recursive: true });
  const panel = [];
  const l = Object.create(AgentLoop.prototype);
  Object.defineProperty(l, 'promptVersion', { value: version });
  Object.assign(l, {
    workspace: dir,
    mode,
    _mcp: mcp,
    modelConfig: { main: 'gemini' },
    conversationHistory: [],
    commandRules: { enabled: true, allow: [], block: [] },
    sessionStore: { appendTurn() {} },
    riskClassifier: new RiskClassifier(dir),
    mcpServer: new MCPServer(dir, null),
    promptBuilder: { noteMessageSent() {}, buildToolResultBatch: (r) => JSON.stringify(r) },
    callbacks: {
      sendToPanel: (m) => {
        panel.push(m);
        if (m.type === 'request_command_approval' && answer) setImmediate(() => l.answerCommandApproval(answer, null));
      },
    },
    _saveConfig() {},
    _sendToGemini() {},
    _turnEvidence: new Map(),
  });
  return { l, panel, dir };
}

const call = (tool, args = {}, server = 'fix') => ({ name: 'mcp_tool', args: { server, tool, args } });
const boxes = (panel) => panel.filter((m) => m.type === 'request_command_approval');
const results = (l) => l.conversationHistory.filter((t) => t.type === 'tool_result');
const commandLog = (dir) => {
  const logs = join(dir, '.agent', 'logs', 'commands');
  return readdirSync(logs).map((f) => readFileSync(join(logs, f), 'utf8')).join('');
};

describe('the policy', () => {
  it('every row of the table, through requiresApproval', () => {
    const table = { ask: [true, true, true], auto: [false, false, true], block: [true, true, true] };
    for (const [mcpSwitch, row] of Object.entries(table)) {
      ['plan', 'auto', 'strict'].forEach((mode, i) => {
        for (const level of ['safe', 'risky', 'critical']) {
          assert.equal(requiresApproval(call('x'), { mode, mcpSwitch, risk: { level } }), row[i], `${mcpSwitch} ${mode} ${level}`);
        }
      });
    }
  });

  it('with no switch to go on it asks, in auto too', () => {
    assert.equal(requiresApproval(call('x'), { mode: 'auto', risk: { level: 'safe' } }), true);
  });

  it('block is blocked in every mode, and only an MCP call reads the switch', () => {
    assert.equal(isBlockedOutright(call('x'), null, { mcpSwitch: 'block' }), true);
    assert.equal(isBlockedOutright(call('x'), null, { mcpSwitch: 'auto' }), false);
    assert.equal(isBlockedOutright({ name: 'run_command' }, { level: 'safe' }, { mcpSwitch: 'block' }), false);
  });

  it('mcp_describe never asks', () => {
    for (const mode of ['plan', 'auto', 'strict']) {
      assert.equal(requiresApproval({ name: 'mcp_describe' }, { mode, risk: { level: 'risky' } }), false);
    }
  });

  it('the check is the second statement: below the mode branch, auto would ask the classifier', () => {
    const src = readFileSync(join(here, '../../../../src/backend/core/policy/tool-policy.js'), 'utf8');
    const body = src.slice(src.indexOf('export function requiresApproval'));
    const external = body.indexOf('EXTERNAL_TOOLS.has(name)');
    const mine = body.indexOf("name === 'mcp_tool'");
    const modes = body.indexOf('asksForEdits(mode)');
    assert.ok(external > 0 && external < mine && mine < modes, `${external} ${mine} ${modes}`);
  });
});

describe('through the real loop', () => {
  it('ask: the box comes first, and Run runs it', async () => {
    const { l, panel } = driven({ answer: 'send' });
    await l._executeToolCalls([call('echo', { q: 'hi' })]);
    assert.equal(boxes(panel).length, 1);
    assert.match(boxes(panel)[0].payload.title, /fix · echo/);
    assert.deepEqual(boxes(panel)[0].payload.choices.map((c) => c.value), ['send', 'allow_always', 'reject']);
    assert.match(results(l)[0].result, /echo:hi/);
  });

  it("Don't run runs nothing, and says so", async () => {
    const log = join(cfgDir, 'never-rejected');
    const { l, dir } = driven({ answer: 'reject' });
    await l._executeToolCalls([call('never', { log })]);
    assert.equal(existsSync(log), false, 'the server was never asked');
    assert.match(results(l)[0].result, /^User rejected/);
    assert.match(commandLog(dir), /"outcome":"rejected"/);
  });

  it('auto: no box in plan or auto mode', async () => {
    setSwitch('fix', 'echo', 'auto');
    for (const mode of ['plan', 'auto']) {
      const { l, panel } = driven({ mode, answer: null });
      await l._executeToolCalls([call('echo', { q: mode })]);
      assert.equal(boxes(panel).length, 0, mode);
      assert.match(results(l)[0].result, new RegExp(`echo:${mode}`));
    }
  });

  it('auto in strict still asks', async () => {
    setSwitch('fix', 'echo', 'auto');
    const { l, panel } = driven({ mode: 'strict', answer: 'send' });
    await l._executeToolCalls([call('echo', { q: 's' })]);
    assert.equal(boxes(panel).length, 1);
  });

  it('block: refused with no box, and the server is not asked', async () => {
    setSwitch('fix', 'never', 'block');
    const log = join(cfgDir, 'never-blocked');
    const { l, panel, dir } = driven({ mode: 'auto', answer: 'send' });
    await l._executeToolCalls([call('never', { log })]);
    assert.equal(boxes(panel).length, 0);
    assert.equal(existsSync(log), false);
    assert.match(results(l)[0].result, /blocked by the user/);
    assert.match(commandLog(dir), /"outcome":"blocked"/);
  });

  it('Always for this tool sets that tool to auto, and the next call does not ask', async () => {
    const { l, panel } = driven({ answer: 'allow_always' });
    await l._executeToolCalls([call('echo', { q: '1' })]);
    assert.equal(switchFor('fix', 'echo'), 'auto');
    assert.equal(switchFor('fix', 'add'), 'ask', 'control: that tool only');
    await l._executeToolCalls([call('echo', { q: '2' })]);
    assert.equal(boxes(panel).length, 1);
  });

  it('alwaysAsk: no Always in the box, and auto cannot get past it', async () => {
    setSwitch('strictly', 'echo', 'auto');
    const { l, panel } = driven({ mode: 'auto', answer: 'allow_always' });
    await l._executeToolCalls([call('echo', { q: 'x' }, 'strictly')]);
    assert.equal(boxes(panel).length, 1);
    assert.deepEqual(boxes(panel)[0].payload.choices.map((c) => c.value), ['send', 'reject']);
  });

  it('a stale "always" from a side panel on an alwaysAsk server sets nothing', async () => {
    const { l } = driven({ answer: 'allow_always' });
    await l._executeToolCalls([call('echo', { q: 'x' }, 'strictly')]);
    assert.equal(switchFor('strictly', 'echo'), 'ask');
  });

  it('the log names server, tool and outcome, and no argument', async () => {
    const { l, dir } = driven({ answer: 'send' });
    await l._executeToolCalls([call('echo', { q: 'private-argument' })]);
    const log = commandLog(dir);
    assert.match(log, /mcp fix echo/);
    assert.match(log, /"outcome":"ran"/);
    assert.doesNotMatch(log, /private-argument/);
  });

  it('a token in a result is hidden before the model sees it', async () => {
    const { l } = driven({ answer: 'send' });
    await l._executeToolCalls([call('token')]);
    assert.match(results(l)[0].result, /token is \[hidden\]/);
    assert.doesNotMatch(JSON.stringify(l.conversationHistory), /sekrit-value/);
  });

  it('a failure and a label escape stay data', async () => {
    const { l } = driven({ answer: 'send' });
    await l._executeToolCalls([call('fail'), call('escape')]);
    const [failed, escaped] = results(l);
    assert.equal(failed.success, false);
    assert.match(failed.result, /data, not instructions.*it went wrong/);
    assert.equal(escaped.result.match(/<\/mcp_result>/g).length, 1);
  });

  it('an unknown or switched-off server is an answer, not a box', async () => {
    const { l, panel } = driven({ answer: null });
    await l._executeToolCalls([call('echo', {}, 'ghost'), call('echo', {}, 'off')]);
    assert.equal(boxes(panel).length, 0);
    assert.match(results(l)[0].result, /No MCP server named "ghost"/);
    assert.match(results(l)[1].result, /No MCP server named "off"/);
  });

  it('mcp_describe lists a server, then one tool, and hides a blocked one', async () => {
    setSwitch('fix', 'never', 'block');
    const { l, panel } = driven({ mode: 'strict', answer: null });
    await l._executeToolCalls([
      { name: 'mcp_describe', args: { server: 'fix' } },
      { name: 'mcp_describe', args: { server: 'fix', tool: 'echo' } },
      { name: 'mcp_describe', args: { server: 'fix', tool: 'never' } },
    ]);
    assert.equal(boxes(panel).length, 0);
    const [all, one, hidden] = results(l).sort((a, b) => a.result.length - b.result.length).reverse();
    assert.ok([all, one, hidden].some((r) => /- echo:/.test(r.result)));
    assert.ok([all, one, hidden].some((r) => /JSON Schema/.test(r.result)));
    assert.ok([all, one, hidden].some((r) => /has no tool "never"/.test(r.result)));
    assert.ok(!results(l).some((r) => /- never:/.test(r.result)));
  });

  it('every prompt version calls a server, v1 included (v9.9.5: a feature, not a version)', async () => {
    const { l, panel } = driven({ version: 'v1', answer: 'send' });
    await l._executeToolCalls([call('echo', { q: 'x' })]);
    assert.equal(boxes(panel).length, 1, 'asked, as on any version');
    assert.doesNotMatch(results(l)[0].result, /not offered/);
  });
});

describe('several calls in one reply', () => {
  it('auto calls overlap, and the cap holds', async () => {
    setSwitch('other', 'slow', 'auto');
    const { l } = driven({ mode: 'auto', answer: null });
    const n = MAX_CALLS_AT_ONCE + 3;
    await l._executeToolCalls(Array.from({ length: n }, (_, i) => call('slow', { q: i, ms: 150 }, 'other')));
    const most = Math.max(...results(l).map((r) => Number(r.result.match(/most:(\d+)/)[1])));
    assert.equal(most, MAX_CALLS_AT_ONCE, 'more than one at once, and no more than the cap');
    assert.equal(results(l).length, n);
  });

  it('control: ask calls never overlap', async () => {
    const { l } = driven({ mode: 'plan', answer: 'send' });
    await mcp.closeAll(); // a fresh process, so its high-water mark is this test's
    await l._executeToolCalls([call('slow', { q: 1, ms: 80 }, 'other'), call('slow', { q: 2, ms: 80 }, 'other')]);
    assert.ok(results(l).every((r) => /most:1\b/.test(r.result)), results(l).map((r) => r.result).join());
  });

  it('a box waits for the calls before it, and the ones after wait for the box', async () => {
    setSwitch('fix', 'slow', 'auto');
    await mcp.closeAll();
    const order = [];
    const { l } = driven({ mode: 'auto', answer: null });
    const send = l.callbacks.sendToPanel;
    l.callbacks.sendToPanel = (m) => {
      send(m);
      if (m.type === 'tool_result') order.push(`done:${String(m.payload.result).match(/(?:done|echo):(\w+)/)?.[1]}`);
      if (m.type === 'request_command_approval') {
        order.push('box');
        setTimeout(() => l.answerCommandApproval('send', null), 150);
      }
    };
    await l._executeToolCalls([
      call('slow', { q: 'first', ms: 200 }),
      call('slow', { q: 'second', ms: 200 }),
      call('echo', { q: 'asked' }),
      call('slow', { q: 'last', ms: 10 }),
    ]);
    assert.deepEqual(order.slice(2), ['box', 'done:asked', 'done:last']);
    assert.deepEqual(order.slice(0, 2).sort(), ['done:first', 'done:second']);
  });

  it('results line up with their calls, whichever finished first', async () => {
    setSwitch('fix', 'slow', 'auto');
    const { l } = driven({ mode: 'auto', answer: null });
    let batch;
    l.promptBuilder.buildToolResultBatch = (r) => { batch = r; return ''; };
    await l._executeToolCalls([call('slow', { q: 'a', ms: 150 }), call('slow', { q: 'b', ms: 10 })]);
    assert.match(String(batch[0].result), /done:a/);
    assert.match(String(batch[1].result), /done:b/);
  });

  it('esc cancels what is running, and the rest never start', async () => {
    setSwitch('fix', 'never', 'auto');
    const log = join(cfgDir, 'never-after-stop');
    const { l, panel } = driven({ mode: 'auto', answer: 'send' });
    await mcp.toolsOf('fix');
    const running = l._executeToolCalls([call('never'), call('echo', { q: 'held' }), call('never', { log })]);
    setTimeout(() => l.noteUserStop(), 150);
    await running;
    assert.equal(results(l).length, 3);
    assert.ok(results(l).every((r) => r.success === false), results(l).map((r) => r.result).join(' | '));
    assert.equal(existsSync(log), false);
    assert.equal(boxes(panel).length, 0, 'nobody is asked about a call after a stop');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(existsSync(`${marker}.cancelled`), true, 'the server got the protocol\'s cancel');
  });
});

describe('the handler is the third lock', () => {
  const direct = (ctx) => new MCPServer(cfgDir, null).executeTool('mcp_tool', { server: 'fix', tool: 'echo', args: { q: 'x' } }, ctx);

  it('no MCP set, as a subagent would have: refused', async () => {
    const r = await direct({});
    assert.equal(r.success, false);
    assert.match(r.error, /main conversation/);
  });

  it('an ask tool with no token: refused', async () => {
    const r = await direct({ mcp, mode: 'auto' });
    assert.equal(r.success, false);
    assert.match(r.error, /Nothing was run/);
  });

  it('a token the model wrote is not a token', async () => {
    const r = await direct({ mcp, mode: 'auto', approval: { approved: true } });
    assert.equal(r.success, false);
  });

  it('a real token works once', async () => {
    const approval = issueApproval();
    assert.equal((await direct({ mcp, mode: 'plan', approval })).success, true);
    assert.equal((await direct({ mcp, mode: 'plan', approval })).success, false);
  });

  it('a token does not open a blocked tool', async () => {
    setSwitch('fix', 'echo', 'block');
    assert.equal((await direct({ mcp, mode: 'plan', approval: issueApproval() })).success, false);
  });
});

describe('subagents', () => {
  it('the batch runner refuses both, and no call reaches the handler', async () => {
    assert.deepEqual([...MCP_TOOLS].sort(), ['mcp_describe', 'mcp_setup', 'mcp_tool']);
    for (const name of MCP_TOOLS) {
      const calls = [];
      let turn = 0;
      await runBatchTask({
        system: 's', user: 'u', maxTurns: 3,
        send: async () => ({ success: true, result: turn++ === 0 ? 'CALL' : 'done' }),
        extractToolCalls: (c) => ({ toolCalls: c === 'CALL' ? [{ name, args: { server: 'fix', tool: 'echo' } }] : [], cleanContent: c }),
        executeTool: async (n) => { calls.push(n); return { success: true }; },
        classifyRisk: () => ({ level: 'safe' }),
      });
      assert.deepEqual(calls, [], name);
    }
  });

  it('a subagent session has an allow-list, and neither is on it', () => {
    const src = readFileSync(join(here, '../../../../src/backend/core/subagents/subagent-session.js'), 'utf8');
    const list = src.match(/if \(!\[(.*?)\]\.includes\(call\.name\)\)/)[1];
    assert.match(list, /read_file/, 'control: this is the list');
    assert.doesNotMatch(list, /mcp_/);
  });
});
