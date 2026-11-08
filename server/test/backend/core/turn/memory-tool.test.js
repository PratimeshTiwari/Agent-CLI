import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dispatchLoopTool } from '../../../../src/backend/core/turn/loop-tools.js';
import { MemoryManager } from '../../../../src/backend/context/memory-manager.js';
import { PromptBuilder } from '../../../../src/backend/core/prompt/prompt-builder.js';
import { MEMORY_NUDGE } from '../../../../src/backend/core/prompt/standing-rule.js';
import { renderToolDefinitions } from '../../../../src/backend/core/prompt/tool-catalog.js';
import { FEATURES } from '../../../../src/backend/core/prompt/prompt-versions.js';
import { logToolUsage, summariseToolUsage } from '../../../../src/backend/core/logs/tool-usage.js';

function setup(version = 'v7') {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-v6-'));
  fs.mkdirSync(path.join(ws, '.agent'));
  const promptBuilder = new PromptBuilder(ws);
  promptBuilder.promptVersion = version;
  let resets = 0;
  const reset = promptBuilder.resetPromptState.bind(promptBuilder);
  promptBuilder.resetPromptState = () => { resets += 1; reset(); };
  const loop = {
    workspace: ws,
    memoryManager: new MemoryManager(ws),
    promptBuilder,
    sessionStore: { liveId: () => 'sess_9' },
  };
  const call = (args) => dispatchLoopTool(loop, { name: 'manage_memory', args });
  return { ws, loop, call, promptBuilder, resets: () => resets };
}

const turn0 = (b, userMessage = 'hello') => b.buildPrompt({ userMessage, mode: 'plan', modelConfig: { effort: 'medium' } });

// Memory was prompt v6's; since v9.9.5 it is a feature of every version.
describe('manage_memory, on every prompt version', () => {
  test('add stamps the session, and does not re-teach the chat', async () => {
    const { call, loop, resets } = setup();
    const got = await call({ action: 'add', fact: 'Tests run with pnpm', why: 'the user said so' });
    assert.equal(got.result, 'Remembered as tests-run-with-pnpm.');
    assert.equal(loop.memoryManager.getEntries()[0].session, 'sess_9');
    assert.equal(resets(), 0);
  });

  test('v1 too: no re-teaching, and facts by name (v1 to v5 reset the chat on every save)', async () => {
    const { call, resets } = setup('v1');
    await call({ action: 'add', fact: 'a fact' });
    assert.equal(resets(), 0);
    assert.match((await call({ action: 'remove', name: 'a-fact' })).result, /a-fact/);
  });

  test('read gives the fact, the reason and the author', async () => {
    const { call } = setup();
    await call({ action: 'add', fact: 'A fact', why: 'a reason' });
    const { result } = await call({ action: 'read', name: 'a-fact' });
    assert.match(result, /A fact/);
    assert.match(result, /Why: a reason/);
    assert.match(result, /Written by agent/);
  });

  test('every refusal says what to do next', async () => {
    const { call, ws } = setup();
    await call({ action: 'add', fact: 'A fact' });
    assert.match((await call({ action: 'read', name: 'nope' })).error, /manage_memory list/);
    fs.writeFileSync(path.join(ws, '.agent', 'memory', 'a-fact.md'), 'changed by another agent');
    assert.match((await call({ action: 'update', name: 'a-fact', fact: 'x' })).error, /Read it again/);
    assert.match((await call({ action: 'remove', name: 'a-fact' })).error, /Read it again/);
    assert.match((await call({ action: 'update', name: 'nope', fact: 'x' })).error, /No fact named/);
  });

  test('a duplicate is an answer, not an error to retry', async () => {
    const { call } = setup();
    await call({ action: 'add', fact: 'Same' });
    assert.equal((await call({ action: 'add', fact: 'same' })).result, 'Already remembered as same.');
  });

  test('a fact past the limit is refused whole, never cut', async () => {
    const { call, loop } = setup();
    assert.match((await call({ action: 'add', fact: 'x'.repeat(1001) })).error, /at most 1000/);
    assert.deepEqual(loop.memoryManager.getAllMemories(), []);
  });

  test('off stores nothing, and says so plainly', async () => {
    const { call, loop } = setup();
    loop.memoryManager.memoryEnabled = false;
    assert.match((await call({ action: 'add', fact: 'x' })).result, /turned off/);
    assert.deepEqual(loop.memoryManager.getAllMemories(), []);
  });

  test('an unknown action names the real ones', async () => {
    assert.match((await setup().call({ action: 'forget' })).error, /"add", "read"/);
  });
});

