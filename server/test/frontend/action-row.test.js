/*
 * Action rows in Claude Code's shape (v6.5): `● Run(npm test) · exit 0 · 3.2s`
 * collapsed, the output and outcome under `⎿` expanded. The verb comes from
 * the catalog, which the side panel is sent too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_CATALOG, toolVerb } from '../../src/backend/core/tool-catalog.js';
import {
  actionVerb, actionState, actionHead, actionOutcome, durationLabel, commandOutputLines, STATE_TONE,
} from '../../src/frontend/action-row.js';

const shell = (exitCode, stdout = '', extra = {}) => ({ exitCode, stdout, stderr: '', command: 'npm test', ...extra });

test('every catalog tool has a one-word verb, and the panel and terminal read the same table', () => {
  for (const t of TOOL_CATALOG) {
    assert.match(t.verb || '', /^[A-Z][a-z]+$/, `${t.name} has no verb`);
    assert.equal(actionVerb(t.name), t.verb);
  }
  assert.equal(toolVerb('run_command'), 'Run');
  assert.equal(toolVerb('edit_file'), 'Edit');
  assert.equal(toolVerb('create_file'), 'Write');
  assert.equal(toolVerb('no_such_tool'), 'no_such_tool', 'an unknown tool keeps its name');
});

test('the head is Verb(subject), or the bare verb with nothing to name', () => {
  assert.equal(actionHead('run_command', { command: 'npm test' }), 'Run(npm test)');
  assert.equal(actionHead('read_file', { path: 'server/src/ui/format.js' }), 'Read(server/src/ui/format.js)');
  assert.equal(actionHead('manage_task', { action: 'list' }), 'Task');
});

test('state: running, done, failed, rejected — a non-zero exit is a failure', () => {
  assert.equal(actionState({ toolName: 'run_command', result: null, success: null }), 'running');
  assert.equal(actionState({ toolName: 'run_command', result: shell(0), success: true }), 'done');
  assert.equal(actionState({ toolName: 'run_command', result: shell(1), success: true }), 'failed');
  assert.equal(actionState({ toolName: 'run_command', result: shell(0, '', { timedOut: true }), success: true }), 'failed');
  assert.equal(actionState({ toolName: 'read_file', result: 'ENOENT', success: false }), 'failed');
  assert.equal(actionState({ toolName: 'run_command', result: 'User rejected command execution.', success: false }), 'rejected');
  assert.equal(actionState({ toolName: 'edit_file', result: 'User REJECTED the edit to a.js.', success: false }), 'rejected');
  // Every state has a colour role.
  for (const s of ['running', 'done', 'failed', 'rejected']) assert.ok(STATE_TONE[s]);
});

test('a command\'s outcome is its exit and how long it ran', () => {
  const act = { toolName: 'run_command', result: shell(0, 'ok'), success: true, resultMsg: { ms: 3200 } };
  assert.equal(actionOutcome(act), 'exit 0 · 3.2s');
  assert.equal(actionOutcome({ ...act, resultMsg: {} }), 'exit 0', 'an older record has no duration');
  assert.equal(actionOutcome({ ...act, result: shell(0, '', { timedOut: true }) }), 'timed out · 3.2s');
});

test('other outcomes keep their shapes; a rejection says so plainly', () => {
  const patch = '--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n-a\n+b\n+c';
  assert.equal(actionOutcome({ toolName: 'edit_file', result: { filePath: 'x', patch }, success: true }), '+2 −1');
  assert.equal(actionOutcome({ toolName: 'read_file', result: { totalLines: 1240 }, success: true }), '1240 lines');
  assert.equal(actionOutcome({ toolName: 'edit_file', result: 'User REJECTED the edit.', success: false }),
    'rejected — nothing written');
  assert.equal(actionOutcome({ toolName: 'run_command', result: null, success: null }), '', 'nothing while running');
});

test('durations: tenths under ten seconds, then seconds, then minutes', () => {
  assert.equal(durationLabel(3240), '3.2s');
  assert.equal(durationLabel(48_000), '48s');
  assert.equal(durationLabel(125_000), '2m 05s');
  assert.equal(durationLabel(undefined), '');
  assert.equal(durationLabel(40), '', 'too fast to be worth a number');
});

test('expanded command output is capped with Claude Code\'s marker', () => {
  const out = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const lines = commandOutputLines(shell(0, out), { lines: 5 });
  assert.deepEqual(lines.slice(0, 5), ['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);
  assert.equal(lines[5], '… +25 lines');
  assert.deepEqual(commandOutputLines(shell(0, '')), ['(no output)']);
  assert.deepEqual(commandOutputLines({ totalLines: 3 }), [], 'not a shell result');
});

test('a call the schema refused says which argument, in a few words (v8.0)', async () => {
  const { validateArgs } = await import('../../src/backend/mcp/validate-args.js');
  const { actionOutcome } = await import('../../src/frontend/action-row.js');
  const spec = { query: { type: 'string', required: true }, maxResults: { type: 'number' } };
  const missing = validateArgs('grep_search', spec, { pattern: 'x' });
  assert.equal(actionOutcome({ toolName: 'grep_search', success: false, result: { success: false, error: missing.message } }),
    'wrong arguments · query missing');
  assert.equal(actionOutcome({ toolName: 'grep_search', success: false, result: missing.message }),
    'wrong arguments · query missing', 'as a bare string too');
  const wrongType = validateArgs('grep_search', spec, { query: 'x', maxResults: 'lots' });
  assert.match(actionOutcome({ toolName: 'grep_search', success: false, result: wrongType.message }),
    /^wrong arguments · maxResults got "lots"$/);
});
