import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../src/backend/core/turn/agent-loop.js';

/*
 * v7.3: the compaction budgets in `effort.js` are guesses, and nothing that
 * could test them recorded how full the thread was. Each of these does now.
 */
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('contextFill is the token count and the active rung\'s budget', () => {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'fill-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: () => 'p', noteDrift() {}, resetPromptState() {} },
  });
  const fill = l.contextFill;
  assert.equal(fill.contextTokens, l.contextTokens);
  assert.equal(fill.contextLimit, l.contextLimit);
  assert.ok(fill.contextLimit > 0);
});

test('provider errors, tool amnesia, compactions and traces carry it', () => {
  const loop = read('../../../src/backend/core/turn/agent-loop.js');
  assert.match(loop, /op: 'provider_error',[\s\S]{0,200}\.\.\.this\.contextFill/);
  assert.match(loop, /op: 'tool_amnesia',[\s\S]{0,250}meta: \{ \.\.\.this\.contextFill \}/);
  const compaction = read('../../../src/backend/core/turn/compaction.js');
  // Read before the summary is asked for, or a reset would record zero.
  assert.match(compaction, /const fill = loop\.contextFill \?\? \{\};\s*\n\s*const asked = await loop\._askThread/);
  assert.match(compaction, /kept: countTurns\(toKeep\), \.\.\.fill \}/);
  assert.match(read('../../../src/backend/bridge/websocket-server.js'), /logTrace\([\s\S]{0,400}\.\.\.\(this\.agentLoop\?\.contextFill \?\? \{\}\)/);
});
