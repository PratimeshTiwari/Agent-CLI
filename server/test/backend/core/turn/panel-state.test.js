/**
 * What a panel is told about the agent (v8.8): enough to draw its two menus
 * without keeping a copy of the ladder or the modes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop } from '../../../../src/backend/core/turn/agent-loop.js';
import { WebSocketServer } from '../../../../src/backend/bridge/websocket-server.js';

const state = (fields) => AgentLoop.prototype.panelState.call({
  mode: 'plan', modelConfig: { effort: 'high' }, contextLimit: 100, contextTokens: 7, ...fields,
});

test('each rung names the model it maps to on this account', () => {
  const { efforts } = state({
    modelOptions: [{ label: '3.1 Flash-Lite' }, { label: '3.8 Flash' }, { label: '3.1 Pro', selected: true }],
  });
  assert.deepEqual(efforts.map((e) => e.id), ['low', 'medium', 'high', 'max']);
  assert.equal(efforts.find((e) => e.id === 'low').model, '3.1 Flash-Lite');
  assert.equal(efforts.find((e) => e.id === 'high').model, '3.1 Pro');
  const max = efforts.find((e) => e.id === 'max');
  assert.equal(max.available, false, 'Max without Argon must be refused, as in the terminal');
  assert.equal(max.model, 'not on this account');
});

test('Max is offered where Argon exists', () => {
  const { efforts } = state({ modelOptions: [{ label: '3.8 Flash' }, { label: '3.1 Pro' }, { label: '4 Argon' }] });
  const max = efforts.find((e) => e.id === 'max');
  assert.equal(max.available, true);
  assert.equal(max.model, '4 Argon');
});

test('an unread picker offers every rung by the tab it expects', () => {
  const { efforts, model } = state({ modelOptions: [] });
  assert.equal(model, null);
  assert.ok(efforts.every((e) => e.available));
  assert.equal(efforts.find((e) => e.id === 'high').model, 'Gemini Pro');
});

test('the modes come with what each one does, without its name', () => {
  const { modes } = state({});
  assert.deepEqual(modes.map((m) => m.id), ['plan', 'auto', 'strict']);
  assert.ok(modes.every((m) => m.about && !m.about.startsWith(m.id)), JSON.stringify(modes));
});

test('a command\'s answer carries the state after it, and survives having no answer', async () => {
  const sent = [];
  const agentLoop = {
    handleSlashCommand: async (command) => (command === 'quiet' ? undefined : { message: 'ok' }),
    panelState: () => ({ effort: 'low' }),
    setBackgroundCallbacks() {},
  };
  const server = new WebSocketServer({ port: 0, agentLoop });
  server.clients.set('c', { ws: {} });
  server._send = (_ws, msg) => sent.push(msg);
  await server._handleSlashCommand('c', 'id', { command: 'effort', args: ['low'] });
  await server._handleSlashCommand('c', 'id2', { command: 'quiet', args: [] });
  assert.deepEqual(sent[0].payload, { message: 'ok', state: { effort: 'low' } });
  assert.deepEqual(sent[1].payload, { state: { effort: 'low' } });
});

/* The footer was one switch behind: `/effort`'s result leaves before the tab moves. */
function bridgeOverALoop() {
  const sent = [];
  const loop = Object.create(AgentLoop.prototype);
  // Both are getters on the class, over state this test has no reason to build.
  Object.defineProperty(loop, 'contextLimit', { value: 100 });
  Object.defineProperty(loop, 'contextTokens', { value: 7 });
  Object.assign(loop, {
    mode: 'plan', modelConfig: { effort: 'low' }, workspace: '/x',
    modelOptions: [{ label: '3.5 Flash-Lite' }, { label: '3.8 Flash' }, { label: '3.1 Pro', selected: true }],
    setBackgroundCallbacks() {}, onIdle() {}, _notify() {},
  });
  const server = new WebSocketServer({ port: 0, agentLoop: loop });
  server.broadcast = (_to, msg) => sent.push(msg);
  return { loop, sent };
}

test('a switch that lands reaches the panels with the tab\'s model', () => {
  const { loop, sent } = bridgeOverALoop();
  loop._switchInFlight = { label: '3.5 Flash-Lite' };
  assert.equal(loop.panelState().switching, true, 'the old model is not a mismatch yet');
  loop.noteModelOptions(
    [{ label: '3.5 Flash-Lite', selected: true }, { label: '3.8 Flash' }, { label: '3.1 Pro' }],
    '3.5 Flash-Lite', '3.5 Flash-Lite',
  );
  const pushed = sent.filter((m) => m.type === 'panel_state');
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].payload.state.model, '3.5 Flash-Lite');
  assert.equal(pushed[0].payload.state.switching, false, 'a real disagreement must show once it stands');
});

test('a model picked by hand in the tab reaches the panels too', () => {
  const { loop, sent } = bridgeOverALoop();
  loop.noteSelectedModel('3.8 Flash');
  assert.equal(sent.at(-1).type, 'panel_state');
  assert.equal(sent.at(-1).payload.state.model, '3.8 Flash');
});

test('the same model again says nothing', () => {
  const { loop, sent } = bridgeOverALoop();
  loop.noteSelectedModel('3.1 Pro');
  assert.equal(sent.length, 0);
});
