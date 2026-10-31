/**
 * Where the agent finds a Jira site and the person's token (v8.1).
 *
 * The site, its kind and the email are settings that follow the person, so
 * they live in `~/.agent/settings.json` under `atlassian`. The token never
 * does: not in a settings file, not in a repo's `config.json` (which a teammate
 * could check in), not in a prompt and not in a log.
 *
 * - macOS: the login Keychain, through `/usr/bin/security`. The value is written
 *   through `security -i` on stdin, so it never appears in a process list, and
 *   read back by the same binary, which the item's access list already allows,
 *   so reading it raises no Keychain prompt.
 * - Elsewhere: `~/.agent/atlassian-token.json`, mode 0600, re-chmodded on every
 *   write as `bridge.json` is (writeFileSync's mode applies only on create).
 * - `ATLASSIAN_SITE`, `ATLASSIAN_EMAIL` and `ATLASSIAN_TOKEN` (or
 *   `ATLASSIAN_API_TOKEN`) win over both, for a machine set up by its company
 *   and for the tests.
 *
 * Built-ins only (plus `paths.js` and `user-settings.js`, which are too): the
 * bin runs `agent atlassian login` before it looks for tsx, as it does for
 * `agent doctor`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { homeDir } from '../core/paths.js';
import { loadUserSettings, saveUserSettings } from '../core/user-settings.js';

export const KEYCHAIN_SERVICE = 'agent-cli-atlassian';

/** `https://x.atlassian.net`, from whatever was typed: no scheme, a trailing slash, a pasted `/browse/X-1`. */
export function normalizeSite(input) {
  let s = String(input ?? '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let url;
  try { url = new URL(s); } catch { return ''; }
  // A pasted issue or page link: keep the context path a Server install may
  // live under (`https://host/jira`), drop what Jira and Confluence add after it.
  const keep = url.pathname.replace(/\/(browse|projects|secure|issues|jira\/software|wiki|display|spaces|rest|login\.jsp)(\/.*)?$/i, '');
  return `${url.protocol}//${url.host}${keep.replace(/\/+$/, '')}`;
}

/** Cloud sites are `*.atlassian.net` (and `jira.com`, the old domain); anything else is Server/DC until asked. */
export function guessKind(site) {
  try {
    const host = new URL(site).host.toLowerCase();
    return /\.(atlassian\.net|jira\.com)$/.test(host) ? 'cloud' : 'dc';
  } catch {
    return 'dc';
  }
}

function hostOf(site) {
  try { return new URL(site).host.toLowerCase(); } catch { return String(site || ''); }
}

const tokenFile = () => path.join(homeDir(), 'atlassian-token.json');

const useKeychain = () => process.platform === 'darwin' && !process.env.AGENT_ATLASSIAN_NO_KEYCHAIN;

function readTokenFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeTokenFile(map) {
  const file = tokenFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * A token goes into `security -i` inside double quotes, so a quote, a
 * backslash or whitespace in it would end the value early. Atlassian tokens
 * are base64-ish; anything else is refused rather than stored mangled.
 */
export function isStorableToken(token) {
  return typeof token === 'string' && token.length > 0 && !/["\\\s]/.test(token);
}

let cached = null; // { key, token } — a Keychain read is a process spawn

export function storeToken(site, token) {
  if (!isStorableToken(token)) throw new Error('That token has spaces, quotes or backslashes in it; copy it again.');
  const host = hostOf(site);
  if (useKeychain()) {
    const r = spawnSync('/usr/bin/security', ['-i'], {
      input: `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a "${host}" -w "${token}"\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (r.status !== 0 || /error/i.test(r.stderr || '')) {
      throw new Error(`The Keychain refused the token: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
    }
  } else {
    writeTokenFile({ ...readTokenFile(), [host]: token });
  }
  cached = { key: host, token };
}

export function readToken(site) {
  if (process.env.ATLASSIAN_TOKEN || process.env.ATLASSIAN_API_TOKEN) {
    return process.env.ATLASSIAN_TOKEN || process.env.ATLASSIAN_API_TOKEN;
  }
  const host = hostOf(site);
  if (cached?.key === host) return cached.token;
  let token = '';
  if (useKeychain()) {
    const r = spawnSync('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', host, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    token = r.status === 0 ? String(r.stdout || '').trim() : '';
  } else {
    token = readTokenFile()[host] || '';
  }
  if (token) cached = { key: host, token };
  return token;
}

export function removeToken(site) {
  const host = hostOf(site);
  if (cached?.key === host) cached = null;
  if (useKeychain()) {
    spawnSync('/usr/bin/security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', host], { stdio: 'ignore' });
  }
  const map = readTokenFile();
  if (map[host]) {
    delete map[host];
    writeTokenFile(map);
  }
}

/** For the tests: forget the in-memory copy. */
export function _resetTokenCache() {
  cached = null;
}

/**
 * The configured site, or null. Environment first; then settings. The token is
 * *not* read here — answering "is Jira set up?" must not spawn a process on
 * every prompt build.
 *
 * @returns {{site: string, kind: 'cloud'|'dc', email: string, from: 'env'|'settings'}|null}
 */
export function atlassianSite() {
  const envSite = normalizeSite(process.env.ATLASSIAN_SITE);
  if (envSite) {
    const kind = /^(cloud|dc)$/.test(process.env.ATLASSIAN_KIND || '') ? process.env.ATLASSIAN_KIND : guessKind(envSite);
    return { site: envSite, kind, email: process.env.ATLASSIAN_EMAIL || '', from: 'env' };
  }
  const a = loadUserSettings().atlassian;
  const site = normalizeSite(a?.site);
  if (!site) return null;
  return { site, kind: a.kind === 'cloud' || a.kind === 'dc' ? a.kind : guessKind(site), email: a.email || '', from: 'settings' };
}

/** The site plus its token, or a sentence saying what is missing. */
export function atlassianCredentials() {
  const cfg = atlassianSite();
  if (!cfg) {
    return { error: 'Jira is not set up. Ask the user to run `agent atlassian login` in a terminal.' };
  }
  const token = readToken(cfg.site);
  if (!token) {
    return { error: `No token is stored for ${cfg.site}. Ask the user to run \`agent atlassian login\` in a terminal.` };
  }
  if (cfg.kind === 'cloud' && !cfg.email) {
    return { error: `Jira Cloud needs the account's email, and none is stored for ${cfg.site}. Ask the user to run \`agent atlassian login\`.` };
  }
  return { ...cfg, token };
}

export function saveAtlassianSite({ site, kind, email }) {
  return saveUserSettings({ atlassian: { site: normalizeSite(site), kind, email: email || '' } });
}

export function forgetAtlassianSite() {
  const cfg = loadUserSettings().atlassian;
  if (cfg?.site) removeToken(normalizeSite(cfg.site));
  return saveUserSettings({ atlassian: undefined });
}
