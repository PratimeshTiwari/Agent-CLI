/**
 * A finished tool call leaves the live list and joins the transcript at once.
 *
 * Found while taking README screenshots: a running turn drew
 * `⏺ grep_search refunded · 1 match` from an earlier merge and, under it,
 * `✔ grep_search` again in the live list — every finished call twice, and the
 * duplicate charged to no budget. At 13x72 with a prompt queued that was 28
 * full clears in one harness run; 0 after.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentCallbacks } from '../../src/frontend/hooks/use-agent-callbacks.js';

function cli(loopHistory = []) {
  const state = { calls: [], history: [] };
  const apply = (key) => (v) => { state[key] = typeof v === 'function' ? v(state[key]) : v; };
  const noop = () => {};
  const agentLoop = { isProcessing: true, conversationHistory: loopHistory, historyOffset: 0, mode: 'auto' };
  const cb = buildAgentCallbacks({
    agentLoop,
    isToolRunningRef: { current: false },
    setActiveMenu: noop, setDiffRequest: noop, setFocus: noop, setInputAtEnd: noop,
    setPlanReviewReady: noop, setStatus: noop, setWalkthroughReady: noop, setIsProcessing: noop,
    setActiveToolCalls: apply('calls'),
    setHistory: apply('history'),
    wsServer: { broadcast: () => true },
  });
  return { cb, state, agentLoop };
}

test('a result removes its own call from the live list, by name', () => {
  const { cb, state } = cli();
  cb.sendToPanel({ type: 'tool_call', payload: { name: 'read_file', args: {} } });
  cb.sendToPanel({ type: 'tool_call', payload: { name: 'grep_search', args: {} } });
  // Parallel calls finish out of order: the read lands second.
  cb.sendToPanel({ type: 'tool_result', payload: { name: 'grep_search', success: true } });
  assert.deepEqual(state.calls.map((c) => c.name), ['read_file'],
    'the old code marked the *last* row finished whatever its name');
  cb.sendToPanel({ type: 'tool_result', payload: { name: 'read_file', success: true } });
  assert.equal(state.calls.length, 0, 'a finished call is still listed as live');
});

test('the transcript gains the call as it finishes, not at the next reply', () => {
  const loopHistory = [{ role: 'user', content: 'go', timestamp: 1 }];
  const { cb, state } = cli(loopHistory);
  cb.sendToPanel({ type: 'tool_call', payload: { name: 'grep_search', args: { pattern: 'x' } } });
  loopHistory.push(
    { role: 'system', type: 'tool_call', toolName: 'grep_search', args: { pattern: 'x' }, timestamp: 2 },
    { role: 'system', type: 'tool_result', toolName: 'grep_search', result: '1 match', success: true, timestamp: 3 },
  );
  cb.sendToPanel({ type: 'tool_result', payload: { name: 'grep_search', success: true } });
  assert.ok(state.history.some((m) => m.type === 'tool_result' && m.toolName === 'grep_search'),
    'the finished call is only drawn when the next agent_response merges');
});

test('control: a result with nothing running changes nothing', () => {
  const { cb, state } = cli();
  cb.sendToPanel({ type: 'tool_result', payload: { name: 'read_file', success: true } });
  assert.deepEqual(state.calls, []);
});
