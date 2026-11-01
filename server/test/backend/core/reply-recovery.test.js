/**
 * The reply-recovery table, without a loop.
 *
 * Every branch has a negative control: a recovery that fires on an ordinary
 * answer discards that answer and spends a browser round trip to replace it,
 * which is a worse bug than the one it exists to fix.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyIncomplete, classifyParseFailure, classifyReply, providerBackoffMs,
  MAX_PARSE_RETRIES, MAX_PROVIDER_RETRIES, PROVIDER_BACKOFF_MS,
} from '../../../src/backend/core/reply-recovery.js';

const PROVIDER = 'Sorry, something went wrong. Please try your request again.';
const QUOTA = "You've reached your limit for 2.5 Pro. Your limit resets at 4:00 PM. Try again later.";
const DENIAL = 'I cannot execute local commands or access your local file system.';
const ANSWER = 'The parser lives in core/agent-loop.js and the bug is the missing await on line 40.';

const healthy = { providerRetries: 0, deniedToolsOnce: false, hasObjective: true, hasLastPrompt: true, random: () => 0.5 };

describe('classifyIncomplete', () => {
  test('a stream chunk is not a decision', () => {
    assert.deepEqual(classifyIncomplete({ timedOut: false }), { action: 'wait' });
  });
  test('a prompt that never landed is resent once', () => {
    assert.equal(classifyIncomplete({ timedOut: true, neverSubmitted: true }, { hasLastPrompt: true }).action, 'resend_unsubmitted');
  });
  test('…and only once', () => {
    assert.equal(classifyIncomplete({ timedOut: true, neverSubmitted: true },
      { hasLastPrompt: true, resentUnsubmittedOnce: true }).action, 'give_up_timeout');
  });
  test('a timeout after generation started is never resent', () => {
    assert.equal(classifyIncomplete({ timedOut: true, neverSubmitted: false }, { hasLastPrompt: true }).action, 'give_up_timeout');
  });
  test('nothing recorded to resend means nothing is resent', () => {
    assert.equal(classifyIncomplete({ timedOut: true, neverSubmitted: true }, { hasLastPrompt: false }).action, 'give_up_timeout');
  });
});

describe('classifyParseFailure', () => {
  test(`repairs up to ${MAX_PARSE_RETRIES} times, then hands the prose over`, () => {
    for (let n = 1; n <= MAX_PARSE_RETRIES; n++) assert.equal(classifyParseFailure(n).action, 'repair_json');
    assert.equal(classifyParseFailure(MAX_PARSE_RETRIES + 1).action, 'hand_over_unparsed');
  });
});

describe('classifyReply', () => {
  test('an ordinary answer proceeds — the control for every branch below', () => {
    assert.deepEqual(classifyReply({ toolCalls: [], cleanContent: ANSWER }, healthy), { action: 'proceed' });
  });

  test('a reply with tool calls proceeds whatever its prose says', () => {
    for (const prose of [PROVIDER, QUOTA, DENIAL]) {
      assert.deepEqual(classifyReply({ toolCalls: [{ name: 'read_file' }], cleanContent: prose }, healthy), { action: 'proceed' });
    }
  });

  test('a provider error is re-asked, with a backoff', () => {
    const v = classifyReply({ toolCalls: [], cleanContent: PROVIDER }, healthy);
    assert.equal(v.action, 'reask_provider');
    assert.equal(v.attempt, 1);
    assert.equal(v.delayMs, PROVIDER_BACKOFF_MS[0]);
  });

  test(`…up to ${MAX_PROVIDER_RETRIES} times, then the error is shown`, () => {
    const last = classifyReply({ toolCalls: [], cleanContent: PROVIDER }, { ...healthy, providerRetries: MAX_PROVIDER_RETRIES - 1 });
    assert.equal(last.action, 'reask_provider');
    const over = classifyReply({ toolCalls: [], cleanContent: PROVIDER }, { ...healthy, providerRetries: MAX_PROVIDER_RETRIES });
    assert.equal(over.action, 'proceed');
    assert.equal(over.exhausted, true);
  });

  test('a provider error with no prompt on record is not re-asked', () => {
    assert.equal(classifyReply({ toolCalls: [], cleanContent: PROVIDER }, { ...healthy, hasLastPrompt: false }).action, 'proceed');
  });

  test('a usage limit is recorded and NOT retried, though it reads like a provider error', () => {
    // The ordering this whole branch exists for: QUOTA says "try again later".
    assert.ok(QUOTA.includes('Try again later'));
    const v = classifyReply({ toolCalls: [], cleanContent: QUOTA }, healthy);
    assert.equal(v.action, 'proceed');
    assert.equal(v.kind, 'quota');
  });

  test('a denial redeclares the tools, once per turn', () => {
    assert.equal(classifyReply({ toolCalls: [], cleanContent: DENIAL }, healthy).action, 'redeclare_tools');
    assert.equal(classifyReply({ toolCalls: [], cleanContent: DENIAL }, { ...healthy, deniedToolsOnce: true }).action, 'proceed');
  });
});

describe('providerBackoffMs', () => {
  test('3s then 8s at the centre of the jitter', () => {
    assert.equal(providerBackoffMs(1, () => 0.5), 3000);
    assert.equal(providerBackoffMs(2, () => 0.5), 8000);
  });
  test('±20% at the edges, never zero', () => {
    assert.equal(providerBackoffMs(1, () => 0), 2400);
    assert.equal(providerBackoffMs(1, () => 1), 3600);
    assert.equal(providerBackoffMs(2, () => 0), 6400);
  });
  test('an attempt past the table reuses its last step rather than collapsing to 0', () => {
    assert.equal(providerBackoffMs(9, () => 0.5), PROVIDER_BACKOFF_MS.at(-1));
  });
});
