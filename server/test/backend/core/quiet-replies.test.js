/**
 * A setting that changes says so in one line: `⚙ <setting>  from → to`, or
 * `already <value>` when nothing changed (owner, 2026-10-26: "subagent on ->
 * off or already off/on whatever something simple").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { changed, handleSlashCommand } from '../../../src/backend/core/slash-commands.js';

test('a change names both ends; no change says already', () => {
  assert.equal(changed('mode', 'plan', 'auto'), '⚙ mode  **plan** → **auto**');
  assert.equal(changed('memory', 'on', 'on'), '⚙ memory  already **on**');
  assert.equal(changed('mode', 'auto', 'plan', 'x'), '⚙ mode  **auto** → **plan** · x');
});

function subagentLoop(on) {
  const loop = {
    modelConfig: { subagents: on },
    get subagentsEnabled() { return this.modelConfig.subagents !== false; },
    saved: 0, resets: 0,
    _saveConfig() { this.saved++; },
    promptBuilder: { resetPromptState() { loop.resets++; } },
  };
  return loop;
}

test('/subagents off then off again: one line each, one prompt reset', async () => {
  const loop = subagentLoop(true);
  const first = await handleSlashCommand(loop, 'subagents', ['off']);
  assert.equal(first.message, '⚙ subagents  **on** → **off**');
  const again = await handleSlashCommand(loop, 'subagents', ['off']);
  assert.equal(again.message, '⚙ subagents  already **off**');
  assert.equal(loop.resets, 1, 'nothing changed the second time, so the prompt is not rebuilt');
});

test('mode replies are one line with no emoji', async () => {
  for (const mode of ['plan', 'auto', 'strict']) {
    const loop = { mode: mode === 'auto' ? 'plan' : 'auto' };
    const { message } = await handleSlashCommand(loop, mode, []);
    assert.ok(!message.includes('\n'), `/${mode} is one line`);
    assert.match(message, new RegExp(`^⚙ mode  \\*\\*\\w+\\*\\* → \\*\\*${mode}\\*\\*`));
    // `⚙` is the marker every setting row carries; nothing else is a glyph.
    assert.doesNotMatch(message.replace(/^⚙/, ''), /\p{Extended_Pictographic}/u);
  }
});
