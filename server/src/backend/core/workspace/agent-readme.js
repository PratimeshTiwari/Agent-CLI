/**
 * A `README.md` inside `.agent/` (v9.9.1, step B of the `.agent` plan in the
 * 2026-11-08 handoff): what each folder is and what is safe to delete, in the
 * folder itself, where a person looking at it already is.
 *
 * Written at startup into the state root the walk resolved (`sharedAgentDir`),
 * and only if that folder exists: it must never be what creates a `.agent`,
 * or a stray (`isStrayAgentDir`) gains a file that makes it look deliberate.
 * Rewritten while its first line is the marker, so it follows the layout; a
 * person who deletes that line owns the file and it is left alone.
 *
 * The long form is `docs/agent-folder.md`; `agent-readme.test.js` holds the
 * two to the same folders.
 */
import fs from 'fs';
import path from 'path';
import { sharedAgentDir } from './paths.js';

export const README_MARKER = '<!-- Written by Agent CLI and kept current. Delete this line to keep your own edits. -->';

export const README_TEXT = `${README_MARKER}
# What is in this folder

Agent CLI keeps this project's state here. It is git-ignored and never sent
anywhere. In the agent, \`/files\` lists these with links.

| Path | What it is | Safe to delete? |
| --- | --- | --- |
| \`artifacts/\` | the task list, plans and walkthroughs, written for you to read | \`plans/\` yes; the rest while no task is running |
| \`memory/\` | what the agent learned here, one fact per file (\`/memory\`) | yes, if you mean it |
| \`config.json\` | this project's settings (\`/settings\`) | yes, if you mean it |
| \`conversations/\` | one folder per conversation (\`/history\`); \`index.jsonl\` lists them | a folder, only with its copy in \`~/.agent/workspaces/\` too |
| \`logs/\` | failures, timings, tool use, every shell command (\`/logs\`, \`/commands\`) | yes |
| \`backups/\` | a copy of each file before an edit (\`/undo\`) | yes, between sessions |
| \`state/\` | files the VS Code companion reads and writes | yes, while the agent is closed |
| \`tmp/\` | pasted images and over-long command output | yes |

To clear everything, use \`/reset\`: it moves this folder's contents to
\`~/.agent/trash/\` instead of deleting them.

In a monorepo, a folder here named after a repo (\`repo-1/\`) is that repo's own
copy of the rows above.

More: docs/agent-folder.md in the Agent CLI checkout.
`;

/**
 * Write or refresh the README. Returns what happened, for a test; never throws,
 * because nothing at startup may fail on a help file.
 */
export function writeAgentReadme(workspace, { text = README_TEXT } = {}) {
  try {
    const dir = sharedAgentDir(workspace);
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch { /* not made yet */ }
    if (!isDir) return 'no-folder';
    const file = path.join(dir, 'README.md');
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch { /* not there yet */ }
    if (current === text) return 'current';
    if (current !== null && !current.startsWith(README_MARKER)) return 'theirs';
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return current === null ? 'written' : 'refreshed';
  } catch {
    return 'failed';
  }
}
