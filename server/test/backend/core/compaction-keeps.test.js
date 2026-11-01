/**
 * Compaction keeps what it promises (v6.15, plan Phase 6).
 *
 * The fresh chat is "the summary plus the last few messages". The last few
 * were the last five rows of any kind, and replayed against the real
 * histories they were empty in 28% of cases and one row in 41%: watcher and
 * tool rows filled the window.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compactHistory, countTurns, countsAsTurn, recentMessages, splitForCompaction,
} from '../../../src/backend/core/turn/compaction.js';
import { FileWatcher } from '../../../src/backend/watcher/file-watcher.js';
import { clearOwnWrites, isOwnWrite, noteOwnWrite } from '../../../src/backend/core/edits/own-writes.js';
import { DiffEngine } from '../../../src/backend/core/edits/diff-engine.js';
import { readFileSync } from 'node:fs';

const fs = (n) => ({ role: 'system', type: 'fs_event', content: `[System Event] File f${n}.js was modified externally by the user.` });
const tool = (n) => ({ role: 'system', type: 'tool_result', content: `**Command Output:** ${n}` });
const user = (s) => ({ role: 'user', content: s });
const agent = (s) => ({ role: 'agent', content: s });

/** The measured shape: exchanges with tool rows between, and a watcher burst at the end. */
function measuredHistory() {
  const h = [];
  for (let i = 0; i < 6; i++) {
    h.push(user(`question ${i} ${'q'.repeat(400)}`), tool(i), tool(i + 100), agent(`answer ${i} ${'a'.repeat(400)}`));
    if (i % 2) h.push(fs(i));
  }
  for (let i = 0; i < 12; i++) h.push(fs(200 + i));
  return h;
}

test('three exchanges are handed over, however many rows follow them', () => {
  const h = measuredHistory();
  const { toKeep } = splitForCompaction(h);
  const recent = recentMessages(toKeep);
  for (const i of [3, 4, 5]) {
    assert.match(recent, new RegExp(`\\[user\\] question ${i}`));
    assert.match(recent, new RegExp(`\\[assistant\\] answer ${i}`));
  }
  assert.doesNotMatch(recent, /question 2/);
  assert.doesNotMatch(recent, /System Event|Command Output/, 'tool and watcher rows stay on disk');
});

test('control: the old last-five-rows window hands over nothing from the same history', () => {
  const h = measuredHistory();
  assert.equal(recentMessages(h.slice(-5)), '', 'twelve watcher rows at the end fill five rows');
});

test('fewer exchanges than three: as many as leave something to summarise', () => {
  const h = [user('one'), agent('a1'), user('two'), agent('a2')];
  const { toCompact, toKeep } = splitForCompaction(h);
  assert.deepEqual(toCompact, h.slice(0, 2));
  assert.deepEqual(toKeep, h.slice(2));
  // One long turn: the old rule, so there is still a front to move.
  const one = [user('only'), ...Array.from({ length: 8 }, (_, i) => tool(i))];
  assert.equal(splitForCompaction(one).toKeep.length, 5);
});

test('a summary row in front is summarised with the rest', () => {
  const h = [{ role: 'system', type: 'compaction_summary', content: 'old' }, user('1'), agent('1'), user('2'), agent('2'), user('3'), agent('3')];
  const { toCompact } = splitForCompaction(h);
  assert.deepEqual(toCompact, h.slice(0, 1));
});

test('watcher rows are not turns: counts, the guard, and the local summary', async () => {
  assert.equal(countsAsTurn(fs(1)), false);
  assert.equal(countsAsTurn(tool(1)), true);
  assert.equal(countTurns([user('a'), fs(1), fs(2), agent('b')]), 2);

  // `/compact` on a short chat buried in file notices is still too short.
  const short = [user('hi'), agent('hello'), ...Array.from({ length: 20 }, (_, i) => fs(i))];
  const loop = { conversationHistory: short, contextTokens: 10, isProcessing: false };
  const r = await compactHistory(loop);
  assert.match(r.message, /too short/);

  // The local fallback pastes conversation, not notices, and counts turns.
  const h = measuredHistory();
  const fake = {
    conversationHistory: h, workspace: mkdtempSync(join(tmpdir(), 'ck-')), contextTokens: 1,
    sessionStore: { saveHistory() {} }, promptBuilder: {}, callbacks: { sendToPanel() {} },
    _resetContextCount() {}, async startNewChat() { return true; },
    async _askThread() { return { ok: false, timedOut: true }; },
  };
  const out = await compactHistory(fake, undefined, { auto: true });
  assert.doesNotMatch(out.summary, /System Event/);
  assert.match(out.summary, /question 0/);
  const split = splitForCompaction(h);
  assert.equal(out.turns, countTurns(split.toCompact));
  assert.ok(out.turns < split.toCompact.length, 'the watcher rows inside it are not counted');
});

test('the agent\'s own write is not announced; a later edit is', async () => {
  clearOwnWrites();
  const ws = mkdtempSync(join(tmpdir(), 'own-'));
  const announced = [];
  const loop = { conversationHistory: { push: (t) => announced.push(t.content) }, workspace: ws };
  const w = new FileWatcher(ws, loop, { settleMs: 10 });
  w._startedAt = Date.now() - 1000;
  const file = join(ws, 'a.js');
  writeFileSync(file, 'x');

  noteOwnWrite(file);
  w._settle('a.js', { sawRename: false, firstAt: Date.now() });
  assert.deepEqual(announced, [], 'ours');

  w._settle('a.js', { sawRename: false, firstAt: Date.now() + 10_000 });
  assert.equal(announced.length, 1, 'a real edit after the window still shows');

  clearOwnWrites();
  w._settle('a.js', { sawRename: false, firstAt: Date.now() });
  assert.equal(announced.length, 2, 'control: without the note it is announced');
});

test('DiffEngine notes the path, and its temp file, as it writes', async () => {
  clearOwnWrites();
  const ws = mkdtempSync(join(tmpdir(), 'own-de-'));
  const engine = new DiffEngine(ws);
  engine._writeFileAtomic(join(ws, 'b.js'), 'y');
  assert.equal(readFileSync(join(ws, 'b.js'), 'utf8'), 'y');
  assert.equal(isOwnWrite(join(ws, 'b.js')), true);
  assert.equal(isOwnWrite(join(ws, 'c.js')), false);
});
