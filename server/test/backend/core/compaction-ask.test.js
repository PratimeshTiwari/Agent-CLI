import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../src/backend/core/agent-loop.js';
import { contextText, statusBarLayout } from '../../../src/frontend/status-bar.js';

/*
 * v7.5. Owner: "before auto-compact, lets give user option, auto-compact now
 * or continue using, we will stop user once and lets not force it".
 */
function loop(tokens) {
  const l = new AgentLoop({
    workspace: mkdtempSync(join(tmpdir(), 'cask-')),
    mcpServer: {}, diffEngine: {}, riskClassifier: {},
    promptBuilder: { buildPrompt: () => 'p', noteDrift() {}, resetPromptState() {} },
  });
  Object.defineProperty(l, 'contextTokens', { get: () => tokens.value, configurable: true });
  l.modelConfig = { ...l.modelConfig, effort: 'high' };
  return l;
}

test('past the threshold it asks; below it, it does not', () => {
  const tokens = { value: 1000 };
  const l = loop(tokens);
  assert.equal(l.compactionToAsk(), null, 'control: far below the threshold');
  tokens.value = Math.round(l.contextLimit * 0.85);
  const ask = l.compactionToAsk();
  assert.equal(ask.pct, 85);
  assert.equal(ask.limit, l.contextLimit);
});

test('"continue" stops the asking and the compacting for this chat only', () => {
  const tokens = { value: 0 };
  const l = loop(tokens);
  tokens.value = Math.round(l.contextLimit * 0.9);
  assert.equal(l._wantsCompaction(), true);
  l.declineCompaction();
  assert.equal(l.compactionToAsk(), null, 'asked once');
  assert.equal(l._wantsCompaction(), false, 'and not forced');
  // `/compact` still runs when asked for.
  l._compactAfterTurn = true;
  assert.equal(l._wantsCompaction(), true);
  l._compactAfterTurn = false;
  // A new chat is a new decision.
  l.extensionLock = { isBusy: () => false };
  l._toExtension = () => {};
  l.startNewChat({ timeoutMs: 1 }).catch(() => {});
  assert.equal(l._compactDeclined, false);
  assert.ok(l.compactionToAsk());
});

test('the status bar stops counting down once declined', () => {
  assert.equal(contextText(85, 80), '0% to compact');
  assert.equal(contextText(85, null), '85%');
  // Through the layout too: a `??` default once turned the null back into 80.
  const text = (o) => statusBarLayout({ width: 100, mode: 'plan', effort: 'high', pct: 85, meter: '▰▰▰▰▱', ...o })
    .right.map((f) => f.text).join(' ');
  assert.match(text({ compactAtPct: null }), /85%/);
  assert.doesNotMatch(text({ compactAtPct: null }), /to compact/);
  assert.match(text({}), /to compact/, 'control: the default still counts down');
});

test('the terminal asks after the mismatch ask, and esc gives the message back', () => {
  const app = readFileSync(new URL('../../../src/frontend/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /const mismatchAsk[\s\S]{0,700}const compactAsk = opts\.compaction \? null : agentLoop\.compactionToAsk\?\.\(\);/);
  assert.match(app, /if \(!opts\.mismatch && !opts\.compaction\) setInputHistory/);
  const menus = readFileSync(new URL('../../../src/frontend/components/Menus.jsx', import.meta.url), 'utf8');
  assert.match(menus, /activeMenu\?\.type === 'effort_mismatch' \|\| activeMenu\?\.type === 'compaction_ask'\) \{\s*setActiveMenu\(null\);\s*setFocus\(FOCUS_INPUT\);\s*setInputAtEnd\(activeMenu\.query\)/);
  assert.match(menus, /if \(item\.value === 'continue'\) agentLoop\.declineCompaction\(\);\s*handleSubmit\(query, \{ \.\.\.opts, compaction: item\.value \}\)/);
});
