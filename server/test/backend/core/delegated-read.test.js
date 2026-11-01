/**
 * A large file is read by a subagent, and the main chat gets a digest (v6.16,
 * plan Phase 7). If the subagent fails or times out, and only then, the main
 * chat gets the ordinary first page and a line saying to read it itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DIGEST_MAX_CHARS, delegationPrompt, digestContent, runDelegatedRead, shouldDelegateRead, usableDigest,
} from '../../../src/backend/core/delegated-read.js';
import { readFile } from '../../../src/backend/mcp/tools/read-file.js';
import { formatReadResult, fitReadResult } from '../../../src/backend/core/result-budget.js';
import { summarizeResult } from '../../../src/frontend/format.js';

function workspace() {
  const ws = mkdtempSync(join(tmpdir(), 'dread-'));
  writeFileSync(join(ws, 'big.js'), Array.from({ length: 2140 }, (_, i) => `const line${i} = ${i};`).join('\n'));
  writeFileSync(join(ws, 'small.js'), 'const a = 1;\n'.repeat(300));
  writeFileSync(join(ws, 'min.js'), `var x=${'1+'.repeat(50_000)}1;`);
  writeFileSync(join(ws, 'blob.bin'), Buffer.from([1, 0, 2, 0, 3].concat(Array(200_000).fill(0))));
  writeFileSync(join(ws, 'huge.js'), 'x\n'.repeat(700_000));
  return ws;
}
const on = (ws) => ({ workspace: ws, subagentsEnabled: true, largeFiles: undefined });
const read = (path, extra = {}) => ({ name: 'read_file', args: { path, ...extra } });

test('the trigger: over 1,200 lines or 80 KB, unranged, subagents on, setting not direct', () => {
  const ws = workspace();
  try {
    const big = shouldDelegateRead(read('big.js'), on(ws));
    assert.equal(big.lines, 2140);
    assert.equal(big.relPath, 'big.js');
    assert.ok(shouldDelegateRead(read('min.js'), on(ws)), 'a minified file is one line and huge');
    assert.equal(shouldDelegateRead(read('small.js'), on(ws)), null, 'small');
    assert.equal(shouldDelegateRead(read('big.js', { startLine: 1, endLine: 50 }), on(ws)), null, 'a range reads directly');
    assert.equal(shouldDelegateRead(read('big.js', { startLine: 900 }), on(ws)), null, 'so does a start alone');
    assert.equal(shouldDelegateRead(read('big.js'), { ...on(ws), subagentsEnabled: false }), null, 'subagents off');
    assert.equal(shouldDelegateRead(read('big.js'), { ...on(ws), largeFiles: 'direct' }), null, 'setting');
    assert.equal(shouldDelegateRead(read('blob.bin'), on(ws)), null, 'binary: the read refuses it');
    assert.equal(shouldDelegateRead(read('huge.js'), on(ws)), null, 'over 1 MB: the read refuses it');
    assert.equal(shouldDelegateRead(read('missing.js'), on(ws)), null, 'missing: the read says so');
    assert.equal(shouldDelegateRead({ name: 'grep_search', args: { path: 'big.js' } }, on(ws)), null);
    assert.ok(shouldDelegateRead(read(join(ws, 'big.js')), on(ws)), 'an absolute path');
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('the subagent is told the path, the size, the purpose and the three parts', () => {
  const p = delegationPrompt({ relPath: 'big.js', lines: 2140, purpose: 'where refunds are excluded' });
  assert.match(p, /`big\.js` \(2,140 lines\)/);
  assert.match(p, /where refunds are excluded/);
  assert.match(p, /## Outline[\s\S]*## Passages[\s\S]*## Notes/);
  assert.match(delegationPrompt({ relPath: 'a', lines: 1300 }), /an overview/);
});

function fakeLoop(ws, answer) {
  return {
    workspace: ws, currentObjective: 'find the refund rule', mainModel: 'gemini', asked: null,
    async _runSubAgentSession(role, prompt, model, effort, opts) {
      this.asked = { role, prompt, effort, opts };
      return typeof answer === 'function' ? answer() : answer;
    },
  };
}
const direct = (ws, path = 'big.js') => async () => ({ success: true, result: await readFile({ path }, { workspace: ws }) });

test('a digest reaches the main prompt, not the file, and says it is a digest', async () => {
  const ws = workspace();
  try {
    const info = shouldDelegateRead(read('big.js'), on(ws));
    const digest = '## Outline\n- consts (lines 1–2140)\n\n## Passages\n  12: const line11 = 11;\n\n## Notes\nA list of constants.';
    const loop = fakeLoop(ws, { success: true, result: digest, rounds: 3 });
    const r = await runDelegatedRead(loop, read('big.js', { purpose: 'line 11' }), info, direct(ws));
    assert.equal(loop.asked.role, 'research');
    assert.equal(loop.asked.opts.timeoutMs, 90_000);
    assert.match(loop.asked.prompt, /line 11/, 'the purpose given wins over the objective');
    assert.equal(r.result.delegated, 'subagent');
    const text = formatReadResult(r.result);
    assert.match(text, /^big\.js · 2140 lines · read by a subagent; this is its digest, not the file/);
    assert.match(text, /## Passages/);
    assert.match(text, /exact text: read_file "big\.js" with startLine\/endLine/);
    assert.doesNotMatch(text, /line2000/, 'not the file');
    assert.ok(text.length < 6000);
    assert.equal(summarizeResult('read_file', r.result), '2,140 lines · summarised by a subagent');
    // And without a purpose, the turn's objective.
    const loop2 = fakeLoop(ws, { success: true, result: digest });
    await runDelegatedRead(loop2, read('big.js'), info, direct(ws));
    assert.match(loop2.asked.prompt, /find the refund rule/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

for (const [why, answer, says] of [
  ['a timeout', { success: false, timedOut: true, error: 'gemini did not answer within 90s.' }, /timed out after 90s/],
  ['a failure', { success: false, error: 'no tab' }, /it failed/],
  ['an empty answer', { success: true, result: '  ' }, /returned nothing usable/],
  ['a throw', () => { throw new Error('boom'); }, /it failed/],
]) {
  test(`on ${why}, the ordinary first page and "read it yourself"`, async () => {
    const ws = workspace();
    try {
      const info = shouldDelegateRead(read('big.js'), on(ws));
      const r = await runDelegatedRead(fakeLoop(ws, answer), read('big.js'), info, direct(ws));
      assert.equal(r.success, true);
      assert.equal(r.result.delegated, undefined);
      assert.deepEqual(r.result.range, { start: 1, end: 800 });
      assert.match(r.result.content, says);
      assert.match(r.result.content, /^The subagent could not read this file .*Read it yourself: continue with startLine=801\./);
      // Still cut by whole lines when the batch is tight.
      assert.match(fitReadResult(r.result, 3000), /were not shown/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
}

test('the digest is capped by whole lines and a tool call is not a digest', () => {
  const long = Array.from({ length: 400 }, (_, i) => `  ${i}: ${'x'.repeat(40)}`).join('\n');
  const out = digestContent(long, { relPath: 'a.js', lines: 3000 });
  assert.ok(out.length <= DIGEST_MAX_CHARS, `${out.length}`);
  assert.match(out, /digest cut to fit/);
  assert.match(out, /exact text: read_file "a\.js"/);
  assert.equal(usableDigest('```json\n{"name": "read_file", "args": {}}\n```'), false);
  assert.equal(usableDigest('ok'), false);
  assert.equal(usableDigest('## Outline\n- a function that does a thing (lines 1–40)'), true);
});

test('dispatch: a delegated read runs beside the batch, and only from the main loop', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../../src/backend/core/agent-loop.js', import.meta.url), 'utf8');
  assert.match(src, /const isParallel = call\.name === 'ask_subagent' \|\| Boolean\(delegate\);/);
  assert.match(src, /\} else if \(delegate\) \{\s*result = await runDelegatedRead\(/);
  // A subagent's reads go straight to the MCP server, never through
  // `_executeToolCalls`, so delegation cannot recurse.
  const session = readFileSync(new URL('../../../src/backend/core/subagent-session.js', import.meta.url), 'utf8');
  assert.doesNotMatch(session, /runDelegatedRead|_executeToolCalls/);
});

test('the subagent session gives each turn what is left of its budget, and says when it ran out', async () => {
  const { runSubAgentSession } = await import('../../../src/backend/core/subagent-session.js');
  const seen = [];
  const loop = {
    workspace: mkdtempSync(join(tmpdir(), 'dread-s-')), modelOptions: [], modelConfig: {},
    promptBuilder: { buildSubagentWrapper: () => 'You are a research subagent.' },
    callbacks: { sendToPanel() {} }, _sendEndSession() {},
    _extractToolCalls: () => ({ toolCalls: [{ name: 'read_file', args: { path: 'x' } }], cleanContent: '' }),
    mcpServer: { executeTool: async () => ({ success: true, result: 'page' }) },
    async _executeSubagent(model, prompt, opts) {
      seen.push(opts.timeoutMs);
      if (seen.length === 2) return { success: false, timedOut: true, error: 'gemini did not answer within 1s.' };
      return { success: true, content: 'reading' };
    },
  };
  const r = await runSubAgentSession(loop, 'research', 'read x', 'gemini', null, { timeoutMs: 90_000 });
  assert.equal(r.success, false);
  assert.equal(r.timedOut, true);
  assert.equal(r.rounds, 2);
  assert.ok(seen.every((ms) => ms > 0 && ms <= 90_000), seen.join());
  // Without a budget, the per-turn watchdog is the caller's default.
  seen.length = 0;
  await runSubAgentSession(loop, 'research', 'read x', 'gemini');
  assert.equal(seen[0], undefined);
});
