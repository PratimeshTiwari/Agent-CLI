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

/**
 * Whether a plan written this turn should stop and ask (v6.7).
 *
 * Reported 2026-10-30 with a screenshot: "hi" in plan mode, on Flash-Lite,
 * wrote `task.md`, wrote a one-line `implementation_plan.md` ("Understand user
 * request and initialize tracking files."), ticked the task, answered "Hello!"
 * — and then the turn ended on **Plan ready for review**, with the editor
 * opened on the plan. Proceed sent "approve it, proceed with execution" and
 * spent another round on nothing.
 *
 * Two shapes are not plans waiting for a yes:
 * - **already carried out**: `task.md` was written after the plan and nothing
 *   in it is left unticked. A real plan in plan mode stops *before* the work.
 * - **too small to be one**: fewer than two steps and under 200 characters of
 *   body. Prose plans with no list are kept by the length test.
 *
 * Either way the write is still drawn (`● Wrote plan ⎿ /plan show to preview`);
 * only the menu and the editor stay shut.
 */
export function planWorthReviewing(workspace) {
  const at = findPlanFile(workspace);
  if (!at) return false;
  let text;
  let planMtime;
  try {
    text = fs.readFileSync(at, 'utf8');
    planMtime = fs.statSync(at).mtimeMs;
  } catch {
    return false;
  }
  try {
    const taskPath = paths.artifactPath(workspace, 'task.md');
    const list = fs.readFileSync(taskPath, 'utf8');
    const done = /^\s*[-*] \[[xX]\]/m.test(list) && !/^\s*[-*] \[ \]/m.test(list);
    if (done && fs.statSync(taskPath).mtimeMs >= planMtime) return false;
  } catch { /* no task.md: decided by the plan alone */ }
  const body = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').trim();
  const steps = body.split('\n').filter((l) => /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(l)).length;
  return steps >= 2 || body.length >= 200;
}
