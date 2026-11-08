/**
 * Features are every version's (v9.9.5). Jira (first prompt v4) and MCP servers
 * (first v5) are offered on v1 and v7 alike once set up, and change nothing
 * until then — so v1 with nothing set up stays its frozen bytes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptBuilder } from '../../../src/backend/core/prompt/prompt-builder.js';
import { FEATURES, PROMPT_VERSION_IDS } from '../../../src/backend/core/prompt/prompt-versions.js';

const ws = mkdtempSync(join(tmpdir(), 'features-'));
const SERVERS = [{ name: 'files', tools: [{ name: 'read_it', description: 'reads it' }] }];

function builder(version, { jira = false, servers = [] } = {}) {
  const pb = new PromptBuilder(ws, ws);
  pb.promptVersion = version;
  pb.jiraAvailable = jira;
  pb.mcpServers = () => servers;
  return pb;
}
const defs = (pb, effort) => ({ text: pb._buildToolDefinitions(true, { effort }), anchor: pb._buildToolAnchor(true, { effort }) });
const turn0 = (pb, effort) => pb.buildPrompt({ userMessage: 'hi', history: [], modelConfig: { effort, main: 'gemini' } });

describe('features on every version', () => {
  it('the versions are v1 and v7, and the features are not version switches', () => {
    assert.deepEqual(PROMPT_VERSION_IDS, ['v1', 'v7']);
    assert.deepEqual(Object.keys(FEATURES).sort(), ['customMcp', 'jira', 'memoryFolder', 'saveNudge']);
  });

  for (const version of ['v1', 'v7']) {
    it(`${version}: Jira is offered once a site is set up, in the definitions and the anchor`, () => {
      for (const effort of ['low', 'medium', 'high']) {
        const off = defs(builder(version), effort);
        const on = defs(builder(version, { jira: true }), effort);
        assert.ok(!off.text.includes('## jira_issue'), `control: ${effort} without a site`);
        assert.ok(on.text.includes('## jira_issue'), effort);
        assert.match(on.anchor, / jira_issue /);
      }
    });

    it(`${version}: MCP servers are offered once one is usable, and turn 0 names them`, async () => {
      for (const effort of ['low', 'medium', 'high']) {
        const none = String(await turn0(builder(version), effort));
        const one = String(await turn0(builder(version, { servers: SERVERS }), effort));
        assert.doesNotMatch(none, /mcp_tool|<mcp_servers>/, `control: ${effort} with none`);
        assert.match(one, /## mcp_tool/, effort);
        assert.match(one, /<mcp_servers>\n[^]*- read_it: reads it/, effort);
      }
    });
  }

  it('the anchor follows a sign-in and a server added mid-session', () => {
    const pb = builder('v1');
    const before = pb._buildToolAnchor(true, { effort: 'low' });
    pb.jiraAvailable = true;
    pb.mcpServers = () => SERVERS;
    const after = pb._buildToolAnchor(true, { effort: 'low' });
    assert.ok(!before.includes('jira_issue') && !before.includes('mcp_tool'));
    assert.ok(after.includes('jira_issue') && after.includes('mcp_tool'), 'not stuck on the cached list');
  });

  it('Jira says every write asks, not to retry a rejection, and how to hand off', () => {
    for (const effort of ['low', 'high']) {
      const t = defs(builder('v7', { jira: true }), effort).text;
      const start = t.indexOf('## jira_issue');
      const block = t.slice(start, t.indexOf('## ', start + 3));
      assert.match(block, /asks\s+the\s+user\s+first|only\s+sent\s+if\s+they\s+approve/, effort);
      assert.match(block, /do\s+not\s+retry/, effort);
      assert.match(block, /HANDED OFF/, effort);
    }
  });

  it('an MCP result is described as data', () => {
    for (const effort of ['low', 'high']) {
      const t = builder('v1', { servers: SERVERS })._buildToolDefinitions(true, { effort });
      assert.match(t, /data/, effort);
      assert.match(t, /separate replies/, effort);
    }
  });
});
