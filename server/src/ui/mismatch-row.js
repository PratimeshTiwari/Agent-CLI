/**
 * The model-mismatch warning above the input, as words (v7.9).
 *
 * It was one row, `⚠ tab is on 3.8 Flash · effort High wants 3.1 Pro · your
 * next message asks first · ctrl+b shows the tab`, and the owner asked for it
 * simpler: the facts on one line, what happens next on the line under it.
 *
 *     ⚠ Model mismatch · browser 3.8 Flash ≠ agent 3.1 Pro · ask
 *       Your next message asks first · ctrl+b shows the tab · /settings → Browser differs
 *
 * The names lead line 1, so a narrow terminal cuts the policy word, not them.
 * Line 2 is dropped below `MISMATCH_TWO_LINES_FROM` rows (App charges it).
 */

/** Terminal height from which the second line is drawn. */
export const MISMATCH_TWO_LINES_FROM = 16;

/** The tail of line 2: how to see the tab, and where the setting lives. */
export const MISMATCH_KEYS = 'ctrl+b shows the tab · /settings → Browser differs';

/**
 * What the next message does about it, in one clause.
 *
 * @param {object} o
 * @param {string} o.current   the tab's model
 * @param {string} o.wanted    the effort's model
 * @param {'ask'|'follow'|'switch'} o.policy
 * @param {boolean} o.asks     the next message will stop and ask (not yet answered)
 * @param {string} [o.sentPrompt]  the rung whose prompt goes out, when it is not the effort's
 */
export function mismatchNext({ current, wanted, policy, asks, sentPrompt }) {
  if (asks) return 'Your next message asks first';
  if (policy === 'switch') return `Your next message switches the tab to ${wanted} first`;
  if (sentPrompt) return `Sending the ${sentPrompt} prompt, written for ${current}`;
  return `Messages go to ${current} as it is`;
}

/** Rows the warning takes at this height: none, one, or two. */
export function mismatchRows(mismatch, terminalHeight) {
  if (!mismatch) return 0;
  return terminalHeight >= MISMATCH_TWO_LINES_FROM ? 2 : 1;
}
