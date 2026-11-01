/**
 * When the browser last told us anything about the running turn.
 *
 * "Taking a while — make sure the Chrome tab is not minimised" used to appear
 * on a fixed 10s timer, so it showed on almost every turn while the reply was
 * visibly streaming. Reported: *"this shows up almost instantly"*. The advice
 * is only true when nothing is arriving, so the clock is silence, not age:
 * every message the loop hands the front-end (a streamed chunk, a status, a
 * tool row) resets it.
 *
 * Module state rather than React state on purpose: a stream chunk arrives many
 * times a second, and a setState per chunk is the re-render storm App.jsx
 * avoids during streaming. The UI samples this once a second instead.
 */
import { resolveEffort } from '../../backend/core/models/effort.js';

let lastAt = Date.now();

export function noteActivity(now = Date.now()) {
  lastAt = now;
}

export function lastActivityAt() {
  return lastAt;
}

/**
 * Seconds of silence before the tab advice is worth showing. High and Max run
 * on Pro and Argon, which routinely think for half a minute before a first word.
 */
export function slowAfterMs(effortId) {
  return resolveEffort(effortId).tier === 'pro' ? 60_000 : 30_000;
}

/** Silent long enough? Counted from the later of the turn start and the last message. */
export function isSilentTooLong({ now, turnStartedAt, lastAt: at, effortId }) {
  return now - Math.max(turnStartedAt, at) >= slowAfterMs(effortId);
}
