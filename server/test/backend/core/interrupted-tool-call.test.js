/**
 * A tool call the model interrupted with its own thinking is salvaged.
 *
 * Seen 2026-10-24 with Gemini "Argon": the reply starts a call, switches into a
 * `<thought>` inside the half-written string, then writes the complete call
 * after `</thought>` — all drawn by Gemini as one code block. The whole reply
 * was rejected as malformed and the model asked to repair it, round after
 * round, until Gemini refused outright.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../src/backend/core/turn/agent-loop.js';

function loop() {
  return new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'salvage-')), mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: () => 'p', noteDrift() {} },
  });
}

const INTERRUPTED = 'Let me check.\n```json\n{"name": "read_file", "args": {"path": "server/test/core<thought>\n'
  + 'We have read all the core prompt building files.\n</thought>\n\n```json\n'
  + '{"name": "list_directory", "args": {"path": ".agent/artifacts"}}\n```';

test('the complete call after the thought is taken; the interrupted one is dropped', () => {
  const { toolCalls } = loop()._extractToolCalls(INTERRUPTED);
  assert.deepEqual(toolCalls.map((c) => [c.name, c.args.path]), [['list_directory', '.agent/artifacts']]);
});

test('a repeated call is taken once', () => {
  // Argon re-emits the call after the thought; the duplicate sits inside the block.
  const cut = INTERRUPTED.lastIndexOf('\n```');
  const twice = `${INTERRUPTED.slice(0, cut)}\n{"name": "list_directory", "args": {"path": ".agent/artifacts"}}${INTERRUPTED.slice(cut)}`;
  assert.equal(loop()._extractToolCalls(twice).toolCalls.length, 1);
});

test('control: a broken call with no thought is still a repair round', () => {
  assert.throws(() => loop()._extractToolCalls('```json\n{"name": "read_file", "args": {"path": "a}\n```'), /Failed to parse/);
});

test('control: a thought with nothing complete after it salvages nothing', () => {
  const broken = '```json\n{"name": "read_file", "args": {"path": "a<thought>\nhmm\n</thought>\n{"x": 1}}\n```';
  assert.throws(() => loop()._extractToolCalls(broken), /Failed to parse/,
    'an object after the thought that is not a call must not be taken as one');
});
