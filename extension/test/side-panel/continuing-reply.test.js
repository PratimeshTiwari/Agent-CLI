/**
 * Prose that comes with tool calls does not end the turn in the panel.
 *
 * The server marks it `continuing` (agent-loop's `agent_response`). The panel
 * re-enabled Send and removed "Thinking..." on every `agent_response`, so a
 * reply of "I'll read the file first" plus a tool call left the panel looking
 * idle while the tools ran and Gemini wrote the next round — and a prompt sent
 * then was handed to a loop that was still busy. The same page is the editor
 * panel (v5.2), so this covers both.
 *
 * Source-level: the case lives inside the panel's message switch, which needs
 * the whole page and a socket to reach.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const src = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../side-panel/panel.js'), 'utf8');

const arm = (() => {
  const start = src.indexOf("case 'agent_response': {");
  assert.ok(start > -1, 'control: the case exists');
  return src.slice(start, src.indexOf('\n    }\n', start));
})();

test('a continuing reply keeps the panel busy', () => {
  const branch = arm.indexOf('if (payload.continuing)');
  assert.ok(branch > -1, 'every agent_response ends the turn in the panel');
  const idle = arm.indexOf('isWaitingForResponse = false');
  assert.ok(idle > branch, 'Send is re-enabled before the continuing check, so it fires anyway');
  assert.match(arm.slice(branch, idle), /showThinking\(\)/, 'the indicator is gone for the next round');
  assert.match(arm.slice(branch, idle), /break;/);
});

test('a continuing reply still draws its prose', () => {
  // The early `break` must come after the message is appended, or staying
  // busy would cost the user the text that said what the agent is doing.
  const draw = arm.indexOf("appendMessage('agent', body)");
  assert.ok(draw > -1);
  assert.ok(draw < arm.indexOf('if (payload.continuing)'));
});
