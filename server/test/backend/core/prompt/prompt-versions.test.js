import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../../src/backend/core/turn/agent-loop.js';
import { PromptBuilder } from '../../../../src/backend/core/prompt/prompt-builder.js';
import { handleSlashCommand, AGENT_COMMANDS, promptVersionRows } from '../../../../src/backend/core/turn/slash-commands.js';
import { logToolUsage, summariseToolUsage } from '../../../../src/backend/core/logs/tool-usage.js';
import { PROMPT_VERSIONS, DEFAULT_PROMPT_VERSION, CURRENT_PROMPT_VERSION, LEGACY_VERSIONS, resolvePromptVersion, isPromptVersion } from '../../../../src/backend/core/prompt/prompt-versions.js';
import { userSettingsPath } from '../../../../src/backend/core/workspace/paths.js';
import { describeSettings } from '../../../../src/backend/core/workspace/settings.js';

/*
 * Prompt versions (v5.32): a setting, recorded per reply and per turn, so a
 * newer prompt can be compared with the frozen v1 instead of replacing it.
 * Since v9.9.5 there are two, v1 (original) and v7 (current); v2 to v6 read
 * as v7, and logged rows keep their labels.
 */

function loop(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pv-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const l = Object.create(AgentLoop.prototype);
  Object.assign(l, { workspace: dir, promptBuilder: new PromptBuilder(dir, dir), modelConfig: { effort: 'high' } });
  return l;
}

test('a missing setting is v1, an unknown one too; v2 to v6 and "current" are v7', () => {
  assert.equal(DEFAULT_PROMPT_VERSION, 'v1');
  assert.equal(CURRENT_PROMPT_VERSION, 'v7');
  assert.deepEqual(Object.keys(PROMPT_VERSIONS), ['v1', 'v7']);
  assert.equal(resolvePromptVersion(undefined).id, 'v1');
  assert.equal(resolvePromptVersion('v9').id, 'v1');
  for (const old of LEGACY_VERSIONS) assert.equal(resolvePromptVersion(` ${old.toUpperCase()} `).id, 'v7', old);
  assert.equal(resolvePromptVersion('current').id, 'v7');
  assert.equal(resolvePromptVersion('original').id, 'v1');
  assert.ok(isPromptVersion('v2') && !isPromptVersion('toString'), 'no prototype keys');
  for (const v of Object.values(PROMPT_VERSIONS)) assert.ok(v.summary && v.refreshEvery > 0);
});

test('switching re-teaches the chat only when the version changes, and is saved per person', (t) => {
  const l = loop(t);
  l.promptBuilder.markSystemPromptSeen();
  const same = l.setPromptVersion('v1');
  assert.equal(same.changed, false);
  assert.equal(l.promptBuilder.hasSeenSystemPrompt, true, 'no full prompt to change nothing');
  const r = l.setPromptVersion('current');
  assert.deepEqual([r.ok, r.changed, r.from, r.to], [true, true, 'v1', 'v7']);
  assert.equal(l.promptBuilder.hasSeenSystemPrompt, false, 'the thread must be sent v7');
  assert.equal(l.promptVersion, 'v7');
  assert.equal(JSON.parse(readFileSync(userSettingsPath(), 'utf8')).promptVersion, 'v7');
  assert.equal(l.setPromptVersion('v3').changed, false, 'v3 is the current prompt now');
  assert.equal(l.setPromptVersion('nope').ok, false);
  l.setPromptVersion('v1');
});

