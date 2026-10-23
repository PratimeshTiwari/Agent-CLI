/**
 * The three approval modes (v5.11), and what each one lets through.
 *
 * Asked for: "writing/editing .md files should not ask for edit permission —
 * give 3 modes: auto, plan mode, strict plan mode (where .md edit/creation
 * also require permission)". Building a document section by section in plan
 * mode stopped for approval on every section.
 *
 *  - `auto`   — safe edits apply on their own, risky ones ask (unchanged).
 *  - `plan`   — every edit and command asks, except Markdown inside the repo.
 *  - `strict` — every edit and command asks. This is what `plan` was.
 *
 * Both plan-like modes still exempt the agent's own `.agent/artifacts/`.
 */
import path from 'path';

export const MODES = ['plan', 'auto', 'strict'];

/** Tab's order. */
export function nextMode(mode) {
  const i = MODES.indexOf(mode);
  return MODES[(i === -1 ? 0 : i + 1) % MODES.length];
}

/** Every write asks (apart from the exemptions) — `plan` and `strict`. */
export const asksForEdits = (mode) => mode === 'plan' || mode === 'strict';

/**
 * Files that say what a person wants an agent to do. Plan mode must not
 * rewrite them unasked: CLAUDE.md records the last time a blanket `.md`
 * exemption let the agent silently edit AGENT.md — the one file this project
 * promises "can always be trusted to say what the human wrote".
 */
export const INSTRUCTION_FILES = new Set(['agent.md', 'claude.md', 'gemini.md']);

const MARKDOWN = new Set(['.md', '.markdown', '.mdx']);

/**
 * A Markdown file inside the workspace that is not an instruction file — the
 * one thing `plan` writes without asking.
 *
 * Decided by *location* as well as extension, because the old exemption was
 * `path.endsWith('.md')` and these tools take absolute paths: `../x.md`,
 * `/etc/motd.md` and `.agent/../../x.md` are one string test and three files
 * outside the repo. Unresolvable means "ask".
 */
export function isProjectMarkdown(workspace, candidate) {
  if (typeof candidate !== 'string' || !candidate || !workspace) return false;
  try {
    const abs = path.isAbsolute(candidate) ? candidate : path.resolve(workspace, candidate);
    const rel = path.relative(workspace, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
    if (rel.split(path.sep).includes('.git')) return false;
    if (!MARKDOWN.has(path.extname(abs).toLowerCase())) return false;
    return !INSTRUCTION_FILES.has(path.basename(abs).toLowerCase());
  } catch {
    return false;
  }
}

/** One line for the status row and the settings page. */
export function describeMode(mode) {
  if (mode === 'auto') return 'auto — safe edits apply on their own';
  if (mode === 'strict') return 'strict — every edit needs approval';
  return 'plan — edits need approval, Markdown in the repo does not';
}
