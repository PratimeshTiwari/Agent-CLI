/**
 * What the terminal says when the tab could not send a prompt (v7.10).
 *
 * The extension's own text ended "Hard-refresh the tab (Cmd+Shift+R) and try
 * again", which read like keys to press here. And it never said that the tab
 * had already been reloaded: by the time this arrives the extension has sent,
 * re-injected its script and reloaded the tab (`sendWithRepairs`). So this
 * says what was tried, the real reason when the page gave one, the key that
 * brings the tab up from here, and that the message is kept.
 */

/** Extension builds before 1.56.0 send only this, which says nothing. */
const GENERIC = /^Content script reported failure$/;

export function tabUnreachableMessage(payload, { kept = false } = {}) {
  const detail = String(payload?.detail || '').trim();
  const why = detail && !GENERIC.test(detail) ? ` (${detail})` : '';
  return `Could not send to the Gemini tab, even after reloading it${why}.\n`
    + 'ctrl+b brings the tab up: check it shows a chat you can type in, with no sign-in page or dialog in the way.'
    + (kept ? ' Your message is kept and goes with the next one.' : '');
}
