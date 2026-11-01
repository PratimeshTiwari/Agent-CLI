/**
 * The one-line rows around a turn: compaction, disconnected, task progress, parse errors,
 * the context meter, mode glyphs, elapsed time and the end-of-turn line, plus the command list.
 *
 * Split out of `format.js` (v8.4) along the groups it already had.
 */

import { commandRows } from '../menus/help.js';

/**
 * The command list, grouped, for `/help` and for "no such command".
 *
 * **One renderer because there were two lists.** `/help` built its own and the
 * unknown-command path built another, three characters different in the
 * padding. That is the shape of the drift this list has already suffered:
 * CLAUDE.md records a hand-kept copy advertising `/init-skills` and
 * `/paste-image` after both were gone. Generating from `SLASH_COMMANDS` fixed
 * the *data* drifting; two renderers left the *presentation* free to.
 *
 * Unknown groups are printed under a trailing heading rather than dropped. A
 * command added with a `group` nobody put in `COMMAND_GROUPS` would otherwise
 * work perfectly and be invisible on the one screen that exists to list it —
 * failing silently, in the direction that is hardest to notice.
 *
 * @param {Array<{name: string, desc: string, group?: string}>} commands
 * @param {Array<[string, string]>} groups - `[key, heading]`, in print order
 * @returns {string}
 */
export function renderCommandList(commands, groups) {
  const width = Math.max(...commands.map((c) => c.name.length));
  // Grouped by `commandRows`, the same function `/help`'s Commands tab draws
  // from, so the two cannot disagree about which command is where.
  const sections = [];
  for (const row of commandRows(commands, groups)) {
    if (row.kind === 'heading') sections.push([row.text, []]);
    else sections.at(-1)[1].push(row);
  }

  const out = [];
  for (const [heading, list] of sections) {
    // A blank row between sections, not above the first: the caller has
    // already printed a heading above this.
    if (out.length) out.push('');
    /*
     * Bold at column 0, rows indented four.
     *
     * Both halves are what markdown does rather than what looks tidy in the
     * source. A heading's own leading spaces are insignificant and get
     * stripped, so indenting it achieves nothing — which is also why the flat
     * list this replaces was written with two spaces and drew at column 0.
     * Four spaces *are* preserved, so they are what actually nests the
     * commands under their heading.
     */
    out.push(`**${heading}**`);
    for (const c of list) out.push(`    /${c.name.padEnd(width)}   ${c.desc}`);
  }
  return out.join('\n');
}

/**
 * The transcript's one row for a compaction, Claude Code style.
 *
 * It used to be a paragraph from the assistant (`🗜 Context compacted — ✓
 * Compacted 14 turns, summarised by this chat; continuing in a fresh chat,
 * with the full history still searchable.`), drawn as a reply with a `●` — so
 * a notice read as an answer. The summary is behind ctrl+e, which already
 * means "show me the detail of every step".
 */
export function compactionRow(turns, verbose = false) {
  const n = Number.isFinite(turns) && turns > 0 ? ` · ${turns} turn${turns === 1 ? '' : 's'} summarised` : '';
  return `✻ Conversation compacted${n}${verbose ? '' : ' · ctrl+e for the summary'}`;
}

/** The port the extension dials; it has no setting for another (extension/src/background/policy.js). */
export const EXTENSION_PORT = 7777;

/**
 * The "extension not connected" row, naming the fix that applies.
 *
 * It said "Open a Gemini tab in Chrome" whatever the cause, and two of the
 * three causes are not that: an agent started with `--port` can never be
 * reached, because the extension only dials 7777; and one that was connected
 * and dropped needs Chrome back, not a first-time setup. Each fits 72
 * columns: the row truncates from the right, where the fix is.
 */
export function disconnectedHint({ port = EXTENSION_PORT, everConnected = false } = {}) {
  if (port !== EXTENSION_PORT) {
    return `! Extension dials ${EXTENSION_PORT}, this agent is on ${port} — restart without --port`;
  }
  if (everConnected) {
    return '! Extension disconnected — bring Chrome back; it reconnects by itself';
  }
  return '! Extension not connected — open gemini.google.com in Chrome';
}

/**
 * `{done, total}` for a task.md checklist, or null when it has none. Counted
 * from the file, which is the only copy either the user or the model sees.
 */
export function taskProgress(text) {
  if (!text) return null;
  const items = String(text).match(/^\s*[-*]\s*\[[ xX]\]/gm) || [];
  if (items.length === 0) return null;
  return { done: items.filter((l) => /\[[xX]\]/.test(l)).length, total: items.length };
}

/**
 * The row for a reply whose tool call could not be parsed. It was the broken
 * JSON drawn as prose, then `ERROR PARSING TOOL CALLS: …` as a paragraph —
 * ten rows saying "the model will try again".
 */
export function parseErrorRow(attempt, maxAttempts, verbose = false) {
  const n = Number.isFinite(attempt) && Number.isFinite(maxAttempts) ? ` (${attempt}/${maxAttempts})` : '';
  return `✗ Could not read its tool call — asked it to resend${n}${verbose ? '' : ' · ctrl+e for details'}`;
}

/**
 * A five-cell meter for the status bar: `▰▰▱▱▱`. Rounded to the nearest cell,
 * with any context at all showing one, so "almost empty" is not drawn as empty.
 */
export function contextMeter(pct, cells = 5) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const on = p === 0 ? 0 : Math.max(1, Math.round((p / 100) * cells));
  return '▰'.repeat(on) + '▱'.repeat(cells - on);
}

/**
 * The mode's glyph on the status line, Claude Code's: `⏸` plan, `⏵⏵` auto,
 * `⏹` strict. The words beside it are `frontend/screen/status-bar.js`'s (v6.13; `on` went,
 * since the mode's presence already says it).
 *
 * v5.20 dropped the glyphs — `⏸` drew as a thick `▮▮` in the owner's font and
 * was reported as looking bad. They came back by choice on 2026-10-25 (Look A
 * with M2, `.agent/artifacts/plans/2026-10-25-startup-look.md`), risk known.
 * If they are rejected again, the plan's M3 set (`‖`, `⏵⏵`, `■`) has no emoji
 * forms; change `MODE_GLYPHS` only.
 */
export const MODE_GLYPHS = { plan: '⏸', auto: '⏵⏵', strict: '⏹' };

/** `4s`, `1m 05s` — a running command's age, on its row. */
export function elapsedLabel(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * The end-of-turn line, Claude Code's shape: `✻ Worked for 3.5s · 2 rounds ·
 * done 1:06 AM` (v5.31; §6 of the 2026-10-26 action-rows plan). The mark and
 * the clock are what say, at a glance, that the turn is over and when.
 * `seconds` is a number or null (a turn never stamped has no duration).
 */
export function turnDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return null;
  const s = Number(seconds);
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s - m * 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** `1:06 AM` or `13:06`, by the system locale. Null when there is no time to show. */
export function doneAt(ms, locale = undefined) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

export function turnEndLine({ seconds, breakdown = '', endedAt = null, locale } = {}) {
  const took = turnDuration(seconds);
  const at = doneAt(endedAt, locale);
  return ['✻ ' + (took ? `Worked for ${took}` : 'Worked'), breakdown, at && `done ${at}`]
    .filter(Boolean).join(' · ');
}
