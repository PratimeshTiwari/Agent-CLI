/**
 * What to do with a reply from the browser: use it, or recover from it.
 *
 * Lifted out of `handleGeminiResponse`, which was 510 lines and held five
 * retry policies inline — the unsubmitted resend, the timeout, the JSON
 * repair, the provider error and the tool-amnesia redeclaration — each with
 * its own counter, its own cap and its own idea of what "send it again"
 * meant. That is how the provider retry came to re-ask the wrong question:
 * it rebuilt the prompt from the user's objective while the resend beside it
 * had already learned, and written down, that a resend must be verbatim.
 *
 * The same shape as `tool-policy.js`: decisions here, pure and tested without
 * a loop; the loop keeps the state and does the sending. Nothing in this file
 * logs, sends or mutates.
 */
import {
  looksLikeProviderError,
  looksLikeCapabilityDenial,
  looksLikeQuotaReached,
} from './drift-detector.js';

/**
 * How many times to re-ask when the *provider* errors rather than the model.
 * These are transient by nature, so a couple of attempts clears almost all of
 * them; more than that and something is actually wrong with the tab.
 */
export const MAX_PROVIDER_RETRIES = 2;

/**
 * How many times to ask the model to fix its own tool-call JSON.
 *
 * Every other retry path here is capped — provider errors above, the
 * unsubmitted-prompt resend and tool redeclaration at one shot each. This one
 * was not, so a model stuck on a formatting habit re-asked forever, a full
 * browser turn each round, and only the user could stop it.
 */
export const MAX_PARSE_RETRIES = 2;

/**
 * How long to wait before re-asking after a provider error, per attempt.
 *
 * The retry used to fire the instant the error arrived, and the log shows what
 * that buys: on 2026-09-22 the identical *"I encountered an error doing what
 * you asked"* came back six seconds later, and on 09-24 the immediate retry
 * ran into a `response_timeout`. A provider error is the service saying it is
 * struggling right now; asking again inside the same second asks the same
 * struggling service.
 *
 * Short, because someone is watching the turn: three seconds, then eight. The
 * timer is Node's, on the server — not a page timer in a hidden tab — so it
 * fires when it says it will.
 */
export const PROVIDER_BACKOFF_MS = [3000, 8000];

/** ±20%, so a retry never lands on the same beat as whatever caused the error. */
export const BACKOFF_JITTER = 0.2;

/**
 * The wait before provider retry number `attempt` (1-based).
 *
 * @param {number} attempt
 * @param {() => number} [random] - injectable, so tests are exact
 */
export function providerBackoffMs(attempt, random = Math.random) {
  const base = PROVIDER_BACKOFF_MS[Math.min(attempt, PROVIDER_BACKOFF_MS.length) - 1]
    ?? PROVIDER_BACKOFF_MS[0];
  const spread = base * BACKOFF_JITTER;
  return Math.round(base - spread + random() * 2 * spread);
}

/**
 * A reply that did not complete.
 *
 * @param {{timedOut?: boolean, neverSubmitted?: boolean}} payload
 * @param {{resentUnsubmittedOnce?: boolean, hasLastPrompt?: boolean}} state
 * @returns {{action: 'wait'} | {action: 'resend_unsubmitted'} | {action: 'give_up_timeout'}}
 */
export function classifyIncomplete(payload, state = {}) {
  // Not finished and not timed out: a stream chunk. Nothing to decide.
  if (!payload?.timedOut) return { action: 'wait' };

  /**
   * The one timeout it is *safe* to retry: the prompt was never sent.
   *
   * The content script can tell the difference, and the difference is
   * the whole question. If it saw Gemini generating, the model has an
   * answer we failed to read — resending would ask it twice and the
   * second answer would arrive into a conversation that already
   * contains the first. If it never saw generation start and scraped
   * nothing, the submit itself did not happen: the model has no idea
   * this turn exists, so sending it is not a repeat, it is the first
   * attempt actually landing.
   *
   * Once, and only for the user's own turn. If the submit fails twice
   * the composer or the send button has changed, and the diagnosis
   * `describeScrapeFailure` writes is more use than a third try.
   */
  if (payload.neverSubmitted && !state.resentUnsubmittedOnce && state.hasLastPrompt) {
    return { action: 'resend_unsubmitted' };
  }
  return { action: 'give_up_timeout' };
}

