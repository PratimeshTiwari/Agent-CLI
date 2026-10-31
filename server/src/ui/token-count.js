/**
 * The spinner's token count climbs instead of jumping (v7.10).
 *
 * Asked for: "like claude progressively increases token to a number and we
 * just straight out bump it up". Two parts:
 *
 * - **What it counts.** The thread's tokens (`AgentLoop.contextTokens`) plus
 *   the reply Gemini is writing now. The tab sends that text every 2 s while it
 *   streams, and it used to be ignored, so the number stood still for the whole
 *   reply and then jumped when it landed. A streamed reply counts only until the
 *   loop adds the finished one (`base` is the thread's size when it streamed),
 *   so it is never counted twice.
 * - **How it moves.** Toward that number by a share of the gap on each spinner
 *   tick (80 ms), which spreads a 2 s stream update over the 2 s until the
 *   next one. It runs on the tick App already draws, so it writes no extra
 *   frames. A count that falls (`/compact`, `/new`) drops at once: the climb
 *   is for work, not for a reset.
 */

/** Share of the gap closed per tick: ~88% of a step in 25 ticks (2 s). */
const EASE = 0.08;

/** One tick toward `target`. */
export function easeCount(shown, target) {
  if (!Number.isFinite(shown) || target <= shown) return target;
  return Math.min(target, shown + Math.max(1, Math.ceil((target - shown) * EASE)));
}

/** Tokens in a reply still being written, while the loop has not added it. */
export function streamTokens(stream, contextChars) {
  if (!stream || stream.base !== contextChars) return 0;
  return Math.round(stream.chars / 4);
}

/** `950`, `29.4k`. */
export function formatTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
