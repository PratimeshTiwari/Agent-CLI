/**
 * The busy indicator lasts as long as the turn does.
 *
 * Reported from use: "sometimes the bottom agent running indicator stops but
 * gemini runs, executes some command and output updates". Reproduced under the
 * pty: a reply of "I'll read the notes first" plus a `read_file` call put the
 * status bar back to `● agent` and removed `esc to stop` for the whole of the
 * next round, while the turn row above still read "Thinking…".
 *
 * Two causes with one symptom. The loop sends `agent_response` for prose that
 * comes *with* tool calls, and every front-end read that message as the end of
 * the turn. And a diff approval lowers the flag to draw its prompt, with
 * nothing to raise it when the loop carries on. Because the task panel draws
 * only when idle, the same flip also put the checklist under the prompt in the
 * middle of a turn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { buildAgentCallbacks } from '../../src/ui/hooks/use-agent-callbacks.js';

const TOOL_REPLY = "I'll read the notes first.\n```json\n"
  + '{"name": "read_file", "args": {"path": "notes.txt"}}\n```';

function loop() {
  const dir = mkdtempSync(join(tmpdir(), 'busy-'));
  const l = new AgentLoop({
    workspace: dir, mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: () => 'p', noteDrift() {} },
  });
  const panel = [];
  l.callbacks = { sendToPanel: (m) => panel.push(m), injectPrompt() {} };
  l.sessionStore = { appendTurn() {} };
  l._sendTaskList = () => {};
  l._executeToolCalls = async () => {};
  l._finishTurn = () => { l.isProcessing = false; };
  l.isProcessing = true;
  l._lastMainPrompt = 'p';
  return { l, panel };
}

test('prose that comes with tool calls is marked as continuing', async () => {
  const { l, panel } = loop();
  await l.handleGeminiResponse('m1', { content: TOOL_REPLY, complete: true });
  const response = panel.find((m) => m.type === 'agent_response');
  assert.ok(response, 'control: the prose is still shown');
  assert.equal(response.payload.continuing, true);
});

test('control: a final answer is not', async () => {
  const { l, panel } = loop();
  await l.handleGeminiResponse('m1', { content: 'The notes say PELICAN.', complete: true });
  const response = panel.find((m) => m.type === 'agent_response');
  assert.equal(response.payload.continuing, false);
});

/** The CLI's callbacks, with every setter recorded. */
function cli({ loopBusy }) {
  const busy = [];
  const agentLoop = { isProcessing: loopBusy, conversationHistory: [] };
  const noop = () => {};
  const cb = buildAgentCallbacks({
    agentLoop,
    isToolRunningRef: { current: false },
    setActiveMenu: noop, setActiveToolCalls: noop, setDiffRequest: noop, setFocus: noop,
    setHistory: noop, setInputAtEnd: noop, setPlanReviewReady: noop, setStatus: noop,
    setWalkthroughReady: noop,
    setIsProcessing: (v) => busy.push(v),
    wsServer: { broadcast: () => true },
  });
  return { cb, busy, agentLoop };
}

test('the CLI stays busy through prose that has tool calls behind it', () => {
  const { cb, busy } = cli({ loopBusy: true });
  cb.sendToPanel({ type: 'agent_response', payload: { content: 'reading', continuing: true } });
  assert.ok(!busy.includes(false), 'the spinner dropped while the turn went on');
});

test('control: a final answer still ends it', () => {
  const { cb, busy } = cli({ loopBusy: false });
  cb.sendToPanel({ type: 'agent_response', payload: { content: 'done' } });
  assert.deepEqual(busy, [false]);
});

test('reported work raises the flag again after anything lowered it', () => {
  const { cb, busy } = cli({ loopBusy: true });
  cb.requestDiffApproval({ diffId: 'd1' });
  cb.sendToPanel({ type: 'tool_call', payload: { name: 'read_file', args: {} } });
  cb.sendToPanel({ type: 'status', payload: { message: 'retrying in 3s' } });
  assert.deepEqual(busy, [false, true, true]);
});

test('control: a late status after a stop does not resurrect the spinner', () => {
  const { cb, busy } = cli({ loopBusy: false }); // `:stop` set the loop idle
  cb.sendToPanel({ type: 'status', payload: { message: 'late' } });
  cb.sendToPanel({ type: 'tool_call', payload: { name: 'read_file', args: {} } });
  assert.deepEqual(busy, []);
});

test('answering a diff raises the flag the prompt lowered', () => {
  // Source-level: exercising it needs a live React tree. The raise must be
  // gated on the loop, or rejecting the last edit of a turn would leave a
  // spinner running over an idle prompt.
  const app = readFileSync(new URL('../../src/ui/App.jsx', import.meta.url), 'utf8');
  const start = app.indexOf('const handleDiffResponse = (action) => {');
  assert.ok(start > -1);
  const body = app.slice(start, app.indexOf('\n  };', start));
  assert.match(body, /if \(agentLoop\.isProcessing\) setIsProcessing\(true\)/);
});
