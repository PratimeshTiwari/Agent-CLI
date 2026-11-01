/**
 * Three modes, and the prompt saying which one is on (v5.11).
 *
 * The prompt and the policy must agree. CLAUDE.md records the time they did
 * not: the prompt said every edit needed approval while a `.md` write applied
 * at once, so the model reported applied edits as waiting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, nextMode, describeMode, asksForEdits } from '../../../src/backend/core/modes.js';
import { PromptBuilder } from '../../../src/backend/core/prompt-builder.js';
import { handleSlashCommand } from '../../../src/backend/core/slash-commands.js';

test('Tab cycles plan → auto → strict → plan, and an unknown mode starts at plan', () => {
  assert.deepEqual(MODES, ['plan', 'auto', 'strict']);
  assert.equal(nextMode('plan'), 'auto');
  assert.equal(nextMode('auto'), 'strict');
  assert.equal(nextMode('strict'), 'plan');
  assert.equal(nextMode(undefined), 'plan');
});

test('plan and strict ask; auto does not', () => {
  assert.equal(asksForEdits('plan'), true);
  assert.equal(asksForEdits('strict'), true);
  assert.equal(asksForEdits('auto'), false);
});

const instructions = (mode) => Object.create(PromptBuilder.prototype)._buildSystemInstructions(mode, true, {});

test('plan mode tells the model its project Markdown is written straight away', () => {
  const p = instructions('plan');
  assert.match(p, /You are in PLAN MODE/);
  assert.match(p, /Markdown files inside the project[\s\S]*written straight away/);
  assert.match(p, /AGENT\.md, CLAUDE\.md and GEMINI\.md, which also ask/);
});

test('control: strict says nothing about an exception, because there is none', () => {
  const p = instructions('strict');
  assert.match(p, /You are in STRICT PLAN MODE/);
  assert.doesNotMatch(p, /written straight away/);
});

test('/strict switches, and says what it means', async () => {
  const loop = { mode: 'plan' };
  const r = await handleSlashCommand(loop, 'strict', []);
  assert.equal(loop.mode, 'strict');
  assert.match(r.message, /Markdown included/);
  assert.match(describeMode('plan'), /Markdown in the repo does not/);
});
