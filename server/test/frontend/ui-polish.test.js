/**
 * The v5.12 UI changes: what each row says now, and that none of them can
 * wrap — in the live frame a row that wraps is charged as one and drawn as two.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workBreakdown } from '../../src/frontend/transcript/tool-rows.js';
import { shortenPath } from '../../src/frontend/text.js';
import { handleSlashCommand } from '../../src/backend/core/turn/slash-commands.js';
import { DiffEngine } from '../../src/backend/core/edits/diff-engine.js';

const act = (toolName) => ({ type: 'tool', toolName });
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');

test('the turn summary says what kind of work, not how many actions', () => {
  const actions = [act('read_file'), act('read_file'), act('grep_search'), act('edit_file'), act('run_command'), act('ask_subagent')];
  assert.equal(workBreakdown(actions), '3 reads · 1 edit · 1 command · 1 other');
  assert.equal(workBreakdown([{ type: 'fs_event', paths: ['a'] }]), '', 'a file the user changed is not work the agent did');
  assert.equal(workBreakdown([]), '');
});

test('the summary row truncates rather than wraps', () => {
  assert.match(src('frontend/components/TranscriptTurn.jsx'), /<Text color=\{T\.muted\} wrap="truncate">/);
});

test('a path keeps its project and its file name', () => {
  assert.equal(shortenPath('apps/billing/app/models/invoices/line_item.rb', 30), 'apps/…/invoices/line_item.rb');
  assert.equal(shortenPath('short/path.rb', 30), 'short/path.rb');
  assert.equal(shortenPath('/private/tmp/scratch/harness/uiws', 24), '/…/scratch/harness/uiws', 'not //…/');
  assert.ok(shortenPath('apps/billing/app/models/invoices/line_item.rb', 12).length <= 12);
});

test('the queued row says how to take a prompt back', () => {
  const bar = src('frontend/components/InputBar.jsx');
  assert.match(bar, /↑ to take back/);
  assert.match(bar, /more queued {2}· ↑ takes back the last/);
});

test('the mode is said in the status line, Claude Code style', async () => {
  const { statusBarLayout } = await import('../../src/frontend/screen/status-bar.js');
  const left = (mode) => statusBarLayout({ width: 80, mode }).left.map((x) => x.text).join('');
  assert.equal(left('auto'), '⏵⏵ auto mode');
  assert.equal(left('plan'), '⏸ plan mode');
  assert.equal(left('strict'), '⏹ strict plan mode');
  assert.match(src('frontend/App.jsx'), /statusBarLayout\(/);
  assert.match(src('frontend/App.jsx'), /hint: !chatStarted && !isProcessing/, 'the hint is taught at the start of a chat');
  assert.doesNotMatch(src('frontend/components/InputBar.jsx'), /borderTop=\{false\}/, 'the label on the border is gone');
});

test('/diff shows the last edit, and what happened to it', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'diffcmd-'));
  writeFileSync(join(ws, 'a.rb'), 'def a = 1\n');
  const diffEngine = new DiffEngine(ws);
  const loop = { diffEngine };
  assert.match((await handleSlashCommand(loop, 'diff', [])).message, /No edit yet/);

  const d = diffEngine.generateDiff('a.rb', [{ oldText: 'def a = 1', newText: 'def a = 2' }]);
  let r = await handleSlashCommand(loop, 'diff', []);
  assert.match(r.message, /\*\*a\.rb\*\* — waiting for approval/);
  assert.match(r.message, /```diff[\s\S]*-def a = 1[\s\S]*\+def a = 2/);
  diffEngine.rejectDiff(d.id);
  r = await handleSlashCommand(loop, 'diff', []);
  assert.match(r.message, /rejected — not written/);
});

test('a compaction that worked is one line; one that needs you keeps the long text', () => {
  const loopSrc = src('backend/core/turn/agent-loop.js');
  assert.match(loopSrc, /content: result\.handedOver\s*\? `🗜 /);
});

test('a menu pick echoes its command above the answer, like every local command', () => {
  // Reported: "i changed effort but effort did not show up in messages".
  assert.match(src('frontend/components/Menus.jsx'),
    // `/effort mismatch`, not `/effort`: the chooser's own words (v7.9).
    /\{ role: 'user', content: `\/\$\{\[command, \.\.\.args\.slice\(0, -1\)\]\.join\(' '\)\}`, isLocal: true \},\s*\{ role: 'assistant', content: result\.message, isLocal: true \}/);
});
