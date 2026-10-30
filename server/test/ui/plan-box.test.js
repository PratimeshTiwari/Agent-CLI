/**
 * The plan in a box, and the row that says it changed.
 *
 * Asked for with a screenshot of Claude Code: `Plan file: <path>` above the
 * plan in a box, **nothing when there is no plan file**, and each write drawn
 * as `● Updated plan ⎿ /plan show to preview`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planBoxRow, findPlanFile, planWorthReviewing } from '../../src/ui/plan-box.js';
import { describeArtifactWrite, parseTurnActions, isPlanFile } from '../../src/ui/transcript.js';

function workspace() {
  const ws = mkdtempSync(join(tmpdir(), 'plan-box-'));
  mkdirSync(join(ws, '.agent', 'artifacts'), { recursive: true });
  return ws;
}

describe('planBoxRow', () => {
  test('no plan file: no row', () => {
    const ws = workspace();
    assert.equal(planBoxRow(ws), null);
    assert.equal(findPlanFile(ws), null);
    rmSync(ws, { recursive: true, force: true });
  });

  test('an empty plan file: no row', () => {
    const ws = workspace();
    writeFileSync(join(ws, '.agent', 'artifacts', 'implementation_plan.md'), '  \n');
    assert.equal(planBoxRow(ws), null);
    rmSync(ws, { recursive: true, force: true });
  });

  test('a plan: the row carries the path relative to the workspace and the text', () => {
    const ws = workspace();
    writeFileSync(join(ws, '.agent', 'artifacts', 'implementation_plan.md'), '# Plan\n\n1. do it\n');
    const row = planBoxRow(ws);
    assert.equal(row.kind, 'plan_box');
    assert.equal(row.isLocal, true);
    assert.equal(row.path, join('.agent', 'artifacts', 'implementation_plan.md'));
    assert.equal(row.content, '# Plan\n\n1. do it');
    rmSync(ws, { recursive: true, force: true });
  });

  test('plan.md is used when there is no implementation_plan.md', () => {
    const ws = workspace();
    writeFileSync(join(ws, '.agent', 'artifacts', 'plan.md'), 'small plan');
    assert.equal(planBoxRow(ws).path, join('.agent', 'artifacts', 'plan.md'));
    rmSync(ws, { recursive: true, force: true });
  });

  test('implementation_plan.md wins when both exist, as plan review always chose', () => {
    const ws = workspace();
    writeFileSync(join(ws, '.agent', 'artifacts', 'plan.md'), 'old');
    writeFileSync(join(ws, '.agent', 'artifacts', 'implementation_plan.md'), 'new');
    assert.equal(planBoxRow(ws).content, 'new');
    rmSync(ws, { recursive: true, force: true });
  });
});

describe('the transcript', () => {
  test('a plan_box row is drawn as a plan, and is not counted as work', () => {
    const turn = {
      id: 1,
      steps: [{ role: 'assistant', isLocal: true, kind: 'plan_box', path: 'p.md', content: '# P' }],
    };
    const { items, actions, finalMessages } = parseTurnActions(turn);
    assert.equal(items[0].type, 'plan_box');
    assert.equal(items[0].content, '# P');
    assert.equal(actions.length, 0, '"Worked for … · 1 action" would count a document as work');
    assert.equal(finalMessages.length, 0, 'and it must not be drawn a second time as prose');
  });

  test('writing the plan reads "Wrote plan", editing it "Updated plan"', () => {
    const p = '.agent/artifacts/implementation_plan.md';
    assert.deepEqual(describeArtifactWrite('create_file', { path: p, content: '# x' }),
      { verb: 'Wrote plan', detail: '', plan: true });
    assert.deepEqual(describeArtifactWrite('edit_file', { path: p, edits: [] }),
      { verb: 'Updated plan', detail: '', plan: true });
  });

  // Negative controls: the plan row must not spread to other artifacts, or to a
  // file merely *named* like a plan outside the artifacts directory.
  test('other artifacts and other plan.md files are not plans', () => {
    assert.equal(describeArtifactWrite('edit_file', { path: '.agent/artifacts/task.md', edits: [] }).plan,
      undefined);
    assert.equal(describeArtifactWrite('edit_file', { path: 'docs/plan.md', edits: [] }), null);
    assert.equal(isPlanFile('docs/notes.md'), false);
  });
});

describe('planWorthReviewing (v6.7: "hi" ended on Plan ready for review)', () => {
  const art = (ws, name) => join(ws, '.agent', 'artifacts', name);
  const at = (file, secs) => utimesSync(file, secs, secs);

  test('the reported turn: a one-line plan, then task.md ticked after it', () => {
    const ws = workspace();
    writeFileSync(art(ws, 'implementation_plan.md'),
      '# Implementation Plan - Initial Setup\n\n- Understand user request and initialize tracking files.\n');
    writeFileSync(art(ws, 'task.md'), '# Task Checklist\n\n- [x] Initialize task plan\n');
    assert.equal(planWorthReviewing(ws), false);
    rmSync(ws, { recursive: true, force: true });
  });

  test('a real plan with steps still opens the review', () => {
    const ws = workspace();
    writeFileSync(art(ws, 'implementation_plan.md'),
      '# Plan\n\n1. Add the flag to modes.js\n2. Read it in tool-policy.js\n3. Test both branches\n');
    assert.equal(planWorthReviewing(ws), true);
    // An open checklist beside it does not change that.
    writeFileSync(art(ws, 'task.md'), '- [ ] Add the flag\n- [ ] Read it\n');
    assert.equal(planWorthReviewing(ws), true);
    rmSync(ws, { recursive: true, force: true });
  });

  test('a prose plan with no list is kept by its length', () => {
    const ws = workspace();
    writeFileSync(art(ws, 'implementation_plan.md'), '# Plan\n\n' + 'Move the retry into reply-recovery and keep the verbatim resend. '.repeat(4));
    assert.equal(planWorthReviewing(ws), true);
    rmSync(ws, { recursive: true, force: true });
  });

  test('a finished task.md from an earlier task does not hide a new plan', () => {
    const ws = workspace();
    const plan = art(ws, 'implementation_plan.md');
    const task = art(ws, 'task.md');
    writeFileSync(task, '- [x] old work\n');
    writeFileSync(plan, '# Plan\n\n- one\n- two\n');
    at(task, 1_000_000);
    at(plan, 2_000_000);
    assert.equal(planWorthReviewing(ws), true, 'the checklist is older than the plan');
    at(task, 3_000_000);
    assert.equal(planWorthReviewing(ws), false, 'control: ticked after the plan means carried out');
    rmSync(ws, { recursive: true, force: true });
  });

  test('no plan file: nothing to review', () => {
    const ws = workspace();
    assert.equal(planWorthReviewing(ws), false);
    rmSync(ws, { recursive: true, force: true });
  });
});