test('/prompt: bare compares, a version switches, a wrong word is refused', async (t) => {
  assert.ok(AGENT_COMMANDS.has('prompt'));
  const l = loop(t);
  logToolUsage(l.workspace, { read_file: 2 }, { rounds: 3 }); // an old row: counts as v1
  logToolUsage(l.workspace, { read_file: 1 }, { rounds: 1, promptVersion: 'v2' });
  logToolUsage(l.workspace, {}, { rounds: 0, promptVersion: 'v2' });
  const bare = (await handleSlashCommand(l, 'prompt', [])).message;
  assert.match(bare, /Prompt \*\*v1\*\*/);
  assert.match(bare, /❯ v1  original .*1 turn · rounds median 3/);
  assert.match(bare, /  v7  current .*not used yet/, 'v2 rows stay v2: they measured v2');
  assert.match(bare, /`\/prompt current` to switch/);
  assert.match(bare, /Jira, MCP servers and memory work on both/);
  assert.match((await handleSlashCommand(l, 'prompt', ['current'])).message, /⚙ prompt {2}\*\*v1\*\* → \*\*v7\*\*/);
  assert.match((await handleSlashCommand(l, 'prompt', ['v4'])).message, /already \*\*v7\*\* · v4 is part of the current prompt now/);
  assert.match((await handleSlashCommand(l, 'prompt', ['v9'])).message, /No prompt version \*\*v9\*\* · there is `current` \(v7\) and `original` \(v1\)/);
  l.setPromptVersion('v1');
});

test('the /prompt menu rows: short hint, use, current marked (v6.10)', (t) => {
  const l = loop(t);
  logToolUsage(l.workspace, { read_file: 1 }, { rounds: 2, promptVersion: 'v7' });
  const rows = promptVersionRows(l);
  assert.deepEqual(rows.map((r) => r.id), ['v1', 'v7']);
  assert.deepEqual(rows.map((r) => r.label), ['original', 'current']);
  assert.deepEqual(rows.map((r) => r.current), rows.map((r) => r.id === DEFAULT_PROMPT_VERSION));
  const v7 = rows.find((r) => r.id === 'v7');
  assert.equal(v7.hint, PROMPT_VERSIONS.v7.hint);
  assert.match(v7.use, /^1 turn · rounds median 2/);
  assert.equal(rows.find((r) => r.id === 'v1').use, 'not used yet');
  // The menu opens on bare /prompt only; typed with a version it still sets.
  const hook = readFileSync(new URL('../../../../src/frontend/hooks/use-slash-commands.js', import.meta.url), 'utf8');
  assert.match(hook, /command === 'prompt' && args\.length === 0\) \{\s*setActiveMenu\(\{ type: 'prompt' \}\)/);
});

test('the usage log splits by version; rows from before count as v1', (t) => {
  const l = loop(t);
  logToolUsage(l.workspace, { grep_search: 1 }, { rounds: 2 });
  logToolUsage(l.workspace, { grep_search: 1 }, { rounds: 4, promptVersion: 'v2' });
  const u = summariseToolUsage(l.workspace);
  assert.deepEqual(u.versions.map((v) => [v.version, v.turns, v.rounds.median]), [['v1', 1, 2], ['v2', 1, 4]]);
  assert.match(readFileSync(join(l.workspace, '.agent', 'logs', 'tool-usage.jsonl'), 'utf8'), /"promptVersion":"v2"/);
});

test('the builder reads its version: refresh cadence and files come from the entry', (t) => {
  const l = loop(t);
  const pb = l.promptBuilder;
  assert.equal(pb.promptVersion, 'v1');
  assert.equal(pb._refreshEvery(), PROMPT_VERSIONS.v1.refreshEvery);
  pb.promptVersion = 'v7';
  assert.equal(pb._refreshEvery(), PROMPT_VERSIONS.v7.refreshEvery);
});

test('/settings has a Prompt row that steps through the versions', (t) => {
  const l = loop(t);
  l.diffEngine = { getPendingDiffs: () => [], appliedDiffs: [] };
  const row = describeSettings(l).find((r) => r.label === 'Prompt');
  assert.equal(row.value, 'v1');
  assert.deepEqual(row.control.options, ['v1', 'v7']);
  assert.equal(row.restore('v7'), '/prompt v7');
});
