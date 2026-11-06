/**
 * The editor companion: which editors have it, at what version, and installing it.
 *
 * Owner, 2026-11-05: `/update` should offer "vscode/antigravity/cursor … multi
 * select also and with a option to select other". The companion is the one piece
 * of a pull that does not update itself: the server restarts and the Chrome
 * extension reloads itself (since 1.58.0), but a `.vsix` has to be installed into
 * each editor. Found on the owner's machine while building this: Cursor on 1.8.13
 * and Antigravity IDE on 1.8.14, with 1.8.15 in the checkout.
 *
 * An editor's command is looked for where each one really puts it, because few
 * are on PATH: VS Code has none here unless it was asked for, and Antigravity IDE
 * keeps its in the app bundle. `Antigravity.app` has no command at that path at
 * all, so a candidate counts only if the file is there.
 *
 * No shell: the path to a `.vsix` is an argument, whatever it contains. Output is
 * piped, so nothing reaches Ink's terminal. Nothing here throws.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { compareVersions } from './extension-version.js';

const exec = promisify(execFile);

export const COMPANION_ID = 'pratimesh-tiwari.cli-agent-companion';

const LIST_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 120_000;

/** `<app>/Contents/Resources/app/bin/<bin>` on macOS; `dotHome` is under the home folder. */
const EDITORS = [
  { id: 'code', name: 'VS Code', command: 'code', app: 'Visual Studio Code.app', bin: 'code' },
  { id: 'cursor', name: 'Cursor', command: 'cursor', app: 'Cursor.app', bin: 'cursor' },
  { id: 'antigravity', name: 'Antigravity', command: 'antigravity', app: 'Antigravity.app', bin: 'antigravity',
    dotHome: '.antigravity/antigravity/bin/antigravity' },
  { id: 'antigravity-ide', name: 'Antigravity IDE', command: 'antigravity-ide', app: 'Antigravity IDE.app', bin: 'antigravity-ide',
    dotHome: '.antigravity-ide/antigravity-ide/bin/antigravity-ide' },
  { id: 'windsurf', name: 'Windsurf', command: 'windsurf', app: 'Windsurf.app', bin: 'windsurf' },
  { id: 'code-insiders', name: 'VS Code Insiders', command: 'code-insiders', app: 'Visual Studio Code - Insiders.app', bin: 'code' },
];

/**
 * The editors on this machine that have a command to call.
 *
 * `AGENT_EDITOR_APPS`, when set, is the only place anything is looked for: PATH and
 * the home folder are skipped as well. So the suite (`''`, nothing) and the pty
 * harness (a folder of fakes) cannot reach a real editor. It used to replace only
 * the app folders, and a harness run found Antigravity IDE on PATH and really
 * installed into it (2026-11-06).
 *
 * @returns {Array<{id: string, name: string, cli: string}>}
 */
export function findEditors({ platform = process.platform, env = process.env, home = homedir(), exists = existsSync } = {}) {
  const fixed = env.AGENT_EDITOR_APPS !== undefined;
  const named = fixed ? env.AGENT_EDITOR_APPS.split(path.delimiter).filter(Boolean) : [];
  const appDirs = fixed ? named : ['/Applications', path.join(home, 'Applications')];
  const binDirs = fixed ? named : String(env.PATH || '').split(path.delimiter).filter(Boolean);
  const found = [];
  for (const editor of EDITORS) {
    const places = [];
    if (platform === 'darwin') {
      for (const dir of appDirs) places.push(path.join(dir, editor.app, 'Contents/Resources/app/bin', editor.bin));
    }
    if (editor.dotHome && !fixed) places.push(path.join(home, editor.dotHome));
    // A Windows command is a `.cmd`, which needs a shell. Those use the Other row.
    if (platform !== 'win32') {
      for (const dir of binDirs) places.push(path.join(dir, editor.command));
    }
    const cli = places.find((p) => exists(p));
    if (cli) found.push({ id: editor.id, name: editor.name, cli });
  }
  return found;
}

/** The newest `.vsix` in this checkout, or null: `{ path, version }`. */
export function companionVsix({ dir = defaultDir(), list = readdirSync } = {}) {
  let names;
  try {
    names = list(dir);
  } catch {
    return null;
  }
  let best = null;
  for (const name of names) {
    const m = /^cli-agent-companion-(\d+\.\d+\.\d+)\.vsix$/.exec(name);
    if (m && (!best || compareVersions(m[1], best.version) > 0)) {
      best = { path: path.join(dir, name), version: m[1] };
    }
  }
  return best;
}

function defaultDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../vscode-companion');
}

/** One line of what went wrong, without the stack an Electron CLI prints. */
const firstLine = (err) => String(err?.stderr || err?.message || err || 'failed').trim().split('\n')[0].slice(0, 120);

/** The version an editor has. `read: false` means it could not say, which is not "not installed". */
export async function readCompanion(editor, { run = exec } = {}) {
  try {
    const { stdout } = await run(editor.cli, ['--list-extensions', '--show-versions'], { timeout: LIST_TIMEOUT_MS, windowsHide: true });
    const row = String(stdout).split('\n').map((l) => l.trim().toLowerCase()).find((l) => l.startsWith(`${COMPANION_ID}@`));
    return { ...editor, read: true, version: row ? row.slice(COMPANION_ID.length + 1) : null };
  } catch (err) {
    return { ...editor, read: false, version: null, error: firstLine(err) };
  }
}

export const readEditors = (editors = findEditors(), options = {}) => Promise.all(editors.map((e) => readCompanion(e, options)));

/**
 * Install, then ask the editor what it has now. An exit code of 0 from these
 * tools has been seen beside "not installed", so the read-back is the answer.
 */
export async function installCompanion(editor, vsix, { run = exec } = {}) {
  try {
    await run(editor.cli, ['--install-extension', vsix.path, '--force'], { timeout: INSTALL_TIMEOUT_MS, windowsHide: true });
  } catch (err) {
    return { ...editor, ok: false, error: firstLine(err) };
  }
  const now = await readCompanion(editor, { run });
  if (now.version === vsix.version) return { ...now, ok: true };
  return { ...now, ok: false, error: now.read ? `it still reports ${now.version || 'nothing installed'}` : now.error };
}

export const isOutdated = (editor, version) => Boolean(editor.version) && compareVersions(editor.version, version) < 0;

/**
 * Is there nothing left to remind about? Every editor answered, and none has an
 * older copy. An editor without the companion is not owed one: this is a reminder
 * about what you have, so a person who never installed it is never nagged.
 */
export const companionSettled = (editors, version) => editors.every((e) => e.read && !isOutdated(e, version));
