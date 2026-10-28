import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { PromptBuilder } from '../../src/core/prompt-builder.js';
import { handleSlashCommand, AGENT_COMMANDS } from '../../src/core/slash-commands.js';
import { logToolUsage, summariseToolUsage } from '../../src/core/tool-usage.js';
import { PROMPT_VERSIONS, DEFAULT_PROMPT_VERSION, resolvePromptVersion, isPromptVersion } from '../../src/core/prompt-versions.js';
import { userSettingsPath } from '../../src/core/paths.js';
import { describeSettings } from '../../src/core/settings.js';

/*
 * Prompt versions (v5.32): a setting, recorded per reply and per turn, so a
 * newer prompt can be compared with the frozen v1 instead of replacing it.
 */

function loop(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pv-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const l = Object.create(AgentLoop.prototype);
  Object.assign(l, { workspace: dir, promptBuilder: new PromptBuilder(dir, dir), modelConfig: { effort: 'high' } });
  return l;
}

test('v1 is the default, and anything unknown reads as v1', () => {
  assert.equal(DEFAULT_PROMPT_VERSION, 'v1');
  assert.equal(resolvePromptVersion(undefined).id, 'v1');
  assert.equal(resolvePromptVersion('v9').id, 'v1');
  assert.equal(resolvePromptVersion(' V2 ').id, 'v2');
  assert.ok(isPromptVersion('v2') && !isPromptVersion('toString'), 'no prototype keys');
  for (const v of Object.values(PROMPT_VERSIONS)) assert.ok(v.summary && v.refreshEvery > 0);
});

test('switching re-teaches the chat only when the version changes, and is saved per person', (t) => {
  const l = loop(t);
  l.promptBuilder.markSystemPromptSeen();
  const same = l.setPromptVersion('v1');
  assert.equal(same.changed, false);
  assert.equal(l.promptBuilder.hasSeenSystemPrompt, true, 'no full prompt to change nothing');
  const r = l.setPromptVersion('v2');
  assert.deepEqual([r.ok, r.changed, r.from, r.to], [true, true, 'v1', 'v2']);
  assert.equal(l.promptBuilder.hasSeenSystemPrompt, false, 'the thread must be sent v2');
  assert.equal(l.promptVersion, 'v2');
  assert.equal(JSON.parse(readFileSync(userSettingsPath(), 'utf8')).promptVersion, 'v2');
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
  assert.match(bare, /❯ v1 .*1 turn · rounds median 3/);
  assert.match(bare, /  v2 .*2 turns · rounds median/);
  assert.match((await handleSlashCommand(l, 'prompt', ['v2'])).message, /⚙ prompt {2}\*\*v1\*\* → \*\*v2\*\*/);
  assert.match((await handleSlashCommand(l, 'prompt', ['v2'])).message, /already \*\*v2\*\*/);
  assert.match((await handleSlashCommand(l, 'prompt', ['v7'])).message, /No prompt version \*\*v7\*\*/);
  l.setPromptVersion('v1');
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
  pb.promptVersion = 'v2';
  assert.equal(pb._refreshEvery(), PROMPT_VERSIONS.v2.refreshEvery);
});

test('/settings has a Prompt row that steps through the versions', (t) => {
  const l = loop(t);
  l.diffEngine = { getPendingDiffs: () => [], appliedDiffs: [] };
  const row = describeSettings(l).find((r) => r.label === 'Prompt');
  assert.equal(row.value, 'v1');
  assert.deepEqual(row.control.options, Object.keys(PROMPT_VERSIONS));
  assert.equal(row.restore('v2'), '/prompt v2');
});
