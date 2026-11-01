/**
 * A model picked by hand in the tab reaches the CLI when it happens (v7.9).
 *
 * Reported: switched the tab to Flash after "Ready", and the ⚠ appeared about a
 * minute later, after the next reply. The list was only read at connect, on a
 * new tab and at the end of a turn. Extension 1.55.0 watches the picker's label
 * and sends `model_selected`; the loop marks it in the list it already has.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AgentLoop } from '../../../src/backend/core/turn/agent-loop.js';

const LIST = [
  { label: '3.1 Flash-Lite' }, { label: '3.8 Flash' }, { label: '3.1 Pro', selected: true },
  { label: 'Extended thinking', isMode: true, selected: true },
];

function loop() {
  const l = Object.create(AgentLoop.prototype);
  const asked = [];
  const seen = [];
  Object.assign(l, { modelOptions: LIST.map((m) => ({ ...m })), requestModelOptions: (u) => asked.push(u) });
  l.onModels((models) => seen.push(models.find((m) => m.selected && !m.isMode)?.label));
  return { l, asked, seen };
}

const selected = (l) => l.modelOptions.filter((m) => m.selected && !m.isMode).map((m) => m.label);

test('the picker\'s short name marks the one entry it ends', () => {
  const { l, seen } = loop();
  l.noteSelectedModel('Flash');
  assert.deepEqual(selected(l), ['3.8 Flash'], 'not 3.1 Flash-Lite');
  assert.deepEqual(seen, ['3.8 Flash'], 'the screen is told, so an idle frame redraws');
  assert.ok(l.modelOptions.find((m) => m.isMode).selected, 'a mode is left as it was');
});

test('an exact name wins; the same selection again is quiet', () => {
  const { l, seen } = loop();
  l.noteSelectedModel('3.1 Pro');
  assert.deepEqual(seen, [], 'nothing changed');
  l.noteSelectedModel('3.1 Flash-Lite');
  assert.deepEqual(selected(l), ['3.1 Flash-Lite']);
});

test('a name that matches nothing, or two things, asks for the list instead', () => {
  const { l, asked } = loop();
  l.noteSelectedModel('Ultra');
  l.modelOptions.push({ label: '3.9 Flash' });
  l.noteSelectedModel('Flash');
  assert.deepEqual(asked, [false, false], 'a background ask: it must not open a tab');
  assert.deepEqual(selected(l), ['3.1 Pro'], 'control: no guess was written');
});

test('the worker relays it and the bridge watches the label', () => {
  const worker = readFileSync(new URL('../../../../extension/src/background/main.js', import.meta.url), 'utf8');
  assert.match(worker, /case 'model_selected':[^]*?sendToServer\(\{ type, payload \}\)/);
  const bridge = readFileSync(new URL('../../../../extension/content-scripts/gemini-bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /safeSend\(\{ type: 'model_selected', payload: \{ label: now \} \}\)/);
  assert.match(bridge, /onInvalidated\.push\(\(\) => \{\n\s*clearInterval\(modelWatch\)/, 'an orphaned bridge stops watching');
  const server = readFileSync(new URL('../../../src/backend/bridge/websocket-server.js', import.meta.url), 'utf8');
  assert.match(server, /case 'model_selected':\n[^]*?noteSelectedModel/);
});
