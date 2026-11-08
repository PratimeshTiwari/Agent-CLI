/** The loop's half of the thinking level (v9.9.3). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../../src/backend/core/turn/agent-loop.js';
import { handleSlashCommand } from '../../../../src/backend/core/turn/slash-commands.js';
import { describeSettings } from '../../../../src/backend/core/workspace/settings.js';
import { stepThinking, thinkingLine } from '../../../../src/frontend/menus/effort-slider.js';
import { thinkingStops } from '../../../../src/backend/core/models/thinking.js';
import { statusBarLayout } from '../../../../src/frontend/screen/status-bar.js';

const level = (label, extra = {}) => ({ label, isMode: true, level: true, ...extra });
const OPTIONS = [
  { label: '3.1 Pro', isMode: false, selected: true },
  { label: 'Thinking level', isMode: true, submenu: true },
  level('Low', { selected: true }), level('Medium'), level('High'),
];

function loop() {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'thinking-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: () => 'p', noteDrift() {}, resetPromptState() {} },
  });
  l.modelOptions = OPTIONS.map((o) => ({ ...o }));
  const sent = [];
  l.extensionLock = { enqueue: (p) => sent.push(p) };
  const rows = [];
  l._notify = (text) => rows.push(text);
  return { l, sent, rows };
}

test('a main-lane prompt carries the level; a subagent prompt does not', () => {
  const { l, sent } = loop();
  l.modelConfig.effort = 'high';
  l._enqueueExtensionRequest({ prompt: 'p' });
  l._enqueueExtensionRequest({ prompt: 'q', isSubagent: true });
  assert.equal(sent[0].thinking, 'High', 'same as effort on high');
  assert.equal('thinking' in sent[1], false);
});

test('no levels on the account: the prompt carries none', () => {
  const { l, sent } = loop();
  l.modelOptions = OPTIONS.filter((o) => !o.isMode);
  l._enqueueExtensionRequest({ prompt: 'p' });
  assert.equal('thinking' in sent[0], false);
});

test('a level that fails is one row, not asked again until the setting changes', () => {
  const { l, sent, rows } = loop();
  l.modelConfig.effort = 'high';
  l.noteThinkingFailed({ wanted: 'High', stays: 'Low' });
  l.noteThinkingFailed({ wanted: 'High', stays: 'Low' });
  assert.deepEqual(rows, ['✗ Could not set thinking to High · stays Low']);
  l._enqueueExtensionRequest({ prompt: 'p' });
  assert.equal('thinking' in sent[0], false, 'retried into a loop');
  l.setThinking('medium');
  l._enqueueExtensionRequest({ prompt: 'p' });
  assert.equal(sent[1].thinking, 'Medium', 'a new setting is asked for');
});

test('a level picked by hand in the tab is noted; an old extension\'s silence changes nothing', () => {
  const { l } = loop();
  let redraws = 0;
  l.onModels(() => redraws++);
  l.noteSelectedModel('Pro', 'Medium');
  assert.equal(l.modelOptions.find((m) => m.level && m.selected).label, 'Medium');
  assert.equal(redraws, 1);
  l.noteSelectedModel('Pro');
  assert.equal(l.modelOptions.find((m) => m.level && m.selected).label, 'Medium', 'undefined is not "the lightest"');
});

test('/effort thinking: shows, pins, returns to same, refuses what is not there', async () => {
  const { l } = loop();
  l._saveConfig = () => {};
  const run = async (...args) => (await handleSlashCommand(l, 'effort', args)).message;
  assert.match(await run('thinking'), /same as effort.*\/effort thinking same\|low\|medium\|high/);
  assert.match(await run('thinking', 'high'), /thinking/);
  assert.equal(l.modelConfig.thinking, 'high');
  assert.match(await run('thinking', 'extreme'), /stays.*not a level here/);
  assert.equal(l.modelConfig.thinking, 'high');
  l.modelOptions = l.modelOptions.map((m) => (m.label === 'Medium' ? { ...m, locked: true } : m));
  assert.match(await run('thinking', 'medium'), /Medium is locked on this account/);
  await run('thinking', 'same');
  assert.equal(l.modelConfig.thinking, 'same');
});

test('/settings has a Thinking row only where the picker has levels', () => {
  const { l } = loop();
  assert.ok(describeSettings(l).some((r) => r.label === 'Thinking'));
  l.modelOptions = OPTIONS.filter((o) => !o.isMode);
  assert.equal(describeSettings(l).some((r) => r.label === 'Thinking'), false);
});

test('the slider row: steps past locked levels, says what same means and what is locked', () => {
  const stops = thinkingStops(OPTIONS.map((m) => (m.label === 'Medium' ? { ...m, locked: true } : m)));
  assert.equal(stepThinking(stops, 'low', 1), 'high', 'Medium is locked, so → skips it');
  assert.equal(stepThinking(stops, 'same', -1), 'same', 'stops at the end');
  const line = thinkingLine({ stops, at: 'same', rung: 'high', options: OPTIONS });
  assert.equal(line.value, '◂ same as effort ▸');
  assert.match(line.detail, /High {2}· Medium locked|High.*Medium locked/);
});

test('the status bar names the level beside the model, and drops it first', () => {
  const text = (o) => [...o.left, ...o.right].map((s) => s.text).join('');
  const wide = statusBarLayout({ width: 100, mode: 'plan', model: '3.1 Pro', thinking: 'medium' });
  assert.match(text(wide), /3\.1 Pro.*thinking medium/);
  const none = statusBarLayout({ width: 100, mode: 'plan', model: '3.1 Pro' });
  assert.doesNotMatch(text(none), /thinking/, 'no levels, no word');
});
