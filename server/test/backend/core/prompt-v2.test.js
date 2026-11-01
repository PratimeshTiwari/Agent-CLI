import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promptShapes } from './prompt-golden-shapes.js';
import { PromptBuilder } from '../../../src/backend/core/prompt-builder.js';
import { PROMPT_VERSIONS } from '../../../src/backend/core/prompt-versions.js';

/*
 * Prompt v2 (v5.34): the dedup plan, as a version beside the frozen v1.
 *
 * Two kinds of assertion, because deleting a repeated rule is only safe if the
 * copy that stays is really there: each change is present in v2 and absent in
 * v1, and each rule v2 cut a copy of is still stated, once, where it is kept.
 */

const v1 = promptShapes({ version: 'v1' });
const v2 = promptShapes({ version: 'v2' });
const count = (text, needle) => text.split(needle).length - 1;

test('v2 is a set of switches, all on', () => {
  const flags = PROMPT_VERSIONS.v2.flags;
  assert.deepEqual(Object.keys(flags).sort(),
    ['answerDirectly', 'gateReview', 'largeFileDigest', 'logQuery', 'oneCopy', 'projectCommands', 'subagentEffortWords', 'symbolLanguages', 'tickWithNextCall', 'trustEditResult', 'walkthroughWithTask']);
  assert.ok(Object.values(flags).every((f) => f === true));
  assert.deepEqual(PROMPT_VERSIONS.v1.flags, {}, 'v1 has no switches');
});

test('A1: no read-back after every edit, on every rung and in the handovers', () => {
  const high = v2['high/plan/sub/turn0'];
  assert.match(high, /Trust the edit result/);
  assert.doesNotMatch(high, /Re-read the edited file/);
  assert.match(v1['high/plan/sub/turn0'], /Re-read the edited file/, 'control: v1 keeps it');
  assert.match(v2['medium/plan/sub/turn0'], /The edit result says whether it landed/);
  assert.doesNotMatch(v2['medium/plan/sub/turn0'], /Re-read the edited file/);
  assert.match(v2['low/plan/sub/turn0'], /Verify edits: the edit result says whether it landed/);
  for (const effort of ['low', 'medium']) {
    assert.match(v2[`${effort}/plan/sub/turn0`], /re-read a file only after a mismatch/);
    assert.doesNotMatch(v2[`${effort}/plan/sub/turn0`], /re-read the edited files/);
  }
  assert.match(v2['medium/handover'], /\*\*Landed:\*\*/);
  assert.doesNotMatch(v2['medium/handover'], /Read back/);
  assert.match(v2['high/handover'], /\*\*What landed\*\*/);
  assert.doesNotMatch(v2['high/handover'], /read back what you wrote/);
});

test('v6.7: on the cheap rungs a greeting gets no task.md and no plan', () => {
  const line = '(never for a greeting, or a question you can answer without reading anything)';
  for (const effort of ['low', 'medium']) {
    assert.equal(count(v2[`${effort}/plan/sub/turn0`], line), 1, effort);
    assert.equal(count(v1[`${effort}/plan/sub/turn0`], line), 0, `control: v1 ${effort}`);
    assert.doesNotMatch(v2[`${effort}/plan/sub/turn0`], /ALWAYS proactively create/);
    assert.match(v1[`${effort}/plan/sub/turn0`], /ALWAYS proactively create a `\.agent\/artifacts\/task\.md`/, 'control: v1 unchanged');
  }
  // High already says it in STEP 1, so it is not said twice.
  assert.equal(count(v2['high/plan/sub/turn0'], line), 0);
  assert.match(v2['high/plan/sub/turn0'], /A greeting, or a question you can answer without reading anything, needs none of this/);
});

test('v6.8/v6.21: find_symbol names its languages on v2, and v1 keeps its sentence', () => {
  assert.match(v2['high/plan/sub/turn0'], /JavaScript and JSX are parsed; Ruby, TypeScript, Python, Go, .* are matched by line patterns/);
  assert.doesNotMatch(v2['high/plan/sub/turn0'], /JavaScript and JSX only\./);
  assert.match(v1['high/plan/sub/turn0'], /JavaScript and JSX only\./, 'control: v1 frozen');
});

test('A2: task.md is ticked in the reply that makes the next call', () => {
  for (const key of ['high/plan/sub/turn0', 'medium/plan/sub/turn0', 'low/plan/sub/turn0']) {
    assert.match(v2[key], /in the\s+same reply as your next tool call — never a reply that only ticks/, key);
    assert.doesNotMatch(v1[key], /never a reply that only ticks/, `control: ${key}`);
  }
});

test('A3: the review subagent only for a change big enough to hide something', () => {
  const sub = v2['high/plan/sub/turn0'];
  assert.match(sub, /more than one file or more than ~30 lines/);
  assert.match(sub, /Smaller than that: read the diff yourself/);
  // Without subagents nothing changed: self-review was already the step.
  assert.match(v2['high/plan/solo/turn0'], /Adversarial self-review/);
  assert.doesNotMatch(v2['high/plan/solo/turn0'], /~30 lines/);
});

