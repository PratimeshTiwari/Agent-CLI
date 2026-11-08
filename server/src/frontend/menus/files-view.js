/**
 * `/files` (v9.9.1): where this project's things are, on one screen.
 *
 * Asked for as step A of the `.agent` plan (handoff 2026-11-08): the files a
 * person reads — the task list, plans, memory — sit in a dot folder Finder and
 * `ls` hide, beside eight folders only the agent uses, and the conversation is
 * kept twice. Each row's path is an OSC 8 link (cmd+click opens the file or
 * folder); enter shows it in Finder. Paths come from `core/workspace/paths.js`,
 * so a monorepo scope and the home copy are where the agent really keeps them.
 *
 * Pure: the rows and the command are decided here and drawn by `Menus.jsx`.
 */
import nodeFs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import * as paths from '../../backend/core/workspace/paths.js';

/** What the folder's own README is called (step B writes it). */
export const AGENT_README = 'README.md';

/**
 * The rows, in the order a person looks for them. `count` names what a folder
 * holds (`.md` plans, facts, earlier conversations, backups) when that is the
 * question; `null` where a number would say nothing.
 */
export function fileRows(workspace, { fs = nodeFs } = {}) {
  const sessions = paths.sessionsDirLocal(workspace);
  const spec = [
    ['Task list', paths.artifactPath(workspace, 'task.md'), 'file'],
    ['Plans', paths.planArchiveDir(workspace), 'dir', (f) => f.endsWith('.md'), 'plan'],
    ['Memory', paths.memoryDir(workspace), 'dir', (f) => f.endsWith('.md') && !f.startsWith('.'), 'fact'],
    ['Conversation', paths.localSessionPath(workspace), 'file'],
    ['Earlier conversations', path.join(sessions, 'sessions'), 'dir', (f) => f.endsWith('.jsonl'), 'conversation'],
    ['Logs', paths.logsDir(workspace), 'dir'],
    ['Backups for /undo', paths.backupsDir(workspace), 'dir', (f) => !f.startsWith('.'), 'file'],
    ['Second copy', paths.workspaceHomeDir(workspace), 'dir'],
    // At the shared root in a monorepo, which is where agent-readme.js writes it.
    ['About these folders', path.join(paths.sharedAgentDir(workspace), AGENT_README), 'file'],
  ];
  return spec.map(([label, target, kind, counts, noun]) => {
    const exists = existsAs(fs, target, kind);
    let count = null;
    if (exists && counts) {
      try {
        const n = fs.readdirSync(target).filter(counts).length;
        count = `${n} ${noun}${n === 1 ? '' : 's'}`;
      } catch { /* unreadable: say nothing rather than 0 */ }
    }
    return { label, path: target, kind, exists, count, shown: shownPath(workspace, target) };
  });
}

function existsAs(fs, target, kind) {
  try {
    const st = fs.statSync(target);
    return kind === 'dir' ? st.isDirectory() : st.isFile();
  } catch {
    return false;
  }
}

/** Relative to the workspace when inside it, `~/…` under home, else whole. */
export function shownPath(workspace, target, home = os.homedir()) {
  const rel = paths.displayPath(workspace, target);
  if (rel !== target) return rel;
  return home && (target === home || target.startsWith(home + path.sep)) ? `~${target.slice(home.length)}` : target;
}

/** The detail column: where it is, and what is there or that nothing is yet. */
export function rowDetail(row) {
  const tail = !row.exists ? 'not yet' : row.count;
  return tail ? `${row.shown} · ${tail}` : row.shown;
}

/** The link target. A missing file links to its nearest folder that exists, so a click still lands somewhere. */
export function rowLink(row, { fs = nodeFs } = {}) {
  return pathToFileURL(row.exists ? row.path : nearestExisting(fs, row.path)).href;
}

function nearestExisting(fs, target) {
  let at = path.dirname(target);
  while (at !== path.dirname(at)) {
    if (existsAs(fs, at, 'dir')) return at;
    at = path.dirname(at);
  }
  return at;
}

/**
 * How enter shows a row: the file selected in its folder, or the folder open.
 * Argv for `execFile`, never a shell string — these are paths with spaces.
 * A row that does not exist yet opens the nearest folder that does.
 */
export function revealCommand(row, { platform = process.platform, fs = nodeFs } = {}) {
  const target = row.exists ? row.path : nearestExisting(fs, row.path);
  const file = row.exists && row.kind === 'file';
  if (platform === 'darwin') return ['open', file ? ['-R', target] : [target]];
  if (platform === 'win32') return ['explorer', file ? [`/select,${target}`] : [target]];
  return ['xdg-open', [file ? path.dirname(target) : target]];
}

/** The status beside the title after enter: what was opened, said plainly when it was the folder above. */
export function revealedLine(row, { fs = nodeFs } = {}) {
  if (row.exists) return `shown: ${row.label.toLowerCase()}`;
  const at = nearestExisting(fs, row.path);
  return `no ${row.label.toLowerCase()} yet · opened ${path.basename(at)}/`;
}

/** What the desktop calls its file browser, for the one line enter leaves. */
export const fileBrowserName = (platform = process.platform) =>
  platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'Explorer' : 'the file manager';
