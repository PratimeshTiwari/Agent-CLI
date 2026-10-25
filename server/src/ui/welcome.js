/**
 * First-start setup: the pure half. The screens are `components/Onboarding.jsx`.
 *
 * Asked for on 2026-10-25: *"on first startup only, give instructions on theme
 * selection, set agent name and instructions on adding chrome extension"* — and
 * then, on seeing a static card, *"more interactive like claude code, step 1,
 * step 2, step 3 with more interactive screens and animations"*. So it is
 * Claude Code's shape: full screens before the app, one decision each, the
 * theme previewed live as you move, Enter to go on and esc to skip.
 *
 * The three steps have one thing in common — each is a choice or an action in
 * another program, so none of them can happen by default, and a new user had no
 * way to learn any of them exists: `/theme` and `/name` are two of ~50
 * commands, and the extension's steps were only in the README.
 *
 * `.js` rather than `.jsx` so the repo's plain `node --test` can import it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STEPS = ['theme', 'name', 'chrome'];

/**
 * Whether to run setup.
 *
 * `welcomed` in `~/.agent/settings.json` — per person, not per repo, because
 * the steps are about the person's terminal and browser:
 *
 * - `true` — done, or skipped. Never again.
 * - `'pending'` — setup was started and not finished (ctrl+c halfway). Shown
 *   again: by then the loop has created `workspaces/<slug>`, so the folder
 *   test below would wrongly call this person an old user.
 * - absent — new if `~/.agent/workspaces/` holds no history. An install from
 *   before setup existed has history and is marked done without being shown
 *   anything, so a later `/reset` that empties the folder does not greet a
 *   long-time user as a stranger.
 *
 * @returns {{show: boolean, write: (true|'pending'|null)}} what to store now
 */
export function firstRunState({ settings = {}, workspacesDir, readdir = fs.readdirSync } = {}) {
  if (settings.welcomed === true) return { show: false, write: null };
  if (settings.welcomed === 'pending') return { show: true, write: null };
  let existing = 0;
  try {
    existing = readdir(workspacesDir).filter((n) => !n.startsWith('.')).length;
  } catch {
    existing = 0;
  }
  return existing === 0 ? { show: true, write: 'pending' } : { show: false, write: true };
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** This checkout's `extension/` folder — what "Load unpacked" wants picked. */
export function extensionDir() {
  return path.resolve(here, '../../../extension');
}

/** `~/…` for a path under home: it is read, and the prefix carries nothing. */
export function tildify(p, home = os.homedir()) {
  return p && home && (p === home || p.startsWith(`${home}${path.sep}`)) ? `~${p.slice(home.length)}` : p;
}

/** Whether an extension (not the editor panel) is connected, and which version. */
export function extensionStatus(wsServer) {
  const ext = [...(wsServer?.clients?.values?.() || [])].find((c) => c.type === 'extension');
  return { connected: Boolean(ext), version: ext?.extensionVersion || null };
}

/**
 * `Step 2 of 3  ▰▰▰▰▰▰▰▰▱▱▱▱`, filling towards the step it is on.
 *
 * Animated: `since` is ticks since the step began, and the bar grows from the
 * previous step's fill one cell per tick, so arriving at a step is a motion
 * rather than a jump. The width never changes while it animates — a row that
 * grows and shrinks is how a live frame ends up a row taller than the screen.
 */
export function progressBar(stepIndex, since = Infinity, cells = 12) {
  const per = cells / STEPS.length;
  const from = Math.round(stepIndex * per);
  const to = Math.round((stepIndex + 1) * per);
  const fill = Math.min(to, from + Math.max(0, since));
  return `${'▰'.repeat(fill)}${'▱'.repeat(cells - fill)}`;
}

/** How many columns of the wordmark the splash has revealed after `tick` ticks. */
export function revealColumns(tick, width, perTick = 4) {
  return Math.min(width, Math.max(0, tick) * perTick);
}

/**
 * What each screen can afford to draw at this height.
 *
 * The setup screens are a live frame like any other, and a frame as tall as
 * the terminal makes Ink clear and repaint on every render (CLAUDE.md, "The
 * live frame must never outgrow the viewport") — here, with a spinner ticking,
 * that is twelve full clears a second. So the decorative blocks go first: the
 * big lettering, then the theme preview, then the blank rows between blocks.
 * The numbers are the rows each screen measures to under the pty; the frame
 * must stay at least one row short of the terminal.
 */
export function onboardingLayout(rows = 24) {
  const room = rows - 1;
  const compact = room < 16;
  // Fixed rows per screen, with and without the blank spacers.
  const fixed = compact
    ? { welcome: 4, theme: 10, name: 5, chrome: 7 }
    : { welcome: 7, theme: 14, name: 9, chrome: 12 };
  return {
    compact,
    welcomeWordmark: room >= fixed.welcome + 7,
    themePreview: room >= fixed.theme + (compact ? 6 : 7),
    nameWordmark: room >= fixed.name + (compact ? 6 : 7),
  };
}
