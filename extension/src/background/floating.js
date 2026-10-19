/**
 * The global shortcut: bring up the floating Agent CLI window from anywhere.
 *
 * Declared in the manifest as a `global` command, so it fires while Chrome is
 * running but not in front — the closest an extension gets to the Gemini
 * panel Chrome draws for itself, which no extension API can open or reach.
 * Chrome only *suggests* Ctrl+Shift+0–9 for global commands (⌘⇧ on a Mac);
 * anyone can remap it at chrome://extensions/shortcuts.
 *
 * Focus an existing window rather than open another. Pressing a shortcut twice
 * must not leave two windows that each think they are the panel.
 */

export const FLOATING_COMMAND = 'open-floating-panel';
const PANEL_PATH = 'side-panel/panel.html';

/** The page the pop-out button opens, so the shortcut and the button agree. */
export const floatingUrl = () => chrome.runtime.getURL(`${PANEL_PATH}?window=1`);

/**
 * @returns {Promise<'focused'|'created'|'failed'>}
 */
export async function openFloatingPanel() {
  const prefix = chrome.runtime.getURL(PANEL_PATH);
  try {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    const existing = windows.find((w) => (w.tabs || []).some((t) => (t.url || '').startsWith(prefix)));
    if (existing) {
      // `drawAttention` as well: from another app, focusing alone can leave
      // Chrome behind on some window managers, and a shortcut that seems to do
      // nothing is worse than none.
      await chrome.windows.update(existing.id, { focused: true, drawAttention: true });
      return 'focused';
    }
    await chrome.windows.create({ url: floatingUrl(), type: 'popup', width: 460, height: 760, focused: true });
    return 'created';
  } catch (err) {
    console.warn('[Agent CLI] could not open the floating window:', err?.message);
    return 'failed';
  }
}

export function handleCommand(command) {
  if (command === FLOATING_COMMAND) return openFloatingPanel();
  return null;
}
