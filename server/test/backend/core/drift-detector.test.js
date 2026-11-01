import { test, describe } from 'node:test';
import assert from 'node:assert';
import { looksLikeMultipleDrafts, looksLikeCapabilityDenial, looksLikeProviderError, looksLikeQuotaReached, looksLikeCodeQuestion, looksLikeEmptyPromise } from '../../../src/backend/core/drift-detector.js';

describe('looksLikeMultipleDrafts', () => {
  test('catches a reply offering two drafts', () => {
    assert.ok(looksLikeMultipleDrafts('Draft 1:\nfoo\n\nDraft 2:\nbar'));
    assert.ok(looksLikeMultipleDrafts('**Response A**\nfoo\n**Response B**\nbar'));
    assert.ok(looksLikeMultipleDrafts('Here are two versions.\nVersion 1: x\nVersion 2: y'));
  });

  test('is case- and punctuation-insensitive', () => {
    assert.ok(looksLikeMultipleDrafts('DRAFT #1 ... draft #2'));
    assert.ok(looksLikeMultipleDrafts('Alternative 1: a  Alternative 2: b'));
  });

  describe('does not fire on legitimate output', () => {
    // The pro tier's deep level explicitly asks for enumerated approaches, so
    // these words are expected output, not drift.
    test('enumerated approaches are what deep reasoning was told to produce', () => {
      assert.ok(!looksLikeMultipleDrafts('Approach 1: stream it. Approach 2: buffer it.'));
      assert.ok(!looksLikeMultipleDrafts('Option A: cap by age. Option B: cap by count.'));
    });

    test('a single mention is not a set of alternatives', () => {
      assert.ok(!looksLikeMultipleDrafts('My response: the bug is an off-by-one.'));
      assert.ok(!looksLikeMultipleDrafts('This is version 2 of the API.'));
      assert.ok(!looksLikeMultipleDrafts('Draft 1 is what I went with.'));
    });

    test('the same label repeated is one alternative, not two', () => {
      assert.ok(!looksLikeMultipleDrafts('Draft 1 ... as noted in Draft 1 above.'));
    });

    test('ordinary prose and code are left alone', () => {
      assert.ok(!looksLikeMultipleDrafts('Fixed the loop bound in subtotal().'));
      assert.ok(!looksLikeMultipleDrafts('const version1 = require("v1");'));
    });
  });

  test('junk input is false, not a throw', () => {
    for (const junk of ['', null, undefined, 42, {}, []]) {
      assert.strictEqual(looksLikeMultipleDrafts(junk), false);
    }
  });
});


describe('looksLikeCapabilityDenial — the model forgot it has tools', () => {
  test('catches the real refusal, verbatim from a lost turn', () => {
    assert.equal(looksLikeCapabilityDenial(
      'I cannot execute local commands or access your local file system to list '
      + 'the files in /Users/pratimesh/Documents/Gemini-Agent.',
    ), true);
  });

  test('catches the ways it phrases the same thing', () => {
    for (const text of [
      "I'm unable to run shell commands on your machine.",
      'I am unable to access the file system.',
      "I can't read files in that directory.",
      'As an AI language model, I cannot access your file system.',
      'I do not have the ability to read files from your directory.',
      "I don't have access to your local files.",
    ]) {
      assert.equal(looksLikeCapabilityDenial(text), true, text);
    }
  });

  test('needs the inability to be first-person', () => {
    // Perfectly good prose about someone else's code.
    assert.equal(looksLikeCapabilityDenial(
      'Your script cannot access the file system because it runs in a browser sandbox.',
    ), false);
    assert.equal(looksLikeCapabilityDenial(
      'The run_command tool can execute local commands for you.',
    ), false);
  });

  test('needs a capability, not just a refusal', () => {
    // A plain "no" is not tool amnesia, and retrying it would be a loop.
    assert.equal(looksLikeCapabilityDenial('I cannot help with that request.'), false);
  });

  test('ignores the phrase buried deep in a real answer', () => {
    // A denial leads; a long answer that mentions it is answering, not refusing.
    assert.equal(looksLikeCapabilityDenial('x'.repeat(700) + ' I cannot access your file system.'), false);
  });

  test('is quiet on ordinary output', () => {
    assert.equal(looksLikeCapabilityDenial(
      'I read the file and found three functions that list the directory contents.',
    ), false);
    assert.equal(looksLikeCapabilityDenial(''), false);
    assert.equal(looksLikeCapabilityDenial(undefined), false);
  });
});


