/**
 * Every write to Jira asks, in every mode, and nothing else can say yes (v8.1).
 *
 * Owner, 2026-10-31: "make sure all write/modify changes ask for my permission
 * as a mandatory step". These drive the real loop's dispatch and the real tool
 * against a fake Jira that counts requests, so "nothing was sent" is measured.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../src/backend/core/agent-loop.js';
import { MCPServer } from '../../../src/backend/mcp/mcp-server.js';
import { RiskClassifier } from '../../../src/backend/core/risk-classifier.js';
import { requiresApproval, isExternalWrite } from '../../../src/backend/core/tool-policy.js';
import { EXTERNAL_TOOLS } from '../../../src/backend/core/tool-catalog.js';
import { runBatchTask } from '../../../src/backend/core/turn-runner.js';
import { startFakeJira, useFakeJira } from '../atlassian/fake-jira.js';
import { _resetTokenCache } from '../../../src/backend/atlassian/config.js';

let fake;
let restore;
before(async () => {
  fake = await startFakeJira({ kind: 'cloud' });
  restore = useFakeJira(fake);
  _resetTokenCache();
});
after(async () => {
  restore();
  await fake.close();
});

/** A loop on the real dispatch, whose approval box is answered with `answer` (or never, with null). */
function driven({ mode = 'auto', answer = 'send', allow = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ext-'));
  mkdirSync(join(dir, '.agent'), { recursive: true });
  const panel = [];
  const l = Object.create(AgentLoop.prototype);
  Object.assign(l, {
    workspace: dir,
    mode,
    modelConfig: { main: 'gemini' },
    conversationHistory: [],
    commandRules: { enabled: true, allow: [...allow], block: [] },
    sessionStore: { appendTurn() {} },
    riskClassifier: new RiskClassifier(dir),
    mcpServer: new MCPServer(dir, null),
    promptBuilder: { noteMessageSent() {}, buildToolResultBatch: (r) => JSON.stringify(r) },
    callbacks: {
      sendToPanel: (m) => {
        panel.push(m);
        if (m.type === 'request_command_approval' && answer) setImmediate(() => l.answerCommandApproval(answer, m.payload.command));
      },
    },
    _saveConfig() {},
    _sendToGemini() {},
    _turnEvidence: new Map(),
  });
  return { l, panel, dir };
}

const comment = { name: 'jira_issue', args: { action: 'comment', key: 'PROJ-12', body: 'Fixed in **#42**.' } };
const asked = (panel) => panel.filter((m) => m.type === 'request_command_approval');
const lastResult = (l) => l.conversationHistory.filter((t) => t.type === 'tool_result').at(-1);

describe('the policy', () => {
  it('a Jira write needs approval in plan, auto and strict, whatever the risk says', () => {
    for (const mode of ['plan', 'auto', 'strict']) {
      for (const level of ['safe', 'risky', 'critical']) {
        assert.equal(requiresApproval(comment, { mode, risk: { level }, workspace: '/w' }), true, `${mode}/${level}`);
      }
    }
  });

  it('reads never ask; an unknown action does', () => {
    for (const action of ['get', 'search']) {
      assert.equal(requiresApproval({ name: 'jira_issue', args: { action } }, { mode: 'strict', risk: { level: 'safe' } }), false);
    }
    assert.equal(isExternalWrite({ name: 'jira_issue', args: { action: 'archive' } }), true);
    assert.equal(isExternalWrite({ name: 'jira_issue', args: {} }), true);
  });

  it('the external check is the first thing requiresApproval does', () => {
    // Moving it below the mode branch reads as tidying, and would let auto
    // mode decide by the risk classifier — which calls a Jira call "Unknown".
    const src = readFileSync(new URL('../../../src/backend/core/tool-policy.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export function requiresApproval'));
    const firstStatement = body.split('\n').slice(1).map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'))
      .slice(0, 2);
    assert.deepEqual(firstStatement, ['const name = call?.name;', 'if (EXTERNAL_TOOLS.has(name)) return isExternalWrite(call);']);
  });

  it('jira_issue is the external tool', () => assert.deepEqual([...EXTERNAL_TOOLS], ['jira_issue']));
});

describe('through the real loop', () => {
  it('auto mode: asked first, sent once on Send, and logged', async () => {
    const { l, panel, dir } = driven({ mode: 'auto', answer: 'send' });
    const n = fake.writes().length;
    await l._executeToolCalls([comment]);
    assert.equal(asked(panel).length, 1, 'asked');
    const p = asked(panel)[0].payload;
    assert.equal(p.kind, 'external');
    assert.equal(p.title, 'Comment on PROJ-12 in Jira?');
    assert.deepEqual(p.lines, ['PROJ-12 · Fix login timeout', '  Fixed in **#42**.']);
    assert.equal(fake.writes().length, n + 1, 'one request');
    assert.match(lastResult(l).result, /^Commented on PROJ-12/);
    const day = readdirSync(join(dir, '.agent', 'logs', 'commands'))[0];
    const row = JSON.parse(readFileSync(join(dir, '.agent', 'logs', 'commands', day), 'utf8').trim().split('\n').at(-1));
    assert.equal(row.command, 'jira_issue comment PROJ-12');
    assert.equal(row.outcome, 'ran');
    assert.equal(row.risk, 'external');
    assert.ok(!JSON.stringify(row).includes('tok-123'), 'no token in the log');
  });

  it("Don't send: nothing reaches Jira, the model is told not to retry, and it is logged", async () => {
    const { l, dir } = driven({ answer: 'reject' });
    const n = fake.writes().length;
    await l._executeToolCalls([comment]);
    assert.equal(fake.writes().length, n);
    const r = lastResult(l);
    assert.equal(r.success, false);
    assert.match(r.result, /^User rejected: nothing was sent to Jira\. Do not retry it/);
    const day = readdirSync(join(dir, '.agent', 'logs', 'commands'))[0];
    assert.match(readFileSync(join(dir, '.agent', 'logs', 'commands', day), 'utf8'), /"outcome":"rejected"/);
  });

  it('"always" counts as this once and adds no rule', async () => {
    const { l } = driven({ answer: 'allow_always' });
    const n = fake.writes().length;
    await l._executeToolCalls([comment]);
    assert.equal(fake.writes().length, n + 1);
    assert.deepEqual(l.commandRules.allow, []);
    assert.equal(l._pendingExternal, false);
  });

  it('an allow rule for the same text does not skip the question', async () => {
    const { l, panel } = driven({ allow: ['jira_issue comment PROJ-12', comment.args.body] });
    await l._executeToolCalls([comment]);
    assert.equal(asked(panel).length, 1);
  });

  it('no answer, no send: the call waits on the person', async () => {
    const { l, panel } = driven({ answer: null });
    const n = fake.writes().length;
    const running = l._executeToolCalls([comment]);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(asked(panel).length, 1);
    assert.equal(fake.writes().length, n, 'nothing sent while unanswered');
    l.answerCommandApproval('reject');
    await running;
    assert.equal(fake.writes().length, n);
  });

  it('reads run without asking', async () => {
    const { l, panel } = driven({ mode: 'strict', answer: null });
    await l._executeToolCalls([{ name: 'jira_issue', args: { action: 'get', key: 'PROJ-12' } }]);
    assert.equal(asked(panel).length, 0);
    assert.match(lastResult(l).result, /^PROJ-12 · Fix login timeout/);
  });

  it('a plan with nothing to send answers without asking', async () => {
    const { l, panel } = driven({ answer: null });
    await l._executeToolCalls([{ name: 'jira_issue', args: { action: 'transition', key: 'PROJ-12', to: 'Shipped' } }]);
    assert.equal(asked(panel).length, 0);
    assert.match(lastResult(l).result, /cannot move to "Shipped"/);
  });

  it('the registry alone cannot write: executeTool without the loop refuses', async () => {
    const server = new MCPServer(mkdtempSync(join(tmpdir(), 'ext-raw-')), null);
    const n = fake.writes().length;
    const r = await server.executeTool('jira_issue', comment.args, {});
    assert.equal(r.success, false);
    assert.match(r.error, /only after the user approves/);
    assert.equal(fake.writes().length, n);
  });
});

describe('subagents', () => {
  it('a batch subagent cannot call it, read or write', async () => {
    const calls = [];
    let turn = 0;
    const out = await runBatchTask({
      system: 's', user: 'u', maxTurns: 3,
      send: async () => ({ success: true, result: turn++ === 0 ? 'CALL jira_issue' : 'done' }),
      extractToolCalls: (c) => ({
        toolCalls: /jira_issue/.test(c) ? [{ name: 'jira_issue', args: { action: 'get', key: 'PROJ-12' } }] : [],
        cleanContent: c,
      }),
      executeTool: async (name) => { calls.push(name); return { success: true }; },
      classifyRisk: () => ({ level: 'safe' }),
    });
    assert.deepEqual(calls, [], 'never reached the tool');
    assert.ok(out.success);
  });

  it('the research subagent allowlist does not name it', () => {
    const src = readFileSync(new URL('../../../src/backend/core/subagent-session.js', import.meta.url), 'utf8');
    const list = src.match(/if \(!\[([^\]]*)\]\.includes\(call\.name\)\)/);
    assert.ok(list, 'the allowlist is where this test expects it');
    assert.ok(!list[1].includes('jira'));
  });
});

it('the fake really is Cloud-shaped (control)', () => assert.ok(existsSync(new URL('../atlassian/fake-jira.js', import.meta.url))));
