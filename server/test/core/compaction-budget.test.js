/**
 * `/compact` stalled five minutes in silence, and the work was not worth it.
 *
 * Reproduced before anything was changed: eight history rows, no extension
 * answering, one transient status line and then nothing at all until the
 * deterministic fallback ran. Two independent causes.
 *
 *  - **The deadline was a watchdog.** `_executeSubagent`'s only exit was a
 *    fixed 300,000ms timeout — no throw, no rejection, no shorter path — so the
 *    UI's try/catch never fired and it read as a hang. Five minutes is right for
 *    a background task nobody is waiting on and wrong for a command someone
 *    typed.
 *  - **The guard counted the wrong thing.** `length <= 5` is rows, not
 *    exchanges: three short Q&A pairs is already eight rows, and `slice(0, -5)`
 *    then left **three rows** to summarise. A full inject → think → scrape cycle
 *    — 4,673ms median, 14,913ms p90 — to condense a few hundred characters.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactHistory } from '../../src/core/compaction.js';

const rows = (n, len) => Array.from({ length: n }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  content: 'x'.repeat(len),
}));

function stubLoop(history, answer = { ok: false, timedOut: true }) {
  const seen = { askOpts: null, prompt: null, calls: 0, statuses: [], newChat: 0 };
  const loop = {
    conversationHistory: history,
    // Never the repo: compaction archives the turns and logs a notice, and
    // with `process.cwd()` that was `.agent/server/` in this checkout — a
    // 4 MB archive grown by every `npm test` since 2026-09-21.
    workspace: mkdtempSync(join(tmpdir(), 'compact-budget-')),
    contextTokens: 1234,
    sessionStore: { saveHistory() {}, appendTurn() {} },
    promptBuilder: { resetPromptState() {} },
    callbacks: { sendToPanel: (m) => { if (m.type === 'status') seen.statuses.push(m.payload); } },
    _resetContextCount() {},
    async startNewChat() { seen.newChat += 1; return false; },
    async _askThread(prompt, opts) {
      seen.calls += 1;
      seen.prompt = prompt;
      seen.askOpts = opts;
      return answer;
    },
  };
  return { loop, seen };
}

test('what /compact refuses to do', async (t) => {
  await t.test('under the row floor it says so', async () => {
    const { loop, seen } = stubLoop(rows(4, 50));
    const r = await compactHistory(loop);
    assert.match(r.message, /too short to compact/);
    assert.equal(seen.calls, 0);
  });

  /*
   * The reported case. Eight rows passed the old guard and bought five minutes
   * of silence to summarise three rows of about forty characters each.
   */
  await t.test('enough rows but nothing in them costs no round trip', async () => {
    const { loop, seen } = stubLoop(rows(8, 40));
    const r = await compactHistory(loop);
    assert.equal(seen.calls, 0, 'spent a browser round trip on a few hundred characters');
    assert.match(r.message, /Nothing worth compacting yet/);
    assert.match(r.message, /characters/);
  });

  // It must still say where the user stands, or "nothing to do" reads as a
  // refusal to work rather than as an answer.
  await t.test('and it reports the context it declined to shrink', async () => {
    const { loop } = stubLoop(rows(8, 40));
    const r = await compactHistory(loop);
    assert.match(r.message, /1,234 tokens/);
  });
});

test('what it does do', async (t) => {
  await t.test('it asks this chat for the summary, with a short prompt and a bound', async () => {
    const { loop, seen } = stubLoop(rows(12, 400));
    const r = await compactHistory(loop);
    assert.equal(seen.calls, 1);
    assert.ok(seen.askOpts?.timeoutMs <= 120_000, `a person is watching for ${seen.askOpts?.timeoutMs}ms`);
    // The point of asking the thread: the history is not pasted back into it.
    assert.ok(seen.prompt.length < 1000, `the summary prompt is ${seen.prompt.length} characters`);
    assert.ok(!seen.prompt.includes('x'.repeat(400)), 'the history was re-sent');
    assert.match(r.message, /Compacted \d+ turns/);
  });

  // The fallback is what makes any deadline safe: the worst case is a blunter
  // summary, never a lost turn.
  await t.test('a chat that never answers still produces a compaction', async () => {
    const { loop } = stubLoop(rows(12, 400));
    const r = await compactHistory(loop);
    assert.match(r.message, /condensed locally/);
  });

  await t.test('the wait is one spinner line; the stages ride along undrawn (v7.9)', async () => {
    const { loop, seen } = stubLoop(rows(12, 400));
    await compactHistory(loop);
    assert.deepEqual(seen.statuses.map((p) => p.progress?.step), [1, 2, 3]);
    for (const s of seen.statuses) assert.equal(s.message, 'Compacting conversation…');
  });
});

test('the watchdog survives for the callers it was written for', () => {
  const src = readFileSync(new URL('../../src/core/agent-loop.js', import.meta.url), 'utf8');
  assert.match(src, /SUBAGENT_WATCHDOG_MS/,
    'the default deadline is gone, so a background subagent can hold a lane forever');
  assert.match(src, /timeoutMs = SUBAGENT_WATCHDOG_MS/,
    'callers that pass nothing no longer get the watchdog');
  assert.match(src, /}, timeoutMs\);/,
    'the timer still uses a constant, so the caller-supplied budget is ignored');
});
