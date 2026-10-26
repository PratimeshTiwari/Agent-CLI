/**
 * The prompt follows the model the tab is on (C0).
 *
 * Owner, 2026-10-26: *"if there is model mismatch, send the prompt as per the
 * current model selected"*. Every prompt used to be built from
 * `modelConfig.effort`, so a tab left on Flash with effort High got the 25k pro
 * prompt — the long prompt to the model that handles long prompts worst.
 *
 * Built on a real `PromptBuilder` in a temp workspace, because the claim is
 * about what is typed into the tab, and a stub would only echo the effort back.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { PromptBuilder } from '../../src/core/prompt-builder.js';
import { rungForModel } from '../../src/core/model-match.js';

const THREE = (selected) => ['3.1 Flash-Lite', '3 Flash', '3.1 Pro']
  .map((label) => ({ label, isMode: false, selected: label === selected }))
  .concat({ label: 'Extended thinking', isMode: true, selected: selected === 'Extended thinking' });

function loopOn(effort, modelOptions) {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-effort-'));
  const l = Object.create(AgentLoop.prototype);
  Object.assign(l, {
    workspace: dir,
    modelConfig: { main: 'gemini', effort },
    modelOptions,
    promptBuilder: new PromptBuilder(dir, dir),
  });
  const build = () => l.promptBuilder.buildPrompt({
    userMessage: 'hi', mode: 'plan', subagents: true, modelConfig: l._promptConfig(),
  });
  return { l, build, done: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('which rung the prompt is written for', () => {
  test('effort High with the tab on Flash sends the Medium prompt', () => {
    const { l, build, done } = loopOn('high', THREE('3 Flash'));
    assert.equal(l._promptEffort(), 'medium');
    assert.match(build(), /^Effort: medium/m);
    done();
  });

  test('control: with the tab on Pro, High sends High', () => {
    const { build, done } = loopOn('high', THREE('3.1 Pro'));
    assert.match(build(), /^Effort: high/m);
    done();
  });

  test('the setting is never rewritten', () => {
    const { l, build, done } = loopOn('high', THREE('3.1 Flash-Lite'));
    build();
    assert.equal(l._promptEffort(), 'low');
    assert.equal(l.modelConfig.effort, 'high');
    done();
  });

  for (const [why, options] of [
    ['an unread picker', null],
    ['a list with nothing selected', THREE(null)],
    ['a mode selected', THREE('Extended thinking')],
  ]) {
    test(`${why} falls back to the setting`, () => {
      const { l, done } = loopOn('high', options);
      assert.equal(l._promptEffort(), 'high');
      done();
    });
  }

  test('a switch in flight uses the setting — the list still holds the old tab', () => {
    const { l, done } = loopOn('high', THREE('3 Flash'));
    l._switchInFlight = '3.1 Pro';
    assert.equal(l._promptEffort(), 'high');
    done();
  });

  test('a retired word in the config is read as its rung', () => {
    const { l, done } = loopOn('standard', THREE('3.1 Pro'));
    assert.equal(l._promptEffort(), 'high');
    done();
  });
});

describe('the thread is re-taught only when the tier moves', () => {
  test('Pro → Flash resends the full prompt', () => {
    const { l, build, done } = loopOn('high', THREE('3.1 Pro'));
    assert.match(build(), /<system_state/);
    assert.doesNotMatch(build(), /<system_state/, 'control: the second turn is short');
    l.modelOptions = THREE('3 Flash');
    const next = build();
    assert.match(next, /<system_state/);
    assert.match(next, /^Effort: medium/m);
    done();
  });

  test('a setting change the tab does not follow costs nothing', () => {
    // High → Medium with the tab stuck on Flash: the model read the medium
    // prompt before and reads it after. `/effort` used to reset regardless.
    const { l, build, done } = loopOn('high', THREE('3 Flash'));
    build();
    l.modelConfig.effort = 'medium';
    assert.doesNotMatch(build(), /<system_state/);
    done();
  });

  test('a new chat is taught whatever tier goes out first', () => {
    const { l, build, done } = loopOn('high', THREE('3.1 Pro'));
    build();
    l.promptBuilder.resetPromptState();
    assert.equal(l.promptBuilder.promptTier, null);
    l.modelOptions = THREE('3 Flash');
    assert.match(build(), /^Effort: medium/m);
    assert.equal(l.promptBuilder.promptTier, 'flash');
    done();
  });
});

describe('rungForModel', () => {
  test('each model maps back to the rung that picks it', () => {
    assert.equal(rungForModel(THREE('3.1 Flash-Lite'), 'high'), 'low');
    assert.equal(rungForModel(THREE('3 Flash'), 'high'), 'medium');
    assert.equal(rungForModel(THREE('3.1 Pro'), 'low'), 'high');
  });

  test('two rungs on one model: the setting if it is one, else the nearest', () => {
    // A two-model plan: low and medium both pick the first entry.
    const two = [{ label: 'Flash', isMode: false, selected: true }, { label: 'Pro', isMode: false }];
    assert.equal(rungForModel(two, 'low'), 'low');
    assert.equal(rungForModel(two, 'medium'), 'medium');
    assert.equal(rungForModel(two, 'high'), 'medium');
  });

  test('a pin is honoured in reverse too', () => {
    const cfg = { browserModels: { high: 'Extended thinking' } };
    assert.equal(rungForModel(THREE('Extended thinking'), 'low', cfg), 'high');
    assert.equal(rungForModel(THREE('Extended thinking'), 'low'), null, 'control: unpinned, a mode is no rung');
  });
});

describe('the reply records what was sent', () => {
  test('setting, prompt rung and the tab are three fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prompt-effort-rec-'));
    const filed = [];
    const l = Object.create(AgentLoop.prototype);
    Object.assign(l, {
      workspace: dir,
      modelConfig: { main: 'gemini', effort: 'high' },
      modelOptions: THREE('3 Flash'),
      conversationHistory: [],
      isProcessing: true,
      sessionStore: { appendTurn: (t) => filed.push(t), saveHistory() {} },
      promptBuilder: { noteDrift() {}, resetPromptState() {} },
      callbacks: { sendToPanel() {} },
      extensionLock: { release() {}, abortAll() {} },
      contextManager: { needsCompaction: () => false },
      _turnEvidence: new Map(),
      _releaseExtension() {},
    });
    await l.handleGeminiResponse('m1', { content: 'Done.', complete: true });
    const reply = filed.find((t) => t.role === 'agent');
    assert.equal(reply.effort, 'high');
    assert.equal(reply.promptEffort, 'medium');
    assert.equal(reply.model, '3 Flash');
    rmSync(dir, { recursive: true, force: true });
  });
});
