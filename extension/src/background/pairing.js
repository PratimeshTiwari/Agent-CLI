/**
 * Which Chrome profile this is (v9.3).
 *
 * An extension cannot read its profile's name, so it keeps an id of its own in
 * `storage.local`, which is per profile. And it proves where it is by seeing a
 * link only the agent opened: `/chrome` opens one profile on
 * `gemini.google.com/app#g7k=<token>` (`#agent-pair=` before 1.72.0). The token
 * is a fragment, so it is never sent to Google in a request; the page's own
 * scripts could read it, which is why the content script removes it from the
 * address as soon as it has read it. It is random, used once, and dead after
 * two minutes, and only the agent on this machine checks it.
 */
import { sendToServer } from './messaging.js';

const TOKEN = /#(?:g7k|agent-pair)=([0-9a-f]{32})$/;
const HELD = 'heldPairTokens';
const reported = new Set();

export const pairTokenOf = (url) => String(url || '').match(TOKEN)?.[1] || null;

export async function installId() {
  const { installId: saved } = await chrome.storage.local.get('installId');
  if (saved) return saved;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ installId: id });
  return id;
}

function report(token) {
  if (!token || reported.has(token)) return;
  reported.add(token);
  sendToServer({ type: 'pair', payload: { token } });
}

/** A tab that just moved. Asleep or unconnected, `reportOpenPairings` finds it on connect. */
export function reportPairing(url, connected) {
  if (connected) report(pairTokenOf(url));
}

/**
 * On connect. A profile that Chrome is starting for this link opens the tab
 * before the worker exists, so no tab event will ever say so.
 */
export async function reportOpenPairings() {
  const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' }).catch(() => []);
  for (const tab of tabs) report(pairTokenOf(tab.url));
  // Read by a content script, out of the address, while nothing was connected.
  try {
    const { [HELD]: held = [] } = await chrome.storage.session.get(HELD);
    await chrome.storage.session.set({ [HELD]: [] });
    for (const token of held) report(token);
  } catch { /* gone with the session */ }
}

/**
 * A token a content script read and removed from its address (1.72.0). The
 * address no longer carries it, so it is reported now or kept until connect.
 */
export async function reportPairToken(token, connected) {
  if (!/^[0-9a-f]{32}$/.test(String(token || ''))) return;
  if (connected) return report(token);
  try {
    const { [HELD]: held = [] } = await chrome.storage.session.get(HELD);
    await chrome.storage.session.set({ [HELD]: [...new Set([...held, token])].slice(-4) });
  } catch { /* lost; /chrome can be run again */ }
}
