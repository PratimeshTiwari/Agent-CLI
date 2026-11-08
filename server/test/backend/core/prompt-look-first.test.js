import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptShapes } from './prompt-golden-shapes.js';
import { PROMPT_VERSIONS } from '../../../src/backend/core/prompt/prompt-versions.js';

/*
 * Look before answering (v7.9, first as prompt v3; in the current prompt, v7,
 * since v9.9.5): the cheap rungs answer a question about the project from files
 * opened this turn.
 *
 * Asked a code question about this server, Flash-Lite answered from AGENT.md's
 * map with nothing opened. Pro plans first and is left alone; low and medium
 * get one rule, and the loop (empty-promise.test.js) asks once when a reply
 * promises to look and makes no call.
 */

const v1 = promptShapes({ version: 'v1' });
const v7 = promptShapes({ version: 'v7' });
const RULE = /answered from files you open this turn/;

test('a wording switch of v7, not a feature: v1 never says it', () => {
  assert.equal(PROMPT_VERSIONS.v7.flags.lookFirst, true);
  assert.equal(PROMPT_VERSIONS.v1.flags.lookFirst, undefined);
  for (const key of Object.keys(v1)) assert.doesNotMatch(v1[key], RULE, key);
});

test('low and medium say it once on turn 0; high does not', () => {
  for (const effort of ['low', 'medium']) {
    const turn0 = v7[`${effort}/plan/sub/turn0`];
    assert.equal(turn0.split('answered from files you open this turn').length - 1, 1, effort);
  }
  assert.doesNotMatch(v7['high/plan/sub/turn0'], RULE);
});
