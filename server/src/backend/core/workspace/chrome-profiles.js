/**
 * Chrome's profiles, read from its own files (v9.3).
 *
 * `Local State` names them. Each profile's `Secure Preferences` says what is
 * loaded in it, which is how the list can say where this checkout's extension
 * is. An email here is who signed in to Chrome, which is not always who is
 * signed in to Gemini: only the page knows that.
 *
 * Reads only, and nothing here throws: no Chrome is an empty list.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The folder a person points Load unpacked at. */
export const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../extension');

export function chromeDataDir({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  if (platform === 'darwin') return join(home, 'Library/Application Support/Google/Chrome');
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData/Local'), 'Google/Chrome/User Data');
  return join(home, '.config/google-chrome');
}

const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};

function holdsExtension(dataDir, dir, extensionDir) {
  const prefs = readJson(join(dataDir, dir, 'Secure Preferences'));
  const settings = prefs?.extensions?.settings || {};
  return Object.values(settings).some((s) => s?.path === extensionDir);
}

/**
 * @returns {{dir: string, name: string, email: string, hasExtension: boolean}[]}
 *   the ones holding the extension first: those are the ones that can answer
 */
export function listChromeProfiles({ dataDir = chromeDataDir(), extensionDir = EXTENSION_DIR } = {}) {
  const cache = readJson(join(dataDir, 'Local State'))?.profile?.info_cache || {};
  return Object.entries(cache)
    .map(([dir, info]) => ({
      dir,
      name: String(info?.name || dir),
      email: String(info?.user_name || ''),
      hasExtension: holdsExtension(dataDir, dir, extensionDir),
    }))
    .sort((a, b) => (b.hasExtension - a.hasExtension) || a.name.localeCompare(b.name));
}

/** How to open a URL in one profile. `--profile-directory` is Chrome's own switch. */
export function chromeLaunch(dir, url, { platform = process.platform, env = process.env } = {}) {
  const flag = `--profile-directory=${dir}`;
  if (platform === 'darwin') return { cmd: 'open', args: ['-na', 'Google Chrome', '--args', flag, url] };
  if (platform === 'win32') {
    const base = env.PROGRAMFILES || 'C:\\Program Files';
    return { cmd: join(base, 'Google/Chrome/Application/chrome.exe'), args: [flag, url] };
  }
  const found = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((p) => existsSync(p));
  return { cmd: found || 'google-chrome', args: [flag, url] };
}

/**
 * Never a shell, because a profile's name comes from a file, and nothing
 * inherited, because our stderr is Ink's terminal.
 *
 * @returns {boolean} whether it was started
 */
export function openChromeProfile(dir, url, { launch = spawn, ...opts } = {}) {
  try {
    const { cmd, args } = chromeLaunch(dir, url, opts);
    const child = launch(cmd, args, { detached: true, stdio: 'ignore' });
    child.on?.('error', () => { /* no Chrome here: the wait that follows says so */ });
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
