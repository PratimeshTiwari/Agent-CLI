/**
 * v5 is v4 until a server is usable (v9.1), so a person with none pays nothing,
 * and v1–v4 never read a server's config.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptBuilder } from '../../../src/backend/core/prompt/prompt-builder.js';
import { PROMPT_VERSIONS, versionAdds } from '../../../src/backend/core/prompt/prompt-versions.js';

const ws = mkdtempSync(join(tmpdir(), 'v5-'));
const SERVERS = [{ name: 'files', tools: [{ name: 'read_it', description: 'reads it' }] }];

function builder(version, servers) {
  const pb = new PromptBuilder(ws, ws);
  pb.promptVersion = version;
  pb.jiraAvailable = true;
  pb.mcpServers = () => servers;
  return pb;
}

const turn0 = (pb, effort) => pb.buildPrompt({ userMessage: 'hi', history: [], modelConfig: { effort, main: 'gemini' } });

describe('prompt v5', () => {
  it('is v4 plus one switch', () => {
    const { customMcp, ...rest } = PROMPT_VERSIONS.v5.flags;
    assert.equal(customMcp, true);
    assert.deepEqual(rest, PROMPT_VERSIONS.v4.flags);
    assert.equal(versionAdds('v5').lines.length, 1);
  });

  it('with no server, the whole prompt is v4 byte for byte', async () => {
    for (const effort of ['low', 'medium', 'high']) {
      const a = await turn0(builder('v4', []), effort);
      const b = await turn0(builder('v5', []), effort);
      assert.ok(String(a).length > 1000, 'control: a real prompt');
      assert.equal(b, a, effort);
    }
  });

  it('with one, turn 0 has the tools and the block, on every rung', async () => {
    for (const effort of ['low', 'medium', 'high']) {
      const text = String(await turn0(builder('v5', SERVERS), effort));
      assert.match(text, /## mcp_tool/, effort);
      assert.match(text, /## mcp_describe/, effort);
      assert.match(text, /<mcp_servers>\n[^]*- read_it: reads it/, effort);
      assert.match(text, /run at once/, effort);
    }
  });

  it('no earlier version reads a server, even with one set', async () => {
    let asked = 0;
    for (const v of ['v1', 'v2', 'v3', 'v4']) {
      const pb = builder(v, SERVERS);
      pb.mcpServers = () => { asked += 1; return SERVERS; };
      const text = String(await turn0(pb, 'high'));
      assert.doesNotMatch(text, /mcp_tool|mcp_servers/, v);
    }
    assert.equal(asked, 0);
  });

  it('the anchor follows a server added mid-session', () => {
    const pb = builder('v5', []);
    const before = pb._buildToolAnchor(true, { effort: 'low' });
    pb.mcpServers = () => SERVERS;
    const after = pb._buildToolAnchor(true, { effort: 'low' });
    assert.ok(!before.includes('mcp_tool'));
    assert.ok(after.includes('mcp_tool'), 'not stuck on the cached list');
  });

  it('both forms say what a result is', () => {
    for (const effort of ['low', 'high']) {
      const t = builder('v5', SERVERS)._buildToolDefinitions(true, { effort });
      assert.match(t, /data/, effort);
      assert.match(t, /separate replies/, effort);
    }
  });
});
