/**
 * A running command shows its last lines under its row, as Claude Code's Bash
 * rows do — inside the live budget, and only on the terminal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentCallbacks } from '../../src/frontend/hooks/use-agent-callbacks.js';
import { runningLayout, RUNNING_OUTPUT_LINES } from '../../src/frontend/transcript/live-layout.js';
import { elapsedLabel } from '../../src/frontend/transcript/status-rows.js';

function cli() {
  const state = { calls: [], history: [], broadcast: [] };
  const apply = (key) => (v) => { state[key] = typeof v === 'function' ? v(state[key]) : v; };
  const noop = () => {};
  const cb = buildAgentCallbacks({
    agentLoop: { isProcessing: true, conversationHistory: [], historyOffset: 0, mode: 'auto' },
    isToolRunningRef: { current: false },
    setActiveMenu: noop, setDiffRequest: noop, setFocus: noop, setInputAtEnd: noop,
    setPlanReviewReady: noop, setStatus: noop, setWalkthroughReady: noop, setIsProcessing: noop,
    setActiveToolCalls: apply('calls'),
    setHistory: apply('history'),
    wsServer: { broadcast: (_to, msg) => { state.broadcast.push(msg.type); return true; } },
  });
  return { cb, state };
}

const ten = Array.from({ length: 10 }, (_, i) => `l${i}`);

test('the tail lands on its own running call, and the clock starts at the first view', () => {
  const { cb, state } = cli();
  cb.sendToPanel({ type: 'tool_call', payload: { name: 'run_command', args: { command: 'npm test' } } });
  assert.equal(state.calls[0].runningSince, undefined, 'not counting while the approval prompt is up');
  cb.sendToPanel({ type: 'tool_output', payload: { name: 'run_command', lines: [], total: 0 } });
  const since = state.calls[0].runningSince;
  assert.ok(Number.isFinite(since));
  cb.sendToPanel({ type: 'tool_output', payload: { name: 'run_command', lines: ['ok 1'], total: 41 } });
  assert.deepEqual(state.calls[0].output, ['ok 1']);
  assert.equal(state.calls[0].outputTotal, 41);
  assert.equal(state.calls[0].runningSince, since, 'and later views do not restart it');
});

test('it never reaches the extension, and a stray one changes nothing', () => {
  const { cb, state } = cli();
  cb.sendToPanel({ type: 'tool_output', payload: { name: 'run_command', lines: ['x'], total: 1 } });
  assert.deepEqual(state.calls, [], 'no running call, nothing to attach to');
  cb.sendToPanel({ type: 'tool_call', payload: { name: 'run_command', args: {} } });
  cb.sendToPanel({ type: 'tool_output', payload: { name: 'run_command', lines: ['x'], total: 1 } });
  assert.deepEqual(state.broadcast, ['tool_call'], 'four a second to a side panel that draws none of them');
});

test('a tall terminal shows the last five lines, charged to the budget', () => {
  const calls = [{ id: 1, name: 'run_command', output: ten }];
  const l = runningLayout(calls, 30);
  assert.deepEqual(l.output, ten.slice(-RUNNING_OUTPUT_LINES));
  assert.equal(l.outputFor, 1);
  assert.equal(l.rows, 1 + 5 + 1, 'call row, five lines, margin');
});

test('a short terminal drops output before calls, and the turn keeps two rows', () => {
  const calls = [{ id: 1, name: 'read_file' }, { id: 2, name: 'run_command', output: ten }];
  for (let budget = 1; budget <= 12; budget += 1) {
    for (const compact of [false, true]) {
      const l = runningLayout(calls, budget, { compact });
      const turnRows = budget - l.rows;
      if (l.rows > 0) assert.ok(turnRows >= 2, `budget ${budget}: the turn was left ${turnRows}`);
      if (l.output.length) assert.equal(l.calls.length, Math.min(2, Math.floor(budget / 2)), 'output while a call was dropped');
    }
  }
  // Control: with room, both calls and the output are drawn.
  const roomy = runningLayout(calls, 20);
  assert.equal(roomy.calls.length, 2);
  assert.equal(roomy.output.length, 5);
});

test('output belongs to the call that produced it, not to the newest row', () => {
  const calls = [{ id: 1, name: 'run_command', output: ['building'] }, { id: 2, name: 'ask_subagent' }];
  assert.equal(runningLayout(calls, 20).outputFor, 1);
  assert.equal(runningLayout([{ id: 3, name: 'read_file' }], 20).output.length, 0, 'no output, no rows for it');
});

test('elapsed reads like a clock', () => {
  assert.equal(elapsedLabel(0), '0s');
  assert.equal(elapsedLabel(4_900), '4s');
  assert.equal(elapsedLabel(65_000), '1m 05s');
});
