/**
 * `/help`, as a menu with three tabs — General · Commands · Keys.
 *
 * It used to be one markdown block of ~50 rows put into the transcript: a
 * "Most used" line, eleven keys, every command with its description and a
 * footer, all of it left in the scrollback on every `/help`. Owner, 2026-10-26:
 * "revamp the /help part, it looks cluttered", and a tabbed menu like Claude
 * Code's, with nothing left behind when it closes.
 *
 * Everything here is a pure function of the tab, the cursor and the room, so
 * the rows drawn are the rows charged: each line is cut to `width` here rather
 * than left for Ink to wrap, because a row that wraps is two rows nobody paid
 * for (`CLAUDE.md`, the live frame rule).
 */
import { SLASH_COMMANDS, COMMAND_GROUPS } from './constants.js';

export const HELP_TABS = [
  ['general', 'General'],
  ['commands', 'Commands'],
  ['keys', 'Keys'],
];

/*
 * Every chord in `HOTKEYS` that still does something has a row here;
 * `help.test.js` derives the key names from the bytes and fails on one that
 * is missing, so a binding added later cannot be invisible on the one page
 * that lists them.
 */
export const KEY_ROWS = [
  ['/', 'commands, filtered as you type'],
  ['?', 'on an empty prompt, the keys at a glance'],
  ['↑ ↓', 'move a line, or recall an earlier prompt'],
  ['shift+tab', 'plan → auto → strict'],
  ['esc', 'stop the run, or close a menu'],
  ['ctrl+e', 'expand or collapse every step'],
  ['ctrl+o', 'show or hide the task list'],
  ['ctrl+b', 'bring the Gemini tab to the front'],
  ['ctrl+v', 'attach an image from the clipboard as [Image #n]'],
  ['backspace', 'on an [Image #n] tag, takes the image off'],
  ['ctrl+u', 'clear the input'],
  ['ctrl+w', 'delete the last word'],
  ['shift+enter', 'newline, without sending'],
  ['ctrl+n', 'newline in any terminal (ctrl+j too)'],
  ['ctrl+x ctrl+s', 'steer the last queued message into the running turn'],
  ['ctrl+c ×2', 'quit — prints how to resume'],
];

const GENERAL = [
  'Agent CLI drives Gemini in your own Chrome tab. It reads, searches, edits and runs commands '
    + 'in this workspace, and asks first whenever the mode says to.',
  '',
  ['Modes', 'plan · auto · strict — shift+tab cycles'],
  ['Effort', 'low · medium · high — /effort'],
  ['Images', 'ctrl+v puts [Image #1] where you are typing'],
  ['While it works', 'type to queue; ctrl+x ctrl+s steers instead'],
  ['Settings', '/settings shows everything that is set'],
  '',
  '/help <command> for one command in full',
];

const cut = (s, width) => (s.length > width ? `${s.slice(0, Math.max(0, width - 1))}…` : s);

/** Words onto lines of at most `width`. */
function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out.length ? out.map((l) => cut(l, width)) : [''];
}

/** The Commands tab's rows, in group order, with each command's index. */
export function commandRows(commands = SLASH_COMMANDS, groups = COMMAND_GROUPS) {
  const known = new Set(groups.map(([key]) => key));
  const rows = [];
  for (const [key, heading] of [...groups, ['', 'Other']]) {
    const list = commands.filter((c) => (key ? c.group === key : !known.has(c.group)));
    if (!list.length) continue;
    rows.push({ kind: 'heading', text: heading });
    for (const c of list) rows.push({ kind: 'command', name: c.name, desc: c.desc });
  }
  return rows;
}

/**
 * The page for one tab, fitted to the room.
 *
 * `cursor` is the selected command on the Commands tab, and the scroll
 * position on the other two — ↑/↓ move it on every tab, so a short terminal
 * scrolls rather than being told to grow.
 *
 * @param {{tab?: string, cursor?: number, width?: number, rows?: number}} view
 * @returns {{lines: Array<{kind: string, text: string, name?: string, selected?: boolean}>, cursor: number, count: number}}
 *          `count` is how many positions the cursor has on this tab
 */
