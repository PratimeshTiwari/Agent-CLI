import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptShapes } from './prompt-golden-shapes.js';
import { PROMPT_VERSIONS } from '../../../src/backend/core/prompt/prompt-versions.js';

/*
 * Prompt v3 (v7.9): v2 plus "look before answering" on the cheap rungs.
 *
 * Asked a code question about this server, Flash-Lite answered from AGENT.md's
 * map with nothing opened. Pro plans first and is left alone; low and medium
 * get one rule, and the loop (empty-promise.test.js) asks once when a reply
 * promises to look and makes no call.
 */

const v2 = promptShapes({ version: 'v2' });
const v3 = promptShapes({ version: 'v3' });
const RULE = /answered from files you open this turn/;

test('v3 is v2 plus one switch', () => {
  const { lookFirst, ...rest } = PROMPT_VERSIONS.v3.flags;
  assert.equal(lookFirst, true);
  assert.deepEqual(rest, PROMPT_VERSIONS.v2.flags);
  assert.equal(PROMPT_VERSIONS.v3.dir, PROMPT_VERSIONS.v2.dir, "v2's files, not the base ones");
});

test('low and medium say it once on turn 0; high does not', () => {
  for (const effort of ['low', 'medium']) {
    const turn0 = v3[`${effort}/plan/sub/turn0`];
    assert.equal(turn0.split('answered from files you open this turn').length - 1, 1, effort);
    assert.doesNotMatch(v2[`${effort}/plan/sub/turn0`], RULE, `control: v2 ${effort}`);
  }
  assert.doesNotMatch(v3['high/plan/sub/turn0'], RULE);
  assert.equal(v3['high/plan/sub/turn0'], v2['high/plan/sub/turn0'], 'high is v2, byte for byte');
});

test('everything but the rule is v2', () => {
  for (const effort of ['low', 'medium']) {
    const key = `${effort}/plan/sub/turn0`;
    const without = v3[key].split('\n').filter((l) => !RULE.test(l)).join('\n');
    assert.equal(without, v2[key], effort);
  }
});
