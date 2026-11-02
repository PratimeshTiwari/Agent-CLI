/**
 * The panels catch up with the terminal (v8.6): a stop button, and a footer
 * that says what the status bar says.
 *
 * Stopping from a panel used to be impossible — the side panel had no stop,
 * and the terminal's esc stopped the loop but never the tab: `stop_generation`
 * fell to the worker's default branch and went to the panel. `stopTurn()` is
 * now the one stop both use, so these pin what it does, and that a panel's
 * `stop_turn` reaches it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../src/backend/core/turn/agent-loop.js';
import { WebSocketServer } from '../../../src/backend/bridge/websocket-server.js';

function loop() {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'panel-stop-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: () => 'p', noteDrift() {}, resetPromptState() {} },
  });
  const toExtension = [];
  l._toExtension = (type) => toExtension.push(type);
  return { l, toExtension };
}

test('stopTurn stops the tab, the loop and whatever it was waiting on', () => {
  const { l, toExtension } = loop();
  const answers = {};
  l.isProcessing = true;
  l.pendingCommandResolve = (a) => { answers.command = a; };
  l.pendingQuestionResolve = (a) => { answers.question = a; };
  let aborted = 0;
  l.abortExtensionWork = () => { aborted++; };

  l.stopTurn();

  assert.deepEqual(toExtension, ['stop_generation'], 'the Gemini tab was never told');
  assert.equal(l.isProcessing, false);
  assert.equal(aborted, 1);
  assert.deepEqual(answers.command, { approved: false });
  assert.equal(answers.question.success, false);
  assert.equal(l.pendingCommandResolve, null);
  assert.equal(l.pendingQuestionResolve, null);
});

// Control: nothing pending is fine — a stop between turns must not throw.
test('stopTurn with nothing to cancel', () => {
  const { l } = loop();
  l.abortExtensionWork = () => {};
  assert.doesNotThrow(() => l.stopTurn());
});

test('panelState says the mode, effort, selected model and fill', () => {
  const { l } = loop();
  l.modelOptions = [{ label: '3.1 Flash' }, { label: '3.1 Pro', selected: true }];
  const s = l.panelState();
  assert.equal(s.mode, l.mode);
  assert.equal(typeof s.effort, 'string');
  assert.equal(s.model, '3.1 Pro');
  assert.ok(s.contextPct === null || Number.isInteger(s.contextPct));
});

test('panelState before the picker is read names no model', () => {
  const { l } = loop();
  l.modelOptions = [];
  assert.equal(l.panelState().model, null);
});

test("a panel's stop_turn reaches the loop", async () => {
  let stopped = 0;
  const agentLoop = { workspace: mkdtempSync(join(tmpdir(), 'panel-stop-')), setBackgroundCallbacks() {}, stopTurn() { stopped++; } };
  const bridge = new WebSocketServer({ port: 0, agentLoop });
  bridge.clients.set('c1', { type: 'extension', ws: { readyState: 0 } });
  await bridge._handleMessage('c1', { id: 'm1', type: 'stop_turn' });
  assert.equal(stopped, 1);
});

test('turn_idle carries the footer state', () => {
  const { l } = loop();
  const s = new WebSocketServer({ port: 0, agentLoop: l });
  const out = [];
  s.broadcast = (to, m) => { out.push(m); return true; };
  l.isProcessing = true;
  l.isProcessing = false;
  const idle = out.find((m) => m.type === 'turn_idle');
  assert.ok(idle);
  assert.equal(idle.payload.state.mode, l.mode);
});
