/**
 * What the terminal says when the tab could not send a prompt (v7.10).
 *
 * By the time this arrives the extension has sent, re-injected its script,
 * hard-reloaded the tab and reopened the chat in a fresh tab (1.56.0), so
 * there is nothing left for advice to add. The owner, after a three-line
 * version: "too verbose, keep it simple". One line, and the chat as a link
 * (cmd+click) on its own line so it is never cut. The page's reason is in
 * `/logs extension`, not here.
 */
/**
 * The tab could not be put back on this session's chat (v8.1, extension
 * 1.58.0), so nothing was typed. Owner: "if agent fails then show a warning to
 * user and tell user to switch manually". Both chats, and the way out.
 */
export function chatUnreachableMessage(wanted) {
  return `Not sent · the tab could not get back to this session's chat ${wanted || ''}`.trimEnd()
    + '\n/chat <link or id> continues in a chat you choose · /new starts fresh';
}

/**
 * A subagent's tab failed, not the user's (v8.4). Reported: the log and the
 * side panel said "Communication with the gemini tab failed", which reads as
 * the main chat breaking while the user's turn went on. The log row says
 * whose tab it was; `subagentTabFailure` is the reason the subagent's result
 * gives, which the terminal's `ask_subagent` row shows.
 */
export const SUBAGENT_TAB_FAILED = 'A subagent\'s Gemini tab failed · your turn goes on without it';

export function subagentTabFailure(detail) {
  return `its Gemini tab failed${detail ? ` (${String(detail).replace(/\.$/, '')})` : ''}`;
}

/**
 * The main tab was closed (v8.10). Owner: end the turn and say so, do not
 * reopen and resend. Idle, the same words are a row of their own.
 */
export function tabClosedMessage(url) {
  return `The Gemini tab was closed · your next message reopens it${url ? `\n${url}` : ''}`;
}

/** Closed between rounds: the turn is still going, and its next step reopens the chat. */
export const TAB_CLOSED_MID_TURN = 'The Gemini tab was closed · the next step reopens it';

export function tabUnreachableMessage(url) {
  return `Communication with the Gemini tab failed · check the browser${url ? `\n${url}` : ''}`;
}
