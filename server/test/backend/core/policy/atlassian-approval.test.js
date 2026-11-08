/**
 * Every Jira write asks, in every mode, on the Atlassian MCP path too (v9.9).
 *
 * Owner, 2026-11-08: "Keep the rule that every Jira write asks me first, in
 * every mode." Driven through the real loop's dispatch against an OAuth MCP
 * server on a socket that records every call, so "nothing was sent" is counted.
 * A stored `auto` switch for the server is set first in every case: no switch
 * may loosen it.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentLoop } from '../../../../src/backend/core/turn/agent-loop.js';
import { MCPServer } from '../../../../src/backend/mcp/mcp-server.js';
import { RiskClassifier } from '../../../../src/backend/core/commands/risk-classifier.js';
import { requiresApproval, isBlockedOutright } from '../../../../src/backend/core/policy/tool-policy.js';
import { McpServers } from '../../../../src/backend/mcp/client/servers.js';
import { atlassianEntry } from '../../../../src/backend/mcp/client/atlassian-server.js';
import { makeStore } from '../../../../src/backend/mcp/client/oauth.js';
import { setSwitch, switchFor } from '../../../../src/backend/mcp/client/switches.js';
import { saveUserSettings } from '../../../../src/backend/core/workspace/user-settings.js';
import { startOAuthFixture } from '../../../fixtures/oauth-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
let fx;
let mcp;

before(async () => {
  fx = await startOAuthFixture();
  makeStore('atlassian').forget();
  mcp = new McpServers({
    workspace: mkdtempSync(join(tmpdir(), 'atl-')),
    load: () => ({ path: '/none', exists: false, error: null, servers: [] }),
    cachePath: join(mkdtempSync(join(tmpdir(), 'atl-cache-')), 'cache.json'),
    builtins: () => [atlassianEntry({ url: fx.url })],
  });
  const r = await mcp.signIn('atlassian', { open: (u) => fx.browse(u) });
  assert.deepEqual(r, { ok: true });
  // The loosest switches a settings file could hold: they must change nothing.
  setSwitch('atlassian', null, 'auto');
  for (const t of ['createJiraIssue', 'archiveEverything', 'getJiraIssue']) setSwitch('atlassian', t, 'auto');
});
after(async () => {
  saveUserSettings({ mcpSwitches: {} });
  makeStore('atlassian').forget();
  await mcp.dispose();
  await fx.close();
});

function driven({ mode, answer = 'send' }) {
  const dir = mkdtempSync(join(tmpdir(), 'atl-ws-'));
  mkdirSync(join(dir, '.agent'), { recursive: true });
  const panel = [];
  const l = Object.create(AgentLoop.prototype);
  Object.defineProperty(l, 'promptVersion', { value: 'v5' });
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

const call = (tool, args = {}) => ({ name: 'mcp_tool', args: { server: 'atlassian', tool, args } });
const boxes = (panel) => panel.filter((m) => m.type === 'request_command_approval');
const results = (l) => l.conversationHistory.filter((t) => t.type === 'tool_result');
const sent = (tool) => fx.state.calls.filter((c) => c === tool).length;

describe('the policy', () => {
  it('a write asks in every mode, whatever the switch says; a read never asks', () => {
    for (const mode of ['plan', 'auto', 'strict']) {
      for (const mcpSwitch of ['auto', 'ask', 'block', undefined]) {
        const ctx = { mode, mcpSwitch, risk: { level: 'safe' } };
        assert.equal(requiresApproval(call('createJiraIssue'), { ...ctx, external: 'write' }), true, `${mode} ${mcpSwitch}`);
        assert.equal(requiresApproval(call('getJiraIssue'), { ...ctx, external: 'read' }), false, `${mode} ${mcpSwitch}`);
        assert.equal(isBlockedOutright(call('getJiraIssue'), null, { mcpSwitch, external: 'read' }), false);
      }
    }
  });

  it('the Atlassian check sits after Jira\'s and before any switch is read', () => {
    const src = readFileSync(join(here, '../../../../src/backend/core/policy/tool-policy.js'), 'utf8');
    const body = src.slice(src.indexOf('export function requiresApproval'));
    const jira = body.indexOf('EXTERNAL_TOOLS.has(name)');
    const atl = body.indexOf("name === 'mcp_tool' && external");
    const sw = body.indexOf('mcpDecision(');
    assert.ok(jira > 0 && jira < atl && atl < sw, `${jira} ${atl} ${sw}`);
  });
});

describe('through the real loop', () => {
  for (const mode of ['plan', 'auto', 'strict']) {
    it(`${mode}: a write shows Send / Don't send, with no "always"; Don't send sends nothing`, async () => {
      const before = sent('createJiraIssue');
      const { l, panel, dir } = driven({ mode, answer: 'reject' });
      await l._executeToolCalls([call('createJiraIssue', { summary: 'x' })]);
      const box = boxes(panel);
      assert.equal(box.length, 1);
      assert.equal(box[0].payload.title, 'Send to Atlassian · createJiraIssue?');
      assert.deepEqual(box[0].payload.choices.map((c) => c.label), ['Send', "Don't send"]);
      assert.equal(sent('createJiraIssue'), before, 'Atlassian was never asked');
      assert.match(results(l)[0].result, /^User rejected/);
      const log = readdirSync(join(dir, '.agent', 'logs', 'commands')).map((f) => readFileSync(join(dir, '.agent', 'logs', 'commands', f), 'utf8')).join('');
      assert.match(log, /"risk":"external"/);
    });
  }

  it('Send sends it once', async () => {
    const before = sent('createJiraIssue');
    const { l } = driven({ mode: 'auto', answer: 'send' });
    await l._executeToolCalls([call('createJiraIssue', { summary: 'x' })]);
    assert.equal(sent('createJiraIssue'), before + 1);
    assert.match(results(l)[0].result, /createJiraIssue:ok/);
  });

  it('a tool not on the read list asks, even one Atlassian added later', async () => {
    const { l, panel } = driven({ mode: 'auto', answer: 'reject' });
    await l._executeToolCalls([call('archiveEverything')]);
    assert.equal(boxes(panel).length, 1);
    assert.equal(sent('archiveEverything'), 0);
  });

  it('an "always" answer cannot set a switch for a write', async () => {
    const { l } = driven({ mode: 'auto', answer: 'allow_always' });
    saveUserSettings({ mcpSwitches: {} });
    await l._executeToolCalls([call('createJiraIssue', { summary: 'y' })]);
    assert.equal(switchFor('atlassian', 'createJiraIssue'), 'ask');
    setSwitch('atlassian', 'createJiraIssue', 'auto');
  });

  it('the box drops "always" and keeps the switch for a write on its own, without alwaysAsk', async () => {
    // Each layer on its own: a server that does not "always ask" but whose
    // tool is an Atlassian write still gets Jira's box.
    const { l, panel } = driven({ mode: 'auto', answer: 'allow_always' });
    const real = mcp.alwaysAsks;
    mcp.alwaysAsks = () => false;
    saveUserSettings({ mcpSwitches: {} });
    try {
      await l._executeToolCalls([call('createJiraIssue', { summary: 'z' })]);
    } finally {
      mcp.alwaysAsks = real;
    }
    assert.deepEqual(boxes(panel)[0].payload.choices.map((c) => c.label), ['Send', "Don't send"]);
    assert.equal(switchFor('atlassian', 'createJiraIssue'), 'ask');
    setSwitch('atlassian', 'createJiraIssue', 'auto');
  });

  it('a read runs with no box, in strict too', async () => {
    const before = sent('getJiraIssue');
    const { l, panel } = driven({ mode: 'strict', answer: null });
    await l._executeToolCalls([call('getJiraIssue', { issueIdOrKey: 'P-1' })]);
    assert.equal(boxes(panel).length, 0);
    assert.equal(sent('getJiraIssue'), before + 1);
  });

  it('the handler refuses a write that skipped the box', async () => {
    const before = sent('createJiraIssue');
    const server = new MCPServer(mkdtempSync(join(tmpdir(), 'atl-h-')), null);
    const r = await server.executeTool('mcp_tool', { server: 'atlassian', tool: 'createJiraIssue', args: {} }, { mcp, mode: 'auto' });
    assert.equal(r.success, false);
    assert.match(r.error, /needs the user's approval/);
    assert.equal(sent('createJiraIssue'), before);
  });
});