/**
 * A reply whose tool calls could not be parsed.
 *
 * @param {number} attempt - this failure's number in the current run, 1-based
 * @returns {{action: 'repair_json', attempt: number} | {action: 'hand_over_unparsed', attempt: number}}
 */
export function classifyParseFailure(attempt) {
  /**
   * Give up asking, and hand the reply over instead.
   *
   * The raw text almost always contains the answer in prose — the model
   * knew what to do and could not wrap it in JSON. Re-asking a third time
   * costs another full browser turn to get the same malformed reply, and
   * the turn is already lost; showing the text is the only thing left that
   * can still be useful to the person waiting.
   */
  if (attempt > MAX_PARSE_RETRIES) return { action: 'hand_over_unparsed', attempt };
  return { action: 'repair_json', attempt };
}

/**
 * A complete, parsed reply: use it, or recover first.
 *
 * Order matters and is tested. Quota before provider error, because a rate
 * limit's wording ("try again later") matches the provider detector, and
 * retrying a limit twice spends the turn walking into the same wall.
 *
 * @param {{toolCalls: object[], cleanContent: string}} reply
 * @param {{providerRetries?: number, deniedToolsOnce?: boolean, hasObjective?: boolean,
 *          hasLastPrompt?: boolean, canStepDown?: boolean, random?: () => number}} state
 */
export function classifyReply({ toolCalls = [], cleanContent = '' } = {}, state = {}) {
  // A reply that does work is a reply that worked, whatever its prose says.
  if (toolCalls.length > 0) return { action: 'proceed' };

  /**
   * Gemini's usage limit: step down a rung and re-send, once per turn (v5.28).
   *
   * The owner settled what had been left open here ("drop a rung to Flash?
   * wait?"): *"due to quota on pro and argon, then send the lower"*. Never
   * retried on the same model — a limit's wording ("try again later") matches
   * the provider detector, and re-asking walks into the same wall. When there
   * is no rung below, or this turn already stepped down, the reply is shown as
   * it is: it tells the person when the limit resets.
   */
  if (looksLikeQuotaReached(cleanContent)) {
    return state.canStepDown && state.hasLastPrompt
      ? { action: 'step_down', kind: 'quota' }
      : { action: 'proceed', kind: 'quota' };
  }

  // The provider errored rather than the model answering. Re-ask: this is a
  // transient failure of the tab, and the user should not have to notice it.
  if (looksLikeProviderError(cleanContent)) {
    const attempt = (state.providerRetries || 0) + 1;
    if (attempt <= MAX_PROVIDER_RETRIES && state.hasObjective && state.hasLastPrompt) {
      return {
        action: 'reask_provider',
        kind: 'provider_error',
        attempt,
        delayMs: providerBackoffMs(attempt, state.random),
      };
    }
    // Out of retries: the error text is the honest thing to show.
    return { action: 'proceed', kind: 'provider_error', attempt, exhausted: true };
  }

  // The model has forgotten it has tools and refused the task outright. This
  // is the cost of only sending the system prompt every Nth turn: usually it
  // remembers, and when it does not the whole turn is wasted on a confident
  // refusal. Re-send the full prompt and retry the request instead of handing
  // the user a dead end to retype.
  //
  // Once per turn. If it denies its tools again with the definitions right
  // there in front of it, retrying will not help and the reply is the honest
  // thing to show.
  if (looksLikeCapabilityDenial(cleanContent) && !state.deniedToolsOnce && state.hasObjective) {
    return { action: 'redeclare_tools', kind: 'tool_amnesia' };
  }

  return { action: 'proceed' };
}
