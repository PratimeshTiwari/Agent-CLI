/**
 * Is the extension Chrome is running the one in this source tree?
 *
 * Reported from use on 2026-09-24, and it cost most of a day.
 * `chrome://extensions` showed **1.25.0** while the loaded copy still had
 * `github.com/*` site access — a permission removed on 2026-09-19. So the
 * version badge was a number someone had typed into a manifest, not evidence
 * of anything, and six `model_options_unanswered` failures were diagnosed as a
 * broken picker selector when the selectors were provably fine: the loaded
 * build simply predated the code that reads them.
 *
 * The server cannot tell "stale content script" from "Gemini changed a
 * selector" by watching failures, because the two look identical from here.
 * It can tell them apart by asking, which costs one field on a handshake that
 * already happens.
 *
 * **The extension reports `chrome.runtime.getManifest().version`**, read out
 * of the bundle Chrome actually loaded, and this compares it with the manifest
 * beside the running server. Neither number is trusted on its own; the
 * disagreement is the signal.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

let cached;

/**
 * The version in this checkout's `extension/manifest.json`, or null.
 *
 * Resolved from this module's own location rather than from the workspace: the
 * agent is usually pointed at some *other* project, and the extension that
 * matters is the one next to the server that is running.
 *
 * Null when it cannot be read — an installed copy with no source tree beside
 * it, a packed release. Null means "no opinion", never "mismatch": a check
 * that fires when it has no information is one people learn to ignore, which
 * costs more than the staleness it was meant to catch.
 */
export function expectedExtensionVersion() {
  if (cached !== undefined) return cached;
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // server/src/backend/core/install
    const manifest = resolve(here, '../../../../../extension/manifest.json');
    cached = JSON.parse(readFileSync(manifest, 'utf8')).version || null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Tests only: what the checkout's manifest says (undefined reads it again). */
export function _setExpectedExtensionVersion(v) {
  cached = v;
}

/**
 * What to say about the version the extension just reported, or null.
 *
 * @param {string|null|undefined} reported what `identify` carried
 * @param {string|null} [expected] override, for tests
 * @returns {string|null} one line for the transcript, or null when there is
 *   nothing worth saying
 */
export function extensionVersionNotice(reported, expected = expectedExtensionVersion()) {
  if (!expected) return null; // no source tree to compare against

  /*
   * No version at all is the case this was written for.
   *
   * Every build before 1.26.0 sends `{clientType: 'extension'}` and nothing
   * else, so silence here is itself the answer — and it is the *only* reading
   * available for exactly the builds old enough to be the problem.
   */
  if (!reported) {
    return updateLine('unknown', expected);
  }

  if (String(reported) === String(expected)) return null;

  /*
   * Newer than this agent (v7.9): the checkout was updated and Chrome reloaded
   * while this process kept running, so it still expects the old number.
   * Reported as `Extension update · 1.55.0 → 1.54.0`, an "update" to a lower
   * version. The agent is what is stale, and a restart is the fix.
   */
  if (compareVersions(reported, expected) > 0) {
    return `⚠ Agent restart needed · extension ${reported}, this agent expects ${expected} · /restart`;
  }

  return updateLine(reported, expected);
}

/** The first build that answers `reload_extension` (`chrome.runtime.reload()`). */
export const SELF_RELOAD_SINCE = '1.58.0';

/**
 * When the extension can be reloaded from here, the line to say so; else null.
 *
 * v8.1, owner: the update notice "should be a clickable link". It cannot be:
 * nothing on macOS opens a `chrome://` URL, so a terminal link to
 * chrome://extensions does nothing. A build since 1.58.0 reloads itself
 * instead, and the manual line is left to the builds before it.
 *
 * @returns {{to: string, message: string}|null}
 */
export function selfReloadNotice(reported, expected = expectedExtensionVersion()) {
  if (!reported || !expected) return null;
  if (compareVersions(reported, expected) >= 0) return null;
  if (compareVersions(reported, SELF_RELOAD_SINCE) < 0) return null;
  return { to: expected, message: `↻ Extension updated · ${reported} → ${expected}` };
}

/** -1, 0 or 1 for dotted numeric versions; a non-numeric part counts as 0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/*
 * One short line (v6.19). It was two sentences, ~120 characters, and wrapped
 * under the banner on every start with a stale build — owner: "simplify this
 * line, extension update available, current, latest, reload at
 * chrome://extensions". Current → latest as an arrow, because spelled out it
 * was 83 characters and wrapped at 80 columns under the pty. The versions
 * lead, so a narrower terminal cuts the instruction rather than the numbers.
 */
const updateLine = (current, latest) =>
  `⚠ Extension update · ${current} → ${latest} · reload at chrome://extensions`;

/**
 * What to say when the extension's global shortcut has no key, or null.
 *
 * Chrome applies a manifest's `suggested_key` only on **first install**. An
 * unpacked extension that is reloaded — every update here — gains the command
 * with nothing bound, and pressing ⌘⇧1 does nothing with no error anywhere.
 * Reported from use the day it shipped. Only the browser can see it, so the
 * extension reports `floatingShortcut` on identify: `''` means unbound, `null`
 * means it could not tell (an older build sends nothing at all) and says
 * nothing rather than guess.
 *
 * @param {string|null|undefined} shortcut
 */
export function shortcutNotice(shortcut) {
  if (shortcut !== '') return null;
  return '⌨ The floating-window shortcut has no key. Chrome only assigns suggested '
    + 'shortcuts when an extension is first installed, not on reload. Set it at '
    + 'chrome://extensions/shortcuts → "Open the Agent CLI floating window" '
    + '(e.g. ⌘⇧1), and choose **Global** so it works from other apps.';
}