export function helpPage({ tab = 'general', cursor = 0, width = 80, rows = 20 } = {}) {
  const w = Math.max(20, width - 2);
  const room = Math.max(1, rows);

  if (tab === 'commands') {
    const all = commandRows();
    const count = all.filter((r) => r.kind === 'command').length;
    const at = Math.max(0, Math.min(cursor, count - 1));
    const nameWidth = Math.max(...all.filter((r) => r.name).map((r) => r.name.length)) + 4;
    const lines = [];
    let n = -1;
    for (const r of all) {
      if (r.kind === 'heading') {
        // A blank row between groups: the groups are the structure, and
        // without the gap a heading reads as one more command.
        if (lines.length) lines.push({ kind: 'blank', text: '' });
        lines.push({ kind: 'heading', text: cut(r.text, w) });
        continue;
      }
      n += 1;
      const name = `/${r.name}`.padEnd(nameWidth);
      lines.push({ kind: 'command', name, selected: n === at, text: cut(name + r.desc.replace(/`/g, ''), w - 4) });
    }
    const sel = lines.findIndex((l) => l.selected);
    // The selected command's heading comes into view with it where it can.
    const focus = lines[sel - 1]?.kind === 'heading' ? sel - 1 : sel;
    return { lines: windowed(lines, room, { focus, keep: sel }), cursor: at, count };
  }

  const lines = tab === 'keys' ? keyLines(w) : generalLines(w);
  const count = lines.length <= room ? 1 : lines.length - room + 2;
  const top = Math.max(0, Math.min(cursor, count - 1));
  return { lines: windowed(lines, room, { top }), cursor: top, count };
}

function keyLines(w) {
  const keyWidth = Math.max(...KEY_ROWS.map(([k]) => k.length)) + 4;
  return KEY_ROWS.map(([k, what]) => ({ kind: 'key', name: k.padEnd(keyWidth), text: cut(k.padEnd(keyWidth) + what, w - 2) }));
}

function generalLines(w) {
  const lines = [];
  const labelWidth = Math.max(...GENERAL.filter(Array.isArray).map(([k]) => k.length)) + 4;
  for (const item of GENERAL) {
    if (Array.isArray(item)) lines.push({ kind: 'pair', name: item[0].padEnd(labelWidth), text: cut(item[0].padEnd(labelWidth) + item[1], w - 2) });
    else if (!item) lines.push({ kind: 'blank', text: '' });
    else for (const l of wrap(item, w - 2)) lines.push({ kind: 'text', text: l });
  }
  return lines;
}

/**
 * `room` rows of `lines`, with an `↑ N more` / `↓ N more` row wherever some are
 * cut off. Those rows come out of the room, so the page is never taller than
 * it was given. Either `top` (scrolling: the first line shown) or `focus` (the
 * line to centre on) with `keep` (a line that must stay visible).
 */
function windowed(lines, room, { top = null, focus = 0, keep = null } = {}) {
  if (lines.length <= room) return lines;
  if (room < 3) {
    const s = Math.max(0, Math.min(top ?? keep ?? 0, lines.length - room));
    return lines.slice(s, s + room);
  }
  const maxStart = lines.length - (room - 1);       // the last line shown, a marker above it
  const shown = (st) => {
    const above = st > 0 ? 1 : 0;
    return room - above - (st + room - above < lines.length ? 1 : 0);
  };
  let start = top ?? (focus - Math.floor((room - 2) / 2));
  start = Math.max(0, Math.min(start, maxStart));
  if (keep !== null) {
    if (keep < start) start = keep;
    if (keep >= start + shown(start)) start = Math.min(maxStart, keep - (room - 2) + 1);
  }
  let n = shown(start);
  // A heading (or the gap above it) never ends the page with its commands
  // below the fold — it goes under the marker with them.
  while (n > 1 && start + n < lines.length && ['heading', 'blank'].includes(lines[start + n - 1].kind)
    && start + n - 1 !== keep) n -= 1;
  const out = [];
  if (start > 0) out.push({ kind: 'more', text: `↑ ${start} more` });
  out.push(...lines.slice(start, start + n));
  if (start + n < lines.length) out.push({ kind: 'more', text: `↓ ${lines.length - start - n} more` });
  return out;
}

/** The tab after (or before) this one, wrapping round. */
export function nextTab(tab, step = 1) {
  const at = Math.max(0, HELP_TABS.findIndex(([id]) => id === tab));
  return HELP_TABS[(at + step + HELP_TABS.length) % HELP_TABS.length][0];
}

/** Rows the menu draws around its page: rule, tabs, blank, blank, footer. */
export const HELP_CHROME_ROWS = 5;

/**
 * `/help <command>`: one command in full, for the transcript.
 *
 * @returns {string|null} null when there is no such command
 */
export function commandHelp(name, commands = SLASH_COMMANDS) {
  const word = String(name ?? '').replace(/^\//, '').toLowerCase();
  const c = commands.find((x) => x.name === word);
  if (!c) return null;
  const group = COMMAND_GROUPS.find(([key]) => key === c.group)?.[1];
  return `**/${c.name}** — ${c.desc}${group ? `\n\n_${group}_` : ''}`;
}
