/**
 * `/help` is a three-tab menu built from the command and key tables.
 *
 * It was ~50 rows of markdown left in the scrollback on every `/help`
 * ("it looks cluttered"). Now a menu: General · Commands · Keys, fitted to the
 * rows it is given, nothing left behind when it closes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { helpPage, commandRows, nextTab, commandHelp, KEY_ROWS, HELP_TABS } from '../../../src/frontend/menus/help.js';
import { HOTKEYS } from '../../../src/frontend/input/hotkeys.js';
import { SLASH_COMMANDS } from '../../../src/frontend/constants.js';

// Retired chords are still taken (so no stray letter is typed) but do nothing.
const RETIRED = new Set(['terminal', 'copy-code']);

test('every live chord has a row on the Keys tab', () => {
  const text = KEY_ROWS.map(([k]) => k).join(' ');
  for (const [byte, name] of Object.entries(HOTKEYS)) {
    if (RETIRED.has(name)) continue;
    const key = `ctrl+${String.fromCharCode(byte.charCodeAt(0) + 96)}`;
    assert.ok(text.includes(key), `${key} (${name}) is not on the Keys tab`);
  }
});

test('every command is on the Commands tab exactly once', () => {
  const rows = commandRows().filter((r) => r.kind === 'command').map((r) => r.name);
  assert.equal(rows.length, SLASH_COMMANDS.length);
  assert.equal(new Set(rows).size, rows.length);
});

test('no page is taller than its room, or wider than the terminal', () => {
  for (const [tab] of HELP_TABS) {
    for (const width of [40, 60, 80, 120]) {
      for (const rows of [1, 4, 8, 20, 60]) {
        const page = helpPage({ tab, width, rows, cursor: 10 });
        assert.ok(page.lines.length <= rows, `${tab} ${width}x${rows}: ${page.lines.length} rows`);
        for (const l of page.lines) assert.ok(l.text.length <= width - 2, `${tab} ${width}: "${l.text}"`);
      }
    }
  }
});

test('the selected command stays on screen as the cursor moves', () => {
  const count = helpPage({ tab: 'commands' }).count;
  for (let cursor = 0; cursor < count; cursor++) {
    const page = helpPage({ tab: 'commands', cursor, rows: 6 });
    assert.equal(page.lines.filter((l) => l.selected).length, 1, `cursor ${cursor}`);
  }
});

test('a page cut short says so', () => {
  const page = helpPage({ tab: 'keys', rows: 4 });
  assert.equal(page.lines.at(-1).kind, 'more');
});

test('tabs wrap round both ways', () => {
  assert.equal(nextTab('general'), 'commands');
  assert.equal(nextTab('keys'), 'general');
  assert.equal(nextTab('general', -1), 'keys');
});

test('/help <command> answers for one command; an unknown one is null', () => {
  assert.match(commandHelp('effort'), /^\*\*\/effort\*\* — /);
  assert.match(commandHelp('/effort'), /\/effort/);
  assert.equal(commandHelp('nosuch'), null);
});

test('/help opens the menu and leaves nothing in the transcript', () => {
  const src = readFileSync(new URL('../../../src/frontend/hooks/use-slash-commands.js', import.meta.url), 'utf8');
  const arm = src.slice(src.indexOf("if (command === 'help' || command === 'shortcuts') {"), src.indexOf("if (command === 'exit') {"));
  assert.match(arm, /setActiveMenu\(\{ type: 'help', tab: command === 'shortcuts' \? 'keys' : 'general', cursor: 0 \}\)/);
  assert.doesNotMatch(arm, /Most used/);
});

test('a heading never ends a page with its commands below the fold', () => {
  for (let cursor = 0; cursor < 30; cursor++) {
    for (const rows of [5, 8, 13, 20]) {
      const { lines } = helpPage({ tab: 'commands', cursor, rows });
      const last = lines.at(-1).kind === 'more' ? lines.at(-2) : null;
      if (last) assert.ok(!['heading', 'blank'].includes(last.kind), `cursor ${cursor}, ${rows} rows`);
    }
  }
});
