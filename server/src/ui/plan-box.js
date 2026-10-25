/**
 * The plan, shown in the terminal the way Claude Code shows one.
 *
 * Plan review used to open a menu reading "The agent has created an
 * implementation_plan.md artifact" and launch the editor — the plan itself was
 * never on screen, nor where it was. Asked for on 2026-10-26 with a screenshot
 * of Claude Code's approved-plan box: `Plan file: <path>`, then the plan in a
 * box, and **nothing at all when there is no plan file**.
 *
 * The row is a local transcript row, committed to `<Static>`: a plan is tall,
 * and a tall row in the live frame is the overflow `CLAUDE.md` calls the most
 * important rule in `ui/`. Scrollback is where it costs nothing.
 */
import fs from 'fs';
import path from 'path';
import * as paths from '../core/paths.js';
import { PLAN_FILES } from './transcript.js';

/**
 * The plan file to show, or null when there is none.
 *
 * Not filtered by mtime, unlike the task panel: plan review is triggered by the
 * agent writing the file this turn, and `/plan show` is asked for by name.
 */
export function findPlanFile(workspace) {
  for (const name of PLAN_FILES) {
    const at = paths.artifactPath(workspace, name);
    try {
      if (fs.statSync(at).isFile()) return at;
    } catch { /* not there */ }
  }
  return null;
}

/**
 * The transcript row for the current plan, or null when there is no plan file,
 * it cannot be read, or it is empty — every one of which shows nothing.
 *
 * @returns {{role: 'assistant', isLocal: true, kind: 'plan_box', path: string,
 *   content: string, timestamp: number} | null}
 */
export function planBoxRow(workspace) {
  const at = findPlanFile(workspace);
  if (!at) return null;
  let content;
  try {
    content = fs.readFileSync(at, 'utf8').trim();
  } catch {
    return null;
  }
  if (!content) return null;
  return {
    role: 'assistant',
    isLocal: true,
    kind: 'plan_box',
    path: path.relative(workspace, at) || at,
    content,
    timestamp: Date.now(),
  };
}
