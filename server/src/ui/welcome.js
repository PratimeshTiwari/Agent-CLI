/**
 * The first-start card: three things nobody can set up for you.
 *
 * Asked for on 2026-10-25: *"on first startup only, give instructions on theme
 * selection, set agent name and instructions on adding chrome extension"*. The
 * three have one thing in common — each is a choice or an action in another
 * program, so none of them can happen by default, and a new user had no way to
 * learn any of them exists: `/theme` and `/name` are two of ~50 commands, and
 * the extension's steps were only in the README.
 *
 * Drawn under the banner, inside the same `<Static>` row, so it costs
 * scrollback rather than the live frame and is reprinted with the banner if
 * the transcript is (ctrl+e, a theme change) — which is right, because a
 * reprint after `/theme` should still show the card that suggested it.
 *
 * Pure parts here, `.js` rather than `.jsx`, so the repo's plain `node --test`
 * can import them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Whether this is the person's first start.
 *
 * `welcomed` in `~/.agent/settings.json` — per person, not per repo, because
 * the three steps are about the person's terminal and browser. An install from
 * before the card existed has durable history under `~/.agent/workspaces/`
 * and is not new; it is marked welcomed without being shown anything, so a
 * later `/reset` of its only repo (which empties that folder) does not
 * suddenly greet a long-time user as a stranger.
 *
 * @returns {{show: boolean, mark: boolean}} `mark` — write `welcomed: true`
 */
export function firstRunState({ settings = {}, workspacesDir, readdir = fs.readdirSync } = {}) {
  if (settings.welcomed) return { show: false, mark: false };
  let existing = 0;
  try {
    existing = readdir(workspacesDir).filter((n) => !n.startsWith('.')).length;
  } catch {
    existing = 0;
  }
  return { show: existing === 0, mark: true };
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** This checkout's `extension/` folder — what "Load unpacked" wants picked. */
export function extensionDir() {
  return path.resolve(here, '../../../extension');
}

/** `~/…` for a path under home: the card is read, and the prefix carries nothing. */
export function tildify(p, home = os.homedir()) {
  return p && home && (p === home || p.startsWith(`${home}${path.sep}`)) ? `~${p.slice(home.length)}` : p;
}

/**
 * The card's rows, as data. Every step names the exact thing to type or
 * click — a step that says "configure Chrome" is a step nobody can follow.
 *
 * @param {object} opts
 * @param {string} opts.themeLabel - the palette in use now, so `/theme` reads as a change from something
 * @param {string} [opts.agentName] - the name already set, if any
 * @param {string} opts.extensionPath - where to point Load unpacked
 */
export function welcomeSteps({ themeLabel, agentName, extensionPath }) {
  return [
    {
      key: 'theme',
      title: 'Theme',
      command: '/theme',
      lines: [`colours that suit your terminal${themeLabel ? ` (now: ${themeLabel})` : ''}`],
    },
    {
      key: 'name',
      title: 'Name',
      command: '/name <text>',
      lines: [`what the banner calls your agent${agentName ? ` (now: ${agentName})` : ''}`],
    },
    {
      key: 'chrome',
      title: 'Chrome',
      command: 'chrome://extensions',
      lines: [
        'turn on Developer mode → Load unpacked →',
        extensionPath,
        'then open gemini.google.com, sign in, and leave the tab open',
      ],
    },
  ];
}
