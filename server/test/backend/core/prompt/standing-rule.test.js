import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeStandingRule, MEMORY_NUDGE } from '../../../../src/backend/core/prompt/standing-rule.js';

describe('looksLikeStandingRule', () => {
  // Real messages, from the replay that set the patterns.
  for (const message of [
    'if any work is left then continue on it else continue ? and always ask me if some branch is left',
    'from now on use pnpm',
    'remember that the staging box is shared',
    'never commit to main',
    "that's wrong, the API is v2",
    'not what i asked',
    'i told you not to touch the changelog',
    'keep the leetcode thing below only , i only told to include numbers',
    'we use rspec here',
  ]) {
    test(`fires: ${message.slice(0, 50)}`, () => assert.equal(looksLikeStandingRule(message), true));
  }

  // A one-off request has the same shape as a rule. Nudging on these is noise.
  for (const message of [
    'push it',
    'continue',
    'this ui looks better but after the output look',
    "don't give leetcode in collapse window",
    'warm should be not at default',
    'remove x.com and maybe use 2 separate horizontal sections',
    'instead of ctrl+j , can we make ctrl+n for new line',
    'Compact between turns, never during one.',
    'is this always the case',
    '',
    null,
  ]) {
    test(`quiet: ${String(message).slice(0, 50)}`, () => assert.equal(looksLikeStandingRule(message), false));
  }

  test('a paste is not a rule, whatever it says', () => {
    assert.equal(looksLikeStandingRule(`from now on ${'log line '.repeat(80)}`), false);
  });

  test('the line says what to do when the guess is wrong', () => {
    assert.match(MEMORY_NUDGE, /ignore this/);
    assert.match(MEMORY_NUDGE, /manage_memory/);
  });
});