test('A4: walkthrough.md only after a task.md; each plan file says what it is for', () => {
  for (const key of ['high/plan/sub/turn0', 'medium/auto/solo/turn0', 'low/strict/sub/turn0']) {
    assert.match(v2[key], /If you wrote a `task\.md`, finish by writing `\.agent\/artifacts\/walkthrough\.md`/, key);
    assert.match(v2[key], /implementation_plan\.md` is a plan you want approved before a large change; `\.agent\/artifacts\/task\.md` is how far you are/, key);
    assert.doesNotMatch(v2[key], /After completing all implementation and verification, summarize/, key);
  }
});

test('B: each repeated rule survives exactly once where it is kept', () => {
  const high = v2['high/plan/sub/turn0'];
  // Read before you claim: the guardrails copy, not Core.
  assert.equal(count(high, 'Never reference a file you have not read'), 1);
  assert.equal(count(high, 'ONLY reference code that you have explicitly read'), 0);
  assert.match(high, /ensure the `cwd` is correct/, 'the one Core bullet nothing else says');
  // Medium has no guardrails block, so Core keeps its copy there.
  assert.equal(count(v2['medium/plan/sub/turn0'], 'ONLY reference code that you have explicitly read'), 1);
  // edit_file mismatch: the tool description on pro. Flash gets the terse tool
  // list, which does not say it, so Core's bullet is its only copy and stays.
  assert.equal(count(high, '**edit_file mismatch**'), 0);
  assert.match(high, /on a mismatch, re-read and retry/);
  assert.doesNotMatch(v2['medium/plan/sub/turn0'], /on a mismatch, re-read and retry/);
  assert.equal(count(v2['medium/plan/sub/turn0'], '**edit_file mismatch**'), 1);
  // Where a <thought> goes: STEP 1, PHASE 1 and the format, not Core.
  assert.doesNotMatch(high, /A `<thought>` block is the one thing that may precede/);
  assert.match(high, /starts here, in one <thought> block/);
  assert.match(high, /Open each phase with a <thought> block/);
  assert.match(high, /A `<thought>`\s+block planning the call is fine/);
  // Ask, don't assume: the tool and pro-hypothesis; STEP 1 points at the tool.
  assert.match(high, /ask with `ask_question`\./);
  assert.match(high, /If you would not bet on it, stop/);
  assert.match(high, /## ask_question/);
  // Concise: once.
  assert.equal(count(high, 'Be exceptionally concise'), 1);
  // STEP 2's table is a line.
  assert.doesNotMatch(high, /\| Task Type \|/);
  assert.match(high, /## STEP 2: CLASSIFY/);
});

test('B: <self_awareness> names the source only when it is not this workspace', (t) => {
  const ws = mkdtempSync(join(tmpdir(), 'v2-ws-'));
  const src = mkdtempSync(join(tmpdir(), 'v2-src-'));
  t.after(() => { rmSync(ws, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); });
  const args = { userMessage: 'hi', mode: 'plan', subagents: true, modelConfig: { effort: 'high' } };
  const build = (source) => {
    const pb = new PromptBuilder(ws, source);
    pb.promptVersion = 'v2';
    return pb.buildPrompt(args);
  };
  const same = build(ws);
  assert.match(same, /Workspace: `[^`]+`\nEffort: high/);
  assert.doesNotMatch(same, /Your own source/);
  assert.doesNotMatch(same, /Your OWN source code/);
  const inside = build(join(ws, 'server'));
  assert.doesNotMatch(inside, /Your own source/, 'inside the workspace it is the workspace');
  assert.match(build(src), /Your own source \(the Agent-CLI server\) is at `[^`]+`, outside it/);
});

test('v2 is shorter on every turn 0, and only turn 0 and the handovers move', () => {
  for (const effort of ['low', 'medium', 'high']) {
    for (const mode of ['plan', 'auto', 'strict']) {
      for (const sub of ['sub', 'solo']) {
        const key = `${effort}/${mode}/${sub}/turn0`;
        // The dedup is what is measured here; query_log (v6.20) is a tool v1
        // does not have, so its own section is left out of the comparison.
        const dedup = v2[key].replace(/## query_log[\s\S]*?(?=## )/, '');
        assert.ok(v2[key].includes('## query_log'), `${key}: v2 offers query_log`);
        assert.ok(dedup.length < v1[key].length, `${key}: ${dedup.length} vs ${v1[key].length}`);
      }
    }
  }
  // The short turn, the batch and the wrappers carry none of the system prompt.
  for (const key of ['batch', 'subagent/review', 'compaction']) {
    assert.equal(v2[key], v1[key], key);
  }
  // The short turn differs by one name in the tool anchor (v6.20).
  assert.equal(v2['high/plan/sub/short'], v1['high/plan/sub/short'].replace(' read_file ', ' read_file query_log '));
});

test('ask_subagent takes the /effort words on v2, max included; v1 keeps its own (v6.15)', () => {
  const high = v2['high/plan/sub/turn0'];
  assert.match(high, /effort \(string, optional\): "low", "medium", "high" or "max"/);
  assert.doesNotMatch(high, /"lite", "flash" or "pro"/);
  assert.match(v1['high/plan/sub/turn0'], /"lite", "flash" or "pro"/);
});

test('read_file names the digest and purpose on v2 with subagents; never on v1 or solo (v6.16)', () => {
  assert.match(v2['high/plan/sub/turn0'], /purpose \(string, optional\)/);
  assert.match(v2['high/plan/sub/turn0'], /digest \(outline, quoted passages/);
  assert.doesNotMatch(v1['high/plan/sub/turn0'], /purpose \(string, optional\)/);
  const solo = Object.entries(v2).filter(([k]) => k.startsWith('high/') && k.includes('/solo/'));
  assert.ok(solo.length > 0, 'there is a solo shape to check');
  for (const [k, text] of solo) assert.doesNotMatch(text, /read by a subagent/, k);
});
