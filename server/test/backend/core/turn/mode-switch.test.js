/**
 * Mode switching (v9.9.6): one accessor every writer goes through, so the
 * terminal and the panels both hear of a change, and a switch during a turn is
 * said in the next tool-results prompt on the current prompt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../../src/backend/core/turn/agent-loop.js';
import { PromptBuilder } from '../../../../src/backend/core/prompt/prompt-builder.js';
import { handleSlashCommand } from '../../../../src/backend/core/turn/slash-commands.js';

function bare() {
  const l = Object.create(AgentLoop.prototype);
  l.mode = 'plan';
  return l;
}

test('every writer tells the listeners and the panels, once per real change', async () => {
  const l = bare();
  const heard = [];
  let panels = 0;
  l.onModeChange((to, from) => heard.push(`${from}>${to}`));
  l.onPanelChange(() => { panels += 1; });
  l.mode = 'auto';
  l.mode = 'auto'; // control: no change, no news
  await handleSlashCommand(l, 'strict', []);
  assert.deepEqual(heard, ['plan>auto', 'auto>strict']);
  assert.equal(panels, 2);
});

test('a switch during a turn is kept once for the next prompt; one between turns is not', () => {
  const l = bare();
  l.mode = 'auto';
  assert.equal(l.takeModeSwitch(), null, 'control: idle, the next message says the mode anyway');
  l.isProcessing = true;
  l.mode = 'strict';
  assert.equal(l.takeModeSwitch(), 'strict');
  assert.equal(l.takeModeSwitch(), null, 'said once');
});

test('the tool-results prompt says it on the current prompt; v1 is frozen and does not (control)', () => {
  const ws = mkdtempSync(join(tmpdir(), 'mode-'));
  const results = [{ name: 'read_file', result: 'x' }];
  const current = new PromptBuilder(ws, ws);
  current.promptVersion = 'v7';
  assert.match(current.buildToolResultBatch(results, '', '', '', '', 'auto'), /switched to AUTO MODE while you worked/);
  assert.doesNotMatch(current.buildToolResultBatch(results), /switched to/, 'control: no switch, no line');
  const v1 = new PromptBuilder(ws, ws);
  v1.promptVersion = 'v1';
  assert.doesNotMatch(v1.buildToolResultBatch(results, '', '', '', '', 'auto'), /switched to/);
});

test('shift+tab at either approval box switches the mode before the modal guard (source)', () => {
  const src = readFileSync(new URL('../../../../src/frontend/hooks/use-key-bindings.js', import.meta.url), 'utf8');
  const at = src.indexOf("activeMenu?.type === 'command_approval')) {\n      cycleMode();");
  assert.ok(at > 0, 'the approval-box branch is gone');
  assert.ok(at < src.indexOf('if (diffRequest || activeMenu) return;'), 'it must run before the guard that makes keys inert');
});
