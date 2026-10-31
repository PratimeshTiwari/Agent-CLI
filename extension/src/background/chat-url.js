/**
 * What a Gemini tab's URL says about the conversation in it.
 *
 * `/app` is a new chat; `/app/<id>` is a conversation. A `/u/<n>` prefix picks
 * the Google account, and it has to survive any navigation done here: going to
 * the bare `/app` from `/u/1/app/<id>` opens a new chat on a *different*
 * account.
 *
 * Pure, so `node --test` can hold it without a browser.
 */

const CHAT_PATH = /^(\/u\/\d+)?\/app(?:\/([^/?#]+))?\/?$/;

/** `{ account, thread }` for a Gemini chat URL, else null. */
export function chatPath(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'gemini.google.com') return null;
  const m = CHAT_PATH.exec(parsed.pathname);
  if (!m) return null;
  return { account: m[1] || '', thread: m[2] || null };
}

/** A new chat already: nothing typed into it yet, so there is nothing to leave. */
export function isFreshChat(url) {
  const at = chatPath(url);
  return Boolean(at && !at.thread);
}

/** Where a new chat is, on the same account as `url`. */
export function freshChatUrl(url) {
  const at = chatPath(url);
  return `https://gemini.google.com${at?.account || ''}/app`;
}

/**
 * Where the tab has to go before a prompt for this session is typed, or null
 * when it is already there or the server named no chat (1.58.0).
 *
 * Owner: "the agent should be intelligent enough to check whether it is
 * continuing on the same chat". The server sends `threadUrl` with every main
 * prompt; a tab on any other chat — or on a blank one — would answer a
 * question that chat never saw. The tab's account wins when the server's URL
 * has none, or `/app/<id>` would look on account 0 and not find it.
 */
export function chatToReturnTo(tabUrl, threadUrl) {
  const want = chatPath(threadUrl || '');
  if (!want?.thread) return null;
  const at = chatPath(tabUrl || '');
  if (at?.thread === want.thread) return null;
  return `https://gemini.google.com${want.account || at?.account || ''}/app/${want.thread}`;
}
