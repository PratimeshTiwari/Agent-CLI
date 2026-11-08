import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptShapes } from './prompt-golden-shapes.js';
import { PROMPT_VERSIONS } from '../../../src/backend/core/prompt/prompt-versions.js';

/*
 * Files go through the tools, never Gemini's Canvas (v9.9.6, `noCanvas`).
 * Read live on /u/3: asked for an interactive chart, Gemini built a Canvas app
 * for ~31 s behind the stop button and the reply was a chip the agent cannot
 * read. The loop asks for the file afterwards (canvas-reply.test.js); this is
 * the line that should make that ask rare.
 */

const v1 = promptShapes({ version: 'v1' });
const v7 = promptShapes({ version: 'v7' });
const RULE = /never in Gemini's Canvas|Never write a file, document or app in Gemini's Canvas/;

test('a wording switch of v7: v1 never says it', () => {
  assert.equal(PROMPT_VERSIONS.v7.flags.noCanvas, true);
  assert.equal(PROMPT_VERSIONS.v1.flags.noCanvas, undefined);
  for (const key of Object.keys(v1)) assert.doesNotMatch(v1[key], RULE, key);
});

test('every rung says it once on turn 0, and only on turn 0', () => {
  for (const effort of ['low', 'medium', 'high']) {
    const turn0 = v7[`${effort}/plan/sub/turn0`];
    assert.equal((turn0.match(new RegExp(RULE.source, 'g')) || []).length, 1, effort);
    assert.doesNotMatch(v7[`${effort}/plan/sub/short`], RULE, `${effort} short turn`);
  }
});

test('the terse list numbers it after look-first', () => {
  const low = v7['low/plan/sub/turn0'];
  assert.match(low, /\n9\. A question about this project[^\n]*\n10\. Write files with create_file/);
});
