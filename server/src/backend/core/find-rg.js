import { existsSync, statSync } from 'fs';
import os from 'os';
import path from 'path';

/**
 * Where ripgrep is, when it is anywhere.
 *
 * Asked 2026-10-28, about the work laptop: no Homebrew, so `brew install
 * ripgrep` is not an option. It does not need to be — **every VS Code ships
 * ripgrep**, because its own search runs on it, and so does Cursor. On the
 * owner's machine: VS Code's `@vscode/ripgrep-universal/bin/darwin-<arch>/rg`
 * (15.0.0) and Cursor's `@vscode/ripgrep/bin/rg`. Using the editor's copy
 * installs nothing and needs no network, which is the whole constraint on a
 * managed machine.
 *
 * Order: `AGENT_RG` (an explicit path wins), a real `rg` on PATH, then the
 * editors' bundles. A shell function named `rg` is not on PATH as a file and
 * does not count — `execFile` cannot run it, which is what grep_search's
 * fallback note already says.
 */

const isFile = (p) => {
  try { return statSync(p).isFile(); } catch { return false; }
};

/** A real `rg` file on PATH, or null. */
export function rgOnPath({ env = process.env, platform = process.platform } = {}) {
  const names = platform === 'win32' ? ['rg.exe', 'rg.cmd', 'rg'] : ['rg'];
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const p = path.join(dir, n);
      if (isFile(p)) return p;
    }
  }
  return null;
}

/** The editor bundles to look in, newest layout first, this machine's arch first. */
export function editorCandidates({
  platform = process.platform, arch = process.arch, home = os.homedir(),
  appDirs = ['/Applications', path.join(home, 'Applications')],
} = {}) {
  const archDirs = arch === 'arm64' ? ['darwin-arm64', 'darwin-x64'] : ['darwin-x64', 'darwin-arm64'];
  const out = [];
  if (platform === 'darwin') {
    const apps = ['Visual Studio Code.app', 'Visual Studio Code - Insiders.app', 'Cursor.app', 'VSCodium.app'];
    for (const base of appDirs) {
      for (const app of apps) {
        const res = path.join(base, app, 'Contents', 'Resources', 'app');
        for (const a of archDirs) {
          out.push({ editor: app.replace(/\.app$/, ''), path: path.join(res, 'node_modules.asar.unpacked', '@vscode', 'ripgrep-universal', 'bin', a, 'rg') });
        }
        out.push({ editor: app.replace(/\.app$/, ''), path: path.join(res, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', 'rg') });
        out.push({ editor: app.replace(/\.app$/, ''), path: path.join(res, 'node_modules', '@vscode', 'ripgrep', 'bin', 'rg') });
      }
    }
  } else if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    for (const [editor, dir] of [['Visual Studio Code', path.join(local, 'Programs', 'Microsoft VS Code')], ['Cursor', path.join(local, 'Programs', 'cursor')]]) {
      out.push({ editor, path: path.join(dir, 'resources', 'app', 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', 'rg.exe') });
      out.push({ editor, path: path.join(dir, 'resources', 'app', 'node_modules', '@vscode', 'ripgrep', 'bin', 'rg.exe') });
    }
  } else {
    for (const dir of ['/usr/share/code', '/usr/share/code-insiders', '/opt/cursor']) {
      out.push({ editor: path.basename(dir), path: path.join(dir, 'resources', 'app', 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', 'rg') });
    }
  }
  return out;
}

let cached;

/**
 * `{ path, source }` — source is `env`, `path` or the editor's name — or null.
 * Cached for the process: the answer changes only when something is installed,
 * and `/doctor`'s install path calls `forgetRg()`.
 */
export function findRg(opts = {}) {
  if (cached !== undefined && !opts.fresh) return cached;
  const env = opts.env || process.env;
  let found = null;
  if (env.AGENT_RG && isFile(env.AGENT_RG)) found = { path: env.AGENT_RG, source: 'env' };
  if (!found) {
    const p = rgOnPath({ env, platform: opts.platform });
    if (p) found = { path: p, source: 'path' };
  }
  if (!found) {
    const hit = editorCandidates(opts).find((c) => existsSync(c.path));
    if (hit) found = { path: hit.path, source: hit.editor };
  }
  if (!opts.fresh) cached = found;
  return found;
}

export function forgetRg() {
  cached = undefined;
}
