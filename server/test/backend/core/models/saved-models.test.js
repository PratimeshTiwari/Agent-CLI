/**
 * The last model list, kept across launches for display (v9.9.9.4).
 *
 * Owner, 2026-11-23: "on first start, the agent does not load the model names
 * and efforts". Validated first: the list was memory only, and the read at
 * connect found no tab 414 times in this repo's log.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSavedModels, saveModels, savedModelsPath } from '../../../../src/backend/core/models/saved-models.js';
import { AgentLoop } from '../../../../src/backend/core/turn/agent-loop.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'saved-models-')), 'models.json');
const LIST = [
  { label: '3.1 Flash-Lite' }, { label: '3 Flash' }, { label: '3.1 Pro', selected: true },
  { label: 'Extended thinking', isMode: true },
];

test('saved and read back per profile, with the tick taken off', () => {
  const f = file();
  saveModels(LIST, 'install-a', { file: f });
  saveModels([{ label: '4 Hydrogen' }, { label: '4 Argon' }], 'install-b', { file: f });
  const a = loadSavedModels('install-a', { file: f });
  assert.deepEqual(a.map((m) => m.label), ['3.1 Flash-Lite', '3 Flash', '3.1 Pro', 'Extended thinking']);
  assert.ok(a.every((m) => !('selected' in m)), 'a stale tick would read as the tab disagreeing');
  assert.deepEqual(loadSavedModels('install-b', { file: f }).map((m) => m.label), ['4 Hydrogen', '4 Argon']);
  assert.deepEqual(loadSavedModels('nobody', { file: f }), []);
});

test('a failed read is never saved over a good list', () => {
  const f = file();
  saveModels(LIST, 'default', { file: f });
  assert.equal(saveModels([], 'default', { file: f }), null);
  assert.equal(saveModels([{ label: 'Extended thinking', isMode: true }], 'default', { file: f }), null);
  assert.equal(loadSavedModels('default', { file: f }).length, 4);
});

test('nothing saved, or a broken file: an empty list, never a throw', () => {
  const f = file();
  assert.deepEqual(loadSavedModels('default', { file: f }), []);
  assert.equal(existsSync(f), false);
});

const loop = () => new AgentLoop({
  workspace: mkdtempSync(join(tmpdir(), 'saved-loop-')),
  mcpServer: {}, diffEngine: {}, riskClassifier: {}, promptBuilder: {},
});

test('a new launch shows the last list until the tab answers, and decides nothing with it', () => {
  const first = loop();
  first.noteModelOptions(LIST);
  assert.ok(existsSync(savedModelsPath()), 'written under the agent home');
  assert.match(readFileSync(savedModelsPath(), 'utf8'), /3\.1 Pro/);

  const next = loop();                         // the next launch: no tab yet
  assert.deepEqual(next.modelOptions ?? [], [], 'the live list is still empty');
  assert.deepEqual(next.shownModelOptions.map((m) => m.label), ['3.1 Flash-Lite', '3 Flash', '3.1 Pro', 'Extended thinking']);
  // The panels show it too, Max left out (no Argon on this account).
  assert.deepEqual(next.panelState().efforts.map((e) => e.id), ['low', 'medium', 'high']);
  assert.equal(next.panelState().efforts.find((e) => e.id === 'high').model, '3.1 Pro');
  assert.equal(next.panelState().model, null, 'nothing is claimed about the tab');

  // The tab answers: the live list wins.
  next.noteModelOptions([{ label: '3 Flash', selected: true }, { label: '3.1 Pro' }, { label: '4 Argon' }]);
  assert.deepEqual(next.shownModelOptions.map((m) => m.label), ['3 Flash', '3.1 Pro', '4 Argon']);
});
