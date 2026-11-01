/**
 * Prompt fixes from a review on 2026-10-24, checked rung by rung.
 *
 * A comment in `_buildSystemInstructions` had said since 2026-09-21 that three
 * of its five bullets "are gone"; the string still held all five. They are
 * duplicates only on the pro rung — the lite and flash rungs have nothing else
 * asking for a `task.md`, a self-review or an admission of doubt — so only pro
 * drops them. Measured when made: lite byte-identical, flash −6 characters
 * (two headings), pro −515.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptBuilder } from '../../../src/backend/core/prompt/prompt-builder.js';

const ws = mkdtempSync(join(tmpdir(), 'dedup-'));
const sys = (effort) => new PromptBuilder(ws)._buildSystemInstructions('plan', true, { effort });

const TASK = /ALWAYS proactively create a `\.agent\/artifacts\/task\.md`/;
const REVIEW = /After implementing changes, self-review/;
const DOUBT = /If you're not confident in a change, tell the user/;

test('pro drops the three bullets its own phases already say', () => {
  const p = sys('high');
  for (const re of [TASK, REVIEW, DOUBT]) assert.doesNotMatch(p, re);
  // …and still says each of them, where the comment claims it does.
  assert.match(p, /write the checklist to `\.agent\/artifacts\/task\.md`/);
  assert.match(p, /PHASE 4: VERIFICATION/);
  assert.match(p, /If you would not bet on it, stop/);
});

test('control: lite and flash keep them — nothing else asks for these there', () => {
  for (const effort of ['low', 'medium']) {
    const p = sys(effort);
    for (const re of [TASK, REVIEW, DOUBT]) assert.match(p, re, `${effort} lost ${re}`);
  }
});

test('every rung keeps the two artifacts nothing else mentions', () => {
  for (const effort of ['low', 'medium', 'high']) {
    const p = sys(effort);
    assert.match(p, /implementation_plan\.md/);
    assert.match(p, /walkthrough\.md/);
  }
});

test('section headings are not numbered out of sequence', () => {
  const p = sys('high');
  assert.doesNotMatch(p, /^## \d+\. /m, 'a "## 2." under an unnumbered "## Core Principles"');
});

test('a greeting does not owe the planning ceremony', () => {
  assert.match(sys('high'), /A greeting, or a question you can answer without reading anything, needs none of this/);
});