describe('looksLikeProviderError — the tab failed, not the model', () => {
  test('catches the message Gemini Web actually returns', () => {
    assert.equal(looksLikeProviderError(
      'I encountered an error doing what you asked. Could you try again?',
    ), true);
  });

  test('catches the other providers\' equivalents', () => {
    for (const text of [
      'Something went wrong. Please try again.',
      'An error occurred. Try again later.',
      'Unable to complete your request.',
    ]) {
      assert.equal(looksLikeProviderError(text), true, text);
    }
  });

  test('length is what separates it from a real answer', () => {
    // A genuine reply that discusses an error is long and specific; the
    // provider's own apology is short and generic. Without this the detector
    // would retry perfectly good answers.
    const realAnswer = 'The build fails because config.js is missing. I encountered an error in '
      + 'the logs at line 40 showing MODULE_NOT_FOUND, and the fix is to add the file back. '.repeat(3);
    assert.equal(looksLikeProviderError(realAnswer), false);
  });

  test('is quiet on ordinary short replies and refusals', () => {
    assert.equal(looksLikeProviderError('Done — I updated three files.'), false);
    assert.equal(looksLikeProviderError('I cannot help with that request.'), false);
    assert.equal(looksLikeProviderError(''), false);
    assert.equal(looksLikeProviderError(undefined), false);
  });
});

/**
 * The fourth detector, and the only one that reads the *user's* words.
 *
 * It exists because the failure reported most often from use — "on the very
 * first prompt Gemini hallucinates and does not act as an agent" — was recorded
 * nowhere. `looksLikeCapabilityDenial` catches an *explicit* refusal and sits at
 * 0.38%; a model that answers from priors, denying nothing and opening nothing,
 * produced no log line at all. `turn0_no_tools` pairs this with "and nothing was
 * opened", which is the pair that is the failure — neither half alone is.
 */
describe('looksLikeCodeQuestion', () => {
  test('the prompts that actually produced the reported failure', () => {
    // Verbatim from the incident. The first cut of this detector returned false
    // for it — a detector that cannot see its own founding case is measuring
    // something else, which is why these two are pinned first.
    assert.ok(looksLikeCodeQuestion('can you help me improve the effort tiers?'));
    assert.ok(looksLikeCodeQuestion('should we send system prompt in chunks again to remind model ?'));
  });

  test('a path, a filename or a repo noun', () => {
    for (const q of [
      'read server/src/core/agent-loop.js',
      'what is in App.jsx',
      'explain the parser module',
      'where is buildPrompt defined',
      'who calls handleGeminiResponse',
      'how does this codebase handle retries',
    ]) assert.ok(looksLikeCodeQuestion(q), `missed: ${q}`);
  });

  test('first person plural is someone talking about their own system', () => {
    for (const q of [
      'should we restrict this',
      'can we fix our agent loop',
      'do we have a test for that',
      'refactor this',
    ]) assert.ok(looksLikeCodeQuestion(q), `missed: ${q}`);
  });

  /*
   * The corpus, taken off disk rather than imagined.
   *
   * Every string below is a real first prompt from `.agent/sessions/`, verbatim
   * including its typos, whose reply cited two or more files with no tool call
   * before it. Eight of them across 38 sessions; the detector caught three, so
   * `turn0_no_tools` reported 0% for a failure running at ~21% of sessions.
   *
   * The five marked MISSED are the regression: each one is a confident answer
   * about this repository written without opening a file, and the last is the
   * one that invented six UI components and an event API.
   */
  test('the real turn-0 prompts from the sessions on disk', () => {
    for (const q of [
      // MISSED before 2026-09-22 — no path, no extension, no "we".
      'can you make a plan on improving effort or system prompt of this to make it '
        + 'closer to gpt 6 astra level , suggest real world improvements on this for '
        + 'different effort levels',
      'can you suggest me imporvement on current system and base prompt in this agetn '
        + ', seems like a mess and the un-organised',
      'an you suggest me imporvement on current system and base prompt in this agetn',
      'can you tell me about ui and watcher',
      // Already caught, by "should we" — pinned so widening cannot lose them.
      'can you help me improvement in effort tier ? should we send system prompt in '
        + 'chunks again to remind model ?',
    ]) assert.ok(looksLikeCodeQuestion(q), `missed: ${q}`);
  });

  test('"this server", and names written as code (v7.9)', () => {
    for (const q of [
      // Verbatim: answered from AGENT.md with nothing opened, and not counted.
      'can you check how the symbol matching is done in this node server',
      'how does find_symbol work',
      'what does buildPrompt return',
      'how is the retry handled',
    ]) assert.ok(looksLikeCodeQuestion(q), `missed: ${q}`);
  });

  // A false positive costs one log row a human reads; a false negative costs
  // the measurement. But it must not fire on everything, or the rate is 100%
  // and says nothing — these are the control.
  test('ordinary questions that deserve no tool call', () => {
    for (const q of [
      'hi', 'thanks!', 'ok', 'tell me a joke',
      'write me a haiku about autumn',
      'what is the capital of France',
      'translate good morning into japanese',
      'summarise this article for me',
      // Added with the domain-noun pattern: these share no word with it, and
      // they are the shape a widened list would start swallowing first.
      'what year did the roman empire fall',
      'give me a recipe for banana bread',
      'is it going to rain tomorrow',
      // Added with the "this <thing>" and identifier patterns (v7.9).
      'how are you doing today',
      'what is the best way to learn the piano',
      'recommend a good book about the history of rome',
    ]) assert.equal(looksLikeCodeQuestion(q), false, `fired on: ${q}`);
  });

  test('nothing is not a question', () => {
    assert.equal(looksLikeCodeQuestion(''), false);
    assert.equal(looksLikeCodeQuestion(null), false);
    assert.equal(looksLikeCodeQuestion(undefined), false);
    assert.equal(looksLikeCodeQuestion('   '), false);
  });
});