describe('the prompt', () => {
  test('v6 carries an index with names, and v5 the numbered facts', () => {
    const a = setup();
    a.loop.memoryManager.addMemory('Fact one', { why: 'a secret reason' });
    const six = turn0(a.promptBuilder);
    assert.match(six, /<memory>[\s\S]*- fact-one: Fact one[\s\S]*<\/memory>/);
    assert.doesNotMatch(six, /a secret reason/);

    const b = setup('v1');
    b.loop.memoryManager.addMemory('Fact one');
    assert.match(turn0(b.promptBuilder), /<memory>[\s\S]*- fact-one: Fact one[\s\S]*<\/memory>/, 'v1 gets the index too');
  });

  test('no facts, no block', () => {
    assert.doesNotMatch(turn0(setup().promptBuilder), /<memory>\n/);
  });

  test('a saved fact is carried into the next session, the half that was missing', async () => {
    const first = setup();
    await first.call({ action: 'add', fact: 'Deploys go through make ship' });
    const next = new PromptBuilder(first.ws);
    next.promptVersion = 'v1';
    assert.match(turn0(next), /make ship/);
  });

  test('the nudge rides on the turn that needs it, and only there', () => {
    const { promptBuilder: b } = setup();
    assert.ok(turn0(b, 'from now on use pnpm').includes(MEMORY_NUDGE));
    assert.equal(b.memoryNudged, true);
    assert.ok(!b.buildPrompt({ userMessage: 'push it', mode: 'plan' }).includes(MEMORY_NUDGE));
    assert.equal(b.memoryNudged, false);
  });

  test('v1 nudges too; negative control: never with memory off', () => {
    const one = setup('v1');
    assert.ok(turn0(one.promptBuilder, 'from now on use pnpm').includes(MEMORY_NUDGE));

    const off = setup();
    fs.writeFileSync(path.join(off.ws, '.agent', 'config.json'), JSON.stringify({ memoryEnabled: false }));
    assert.ok(!turn0(off.promptBuilder, 'from now on use pnpm').includes('memory_nudge'));
  });

  test('the tool names facts on both tiers; without the feature it took numbers (control)', () => {
    for (const tier of ['flash', 'pro']) {
      assert.match(renderToolDefinitions(tier, true, {}, FEATURES), /"update"/);
      assert.doesNotMatch(renderToolDefinitions(tier, true, {}, {}), /"update"/);
    }
  });
});

describe('the nudge is judged by the log', () => {
  test('asked and saved are counted apart', () => {
    const { ws } = setup();
    logToolUsage(ws, { read_file: 1 }, { memoryNudged: true });
    logToolUsage(ws, { manage_memory: 1 }, { memoryNudged: true });
    logToolUsage(ws, { manage_memory: 1 }, {});
    assert.deepEqual(summariseToolUsage(ws).nudges, { asked: 2, saved: 1 });
  });

  test('negative control: a turn that was not nudged writes no field', () => {
    const { ws } = setup();
    logToolUsage(ws, {}, { memoryNudged: false });
    assert.equal(fs.readFileSync(path.join(ws, '.agent', 'logs', 'tool-usage.jsonl'), 'utf8').includes('memoryNudged'), false);
  });
});
