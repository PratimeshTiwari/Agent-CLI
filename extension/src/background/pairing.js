/**
 * Which Chrome profile this is (v9.3).
 *
 * An extension cannot read its profile's name, so it keeps an id of its own in
 * `storage.local`, which is per profile. And it proves where it is by seeing a
 * link only the agent opened: `/chrome` opens one profile on
 * `gemini.google.com/app#agent-pair=<token>`. The token is a fragment, so it
 * never reaches Google.
 */
import { sendToServer } from './messaging.js';

const TOKEN = /#agent-pair=([0-9a-f]{32})$/;
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
}
