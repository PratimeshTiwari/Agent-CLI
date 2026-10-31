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

export function tabUnreachableMessage(url) {
  return `Communication with the Gemini tab failed · check the browser${url ? `\n${url}` : ''}`;
}