describe('looksLikeQuotaReached — a usage limit, not an answer and not a glitch', () => {
  test('catches the plausible shapes of a limit notice', () => {
    for (const text of [
      "You've reached your limit for 2.5 Pro until 4:00 PM.",
      'You have reached your daily usage limit. Upgrade for higher limits.',
      'Your limit resets at 11:30 PM. Try again later.',
      "You've reached the Pro model limit",
    ]) assert.equal(looksLikeQuotaReached(text), true, text);
  });

  test('an answer that talks about rate limits is not one', () => {
    for (const text of [
      'The API has a rate limiter in core/throttle.js that caps requests at 10/s.',
      'Raise the limit in config.json if uploads are being rejected.',
      'The loop stops when it reaches MAX_ROUNDS_PER_TURN.',
      'I updated the retry limit from 2 to 3 in reply-recovery.js.',
    ]) assert.equal(looksLikeQuotaReached(text), false, text);
  });

  test('long replies are never a limit notice', () => {
    assert.equal(looksLikeQuotaReached('x'.repeat(500) + " You've reached your limit."), false);
  });

  test('a plain provider error is not a quota', () => {
    assert.equal(looksLikeQuotaReached('Sorry, something went wrong. Please try your request again.'), false);
  });
});

describe('looksLikeEmptyPromise (v7.9)', () => {
  test('a reply that ends on a promise to look is one', () => {
    for (const text of [
      'Let me check the symbol index.',
      "I'll look at how find_symbol is implemented in this server.",
      'Good question. To answer it properly I need to read context/symbol-index.js. Let me open it.',
      "I'm going to search the codebase for the matcher.",
      'Sure — let me take a look at the agent loop first.',
      'I will now inspect `prompt-builder.js` to see where the rule is added.',
    ]) assert.equal(looksLikeEmptyPromise(text), true, text);
  });

  test('an offer, a question, a kept promise or plain prose is not', () => {
    for (const text of [
      "If you'd like, I can check the tests too.",
      'Would you like me to look at the parser next?',
      'Let me know if you want me to dig into the watcher.',
      'Shall I read the rest of the file?',
      'Let me check the parser: it splits on commas, then trims each field and drops empties. That is why the trailing comma is ignored.',
      'The symbol index is built lazily and cached by mtime.',
      'I checked the parser and it splits on commas.',
      'Should I search for other callers?',
      '',
    ]) assert.equal(looksLikeEmptyPromise(text), false, text);
  });

  test('a long reply is an answer, not a promise', () => {
    assert.equal(looksLikeEmptyPromise('x '.repeat(2100) + 'Let me check the tests.'), false);
  });
});
