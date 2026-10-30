/**
 * `/settings` as a list of switches (v5.27, Option C′). The rules are pure, in
 * `ui/settings-view.js`; the page's wiring is pinned by source assertions,
 * because driving it needs the pty harness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  stepValue, controlParts, controlWidth, rowHint, filterUnderline, settingsKeys, isFilterText,
  HINT_MIN_COLS, UNDERLINE_MIN,
} from '../../src/ui/settings-view.js';
import { describeSettings } from '../../src/core/settings.js';

const sw = (value) => ({ label: 'Subagents', value, control: { kind: 'switch', options: ['on', 'off'] } });
const ladder = (value) => ({ label: 'Effort', value, control: { kind: 'ladder', options: ['low', 'medium', 'high', 'max'] } });
const text = (parts) => parts.map((p) => p.text).join('');

test('←/→ are spatial and stop at the ends: ← is on, → is off', () => {
  assert.equal(stepValue(sw('on'), 1), 'off');
  assert.equal(stepValue(sw('off'), -1), 'on');
  assert.equal(stepValue(sw('on'), -1), null, 'no wrapping round to off');
  assert.equal(stepValue(ladder('medium'), 1), 'high');
  assert.equal(stepValue(ladder('low'), -1), null);
});

test('a ladder passes over what this account cannot choose', () => {
  assert.equal(stepValue(ladder('high'), 1, { skip: ['max'] }), null, 'no Argon: High is the top');
  assert.equal(stepValue(ladder('high'), 1), 'max', 'control: with Argon it is not');
  assert.equal(stepValue(ladder('max'), -1, { skip: ['max'] }), 'high', 'already on Max still steps down');
});

test('a switch shows both states, the current one in the accent', () => {
  const parts = controlParts(sw('on'));
  assert.equal(text(parts), '● on  ○ off');
  assert.deepEqual(parts.filter((p) => p.role === 'accent').map((p) => p.text), ['● on']);
  assert.deepEqual(parts.filter((p) => p.role === 'dim').map((p) => p.text), ['○ off']);
  assert.equal(text(controlParts(sw('off'))), '○ on  ● off');
});

test('a ladder dims the arrow at an end', () => {
  const low = controlParts(ladder('low'));
  assert.equal(text(low), '◂ low ▸');
  assert.equal(low[0].role, 'dim');
  assert.equal(low[2].role, 'plain');
  const mid = controlParts(ladder('medium'));
  assert.equal(mid[0].role, 'plain', 'control: in the middle neither is dim');
  assert.equal(controlParts(ladder('high'), { skip: ['max'] })[2].role, 'dim');
});

test('free text is one line, clamped, and measured as drawn', () => {
  const row = { label: 'Agent name', value: 'a  b\nc' };
  assert.equal(text(controlParts(row)), 'a b c');
  assert.equal(controlWidth(row), 5);
  assert.equal(text(controlParts({ label: 'Workspace', value: 'x'.repeat(50) })).length, 30);
});

test('the hint sits on the row, truncated, and drops on a narrow terminal', () => {
  const row = { hint: 'extra tabs can research or review in parallel' };
  assert.equal(rowHint(row, { width: 100, used: 30 }), row.hint);
  assert.match(rowHint(row, { width: 72, used: 40 }), /…$/);
  assert.ok(rowHint(row, { width: 72, used: 40 }).length <= 72 - 40 - 3);
  assert.equal(rowHint(row, { width: HINT_MIN_COLS - 1, used: 10 }), '');
  assert.equal(rowHint(row, { width: 100, used: 30, note: 'stays high' }), 'stays high', 'a refusal replaces it');
});

test('the filter: underlined, accent once typing; keys say what applies', () => {
  assert.deepEqual(filterUnderline(''), { text: '─'.repeat(UNDERLINE_MIN), role: 'dim' });
  assert.equal(filterUnderline('sub').role, 'accent');
  assert.equal(filterUnderline('x'.repeat(40)).text.length, 44);
  assert.match(settingsKeys(), /type to filter.*←\/→ change.*tab tabs.*esc close/);
  assert.doesNotMatch(settingsKeys({ query: 's' }), /tab tabs/, 'a filter searches every tab');
  assert.match(settingsKeys({ query: 's' }), /esc clear/);
  // v6.1: with changes waiting, esc is where Apply is.
  assert.match(settingsKeys({ staged: 2 }), /2 pending · esc apply or revert/);
  assert.doesNotMatch(settingsKeys({ staged: 2 }), /esc close/);
});

test('printable keys filter; control bytes and the page keys do not', () => {
  assert.equal(isFilterText('s', {}), true);
  assert.equal(isFilterText('ab', {}), true, 'a paste of a word');
  assert.equal(isFilterText('\t', { tab: true }), false);
  assert.equal(isFilterText('\r', { return: true }), false);
  assert.equal(isFilterText('e', { ctrl: true }), false);
  assert.equal(isFilterText('\x1b', { escape: true }), false);
  assert.equal(isFilterText('', {}), false);
});

test('every switch and ladder row can set each of its options by its own command', () => {
  const rows = describeSettings(null).filter((r) => r.control);
  assert.deepEqual(rows.map((r) => r.label).sort(),
    ['Browser differs', 'Command rules', 'Edit approval', 'Effort', 'Memory', 'Prompt', 'Startup', 'Subagents']);
  for (const row of rows) {
    assert.ok(row.control.options.includes(row.value), `${row.label}: ${row.value} is one of its options`);
    for (const option of row.control.options) assert.match(row.restore(option), /^\/\w/);
  }
  assert.ok(describeSettings(null).some((r) => r.label === 'Theme' && r.run === '/theme'), 'Theme is a row');
});

test('the page: tabs on tab only, no detached hint, changes through the owning command', () => {
  const menus = readFileSync(new URL('../../src/ui/components/Menus.jsx', import.meta.url), 'utf8');
  const page = menus.slice(menus.indexOf("activeMenu?.type === 'settings' && (() =>"), menus.indexOf("activeMenu?.type === 'commands' && (() =>"));
  assert.doesNotMatch(page, /↳/, 'the hint under the list is gone');
  assert.doesNotMatch(page, /<TextInput/, 'the filter does not hold the caret');
  assert.doesNotMatch(page, /settingTone/, 'no per-value colours');
  // v6.1: a key on the page only stages; Apply runs each change through the
  // command that owns it.
  const step = page.slice(page.indexOf('const step = (row, value) =>'), page.indexOf('const staged = stagedChanges('));
  assert.ok(step.length > 0, 'step() found');
  assert.doesNotMatch(step, /handleSlashCommand/, 'a key on the page runs nothing');
  assert.match(page, /change\.restore\.slice\(1\)/);
  assert.match(page, /label: 'Apply'.*label: 'Revert'/);
  assert.match(menus, /if \(key\.tab && activeMenu\?\.type === 'settings'/);
  // The selected row's detail is no longer recoloured in every menu.
  const panel = readFileSync(new URL('../../src/ui/components/Panel.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /color=\{sel \? T\.accent : item\.tone/);
});
