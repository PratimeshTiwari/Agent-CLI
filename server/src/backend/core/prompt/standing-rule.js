/**
 * Does this message state something that should outlive the session? (v9.4)
 *
 * `manage_memory` had 0 calls in this repo's usage log and `memory.md` held no
 * fact: naming a tool is not a trigger (CLAUDE.md, Tools). This is the moment of
 * relevance, and prompt v6 adds one line to that turn.
 *
 * **Narrow on purpose.** Replayed over 195 of the owner's real messages, most
 * are one-off requests in the same shape as a rule: "X should Y", "don't show Z",
 * "instead of A, B". Matching those would add the line to nearly every turn, and a
 * line on every turn is a list of names by another route. So this matches words
 * that say *lasting* or *you already got this wrong*, and misses plenty. The line
 * only asks: the model decides whether anything is worth keeping.
 */

/** Longer than this is a paste: a log, a report, a reply quoted back. */
const MAX_LENGTH = 600;

const VERBS = 'ask|use|run|do|check|show|keep|commit|push|merge|add|write|test|start|put|make|say|send|open|update|delete|remove|include|prefer|branch|rebase';

const SIGNALS = [
  // Lasting, in so many words.
  /\bfrom now on\b/i,
  /\bgoing forward\b/i,
  /\bin future\b/i,
  /\bnext time\b/i,
  /\bremember (that|this|to)\b/i,
  /\bkeep in mind\b/i,
  new RegExp(`\\b(always|never)\\s+(${VERBS})\\b`, 'i'),
  // How this project or person works.
  /\bwe (always|never|don'?t use|do not use)\b/i,
  /\bwe use\b/i,
  // Told before.
  /\bi (already )?(told|asked) you\b/i,
  /\bi only (told|asked|said)\b/i,
  /\bnot what i (asked|said|meant|wanted)\b/i,
  /\byou (forgot|ignored)\b/i,
  /\bthat'?s (wrong|incorrect|not right)\b/i,
];

/** @param {string} message what the person typed */
export function looksLikeStandingRule(message) {
  const text = String(message ?? '').trim();
  if (!text || text.length > MAX_LENGTH) return false;
  return SIGNALS.some((signal) => signal.test(text));
}

/** The line that turn carries. It says what to do when the guess is wrong. */
export const MEMORY_NUDGE = '<memory_nudge>If the message below corrects you or sets a rule that will '
  + 'still hold next session, save it with manage_memory (add, with why) in your next reply. If it '
  + 'does not, ignore this.</memory_nudge>';
