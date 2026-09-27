/**
 * Failures and notices, counted apart.
 *
 * Three days of `errors.jsonl` held 274 rows. Roughly **ten** of them were
 * product failures. The rest were expected states — a background
 * `discover_models` poll declining because no tab exists yet (65), a build that
 * needed reloading (19), a search that took the slower of two equivalent paths
 * (13) — and a heading that says *"274 failures logged"* about ten failures is
 * not a number anyone can see a regression in. The response it trained was to
 * stop opening `/logs`.
 *
 * So the tests here are mostly about what must **not** happen. A level that
 * demotes too much is strictly worse than the noise it replaced: the noise was
 * legible once you knew to ignore it, whereas a real fault filed as a notice is
 * a fault nobody is told about. Every demotion below therefore has a negative
 * control naming the case that must stay loud.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  logError, logNotice, readErrors, summarizeErrors, weightedErrors, clearErrors, flushPending,
} from '../../src/core/error-log.js';

const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'loglevel-'));

test('the level on the record', async (t) => {
  await t.test('a notice is marked; a failure carries no level at all', () => {
    /*
     * Absence is the failure case on purpose. Writing `level: 'error'` on every
     * row would make the pre-level history — every line in every existing log —
     * look like a different kind of record from the ones written after, and
     * those rows were written by call sites that believed they reported
     * breakage.
     */
    const ws = fresh();
    logNotice(ws, { flow: 'bridge', op: 'extension_stale', message: 'reload it' });
    logError(ws, { flow: 'bridge', op: 'inject', message: 'the socket died' });
    const [failure, notice] = readErrors(ws);
    assert.equal(notice.level, 'notice');
    assert.equal(failure.level, undefined, 'a failure is the absence of a level');
  });

  await t.test('a line written before levels existed reads as a failure', () => {
    // The honest reading of history, not the convenient one: re-reading old
    // rows as calmer than they were would hide the trend this exists to show.
    const ws = fresh();
    fs.mkdirSync(path.join(ws, '.agent', 'logs'), { recursive: true });
    fs.writeFileSync(
      path.join(ws, '.agent', 'logs', 'errors.jsonl'),
      `${JSON.stringify({ time: new Date().toISOString(), flow: 'agent', op: 'old', message: 'from before' })}\n`,
    );
    assert.equal(summarizeErrors(ws).total, 1);
    assert.equal(summarizeErrors(ws).notices.count, 0);
    assert.equal(readErrors(ws, { level: 'error' }).length, 1);
    assert.equal(readErrors(ws, { level: 'notice' }).length, 0);
  });
});

test('summarizeErrors counts failures and reports notices beside them', async (t) => {
  await t.test('the headline number is failures only', () => {
    const ws = fresh();
    logError(ws, { flow: 'agent', op: 'real', message: 'a genuine fault' });
    for (let i = 0; i < 9; i++) {
      logNotice(ws, { flow: 'extension', op: 'discover_models', message: `no tab ${i}` });
    }
    const s = summarizeErrors(ws);
    assert.equal(s.total, 1, 'one failure, not ten');
    assert.equal(s.notices.count, 9);
    assert.deepEqual(s.byFlow.map((f) => f.flow), ['agent'], 'a notice-only flow is not a breaking flow');
  });

  await t.test('notices are surfaced, never dropped', () => {
    /*
     * "Quiet day, 0 notices" and "quiet day, 40 notices" are different days,
     * and the second one has a background poll firing at a tab that never
     * exists. Demote, never drop.
     */
    const ws = fresh();
    logNotice(ws, { flow: 'tool', op: 'grep_no_ripgrep', message: 'using the fallback' });
    const s = summarizeErrors(ws);
    assert.equal(s.total, 0);
    assert.equal(s.notices.count, 1);
    assert.match(s.notices.lastMessage, /fallback/);
    assert.ok(s.notices.last, 'and when it last happened');
  });

  await t.test('a collapsed storm of notices counts as notices while pending', () => {
    const ws = fresh();
    for (let i = 0; i < 50; i++) {
      logNotice(ws, { flow: 'extension', op: 'discover_models', message: 'no tab open yet' });
    }
    const s = summarizeErrors(ws);
    assert.equal(s.total, 0, 'still no failures');
    assert.equal(s.notices.count, 50, 'and all fifty are still counted');
  });

  await t.test('and the tally line written for it is a notice too', () => {
    /*
     * The one place a demoted row can be silently promoted back, and the test
     * above does **not** reach it. Inside the 60s window only the first
     * occurrence is on disk and the other 49 are a number in memory; the tally
     * line is written when the window closes or the process exits. So a tally
     * that forgot its level would resurface 49 notices as 49 failures, and the
     * storm test would still pass — which it did, until this was added.
     *
     * Found by deleting the level from the tally and watching the suite stay
     * green. CLAUDE.md: a passing test lies the same way a missing one does.
     */
    const ws = fresh();
    for (let i = 0; i < 50; i++) {
      logNotice(ws, { flow: 'extension', op: 'discover_models', message: 'no tab open yet' });
    }
    flushPending(); // what the exit handler does, and the only other clock here

    const lines = readErrors(ws);
    const tally = lines.find((l) => l.tally);
    assert.ok(tally, 'the count reached disk at all');
    assert.equal(tally.repeatedSince, 49);
    assert.equal(tally.level, 'notice', 'the tally promoted 49 notices back to failures');

    const s = summarizeErrors(ws);
    assert.equal(s.total, 0, 'still nothing to act on');
    assert.equal(s.notices.count, 50, 'read back off disk this time, not from memory');
  });

  await t.test('a failure\'s tally is still a failure', () => {
    // The negative control: the level rides on the tally conditionally, so an
    // unconditional `level: 'notice'` there would silence every storm there is.
    const ws = fresh();
    for (let i = 0; i < 10; i++) {
      logError(ws, { flow: 'github', op: 'poll', message: '401 Bad credentials' });
    }
    flushPending();
    const tally = readErrors(ws).find((l) => l.tally);
    assert.equal(tally.level, undefined);
    assert.equal(summarizeErrors(ws).total, 10);
    assert.equal(summarizeErrors(ws).notices.count, 0);
  });

  await t.test('a notice and a failure with the same text do not collapse together', () => {
    // Level is in the collapse key. Without it these file under whichever
    // arrived first, so which one wins would depend on call order.
    const ws = fresh();
    logNotice(ws, { flow: 'extension', op: 'discover_models', message: 'same words' });
    logError(ws, { flow: 'extension', op: 'discover_models', message: 'same words' });
    const s = summarizeErrors(ws);
    assert.equal(s.total, 1, 'one failure');
    assert.equal(s.notices.count, 1, 'and one notice, not two of either');
    assert.equal(readErrors(ws).length, 2, 'two lines on disk, so neither was swallowed');

    // The proof that the key separated them: a shared key would have collapsed
    // the second call into the first and written one line, and the level on that
    // one line would have been decided by which call happened to come first.
    const [second, first] = readErrors(ws);
    assert.equal(first.level, 'notice');
    assert.equal(second.level, undefined);
  });
});

test('reading them back', async (t) => {
  await t.test('drilling into a flow returns both levels', () => {
    /*
     * This is where diagnosis happens, and a notice beside the failure that
     * followed it is most of what makes the failure legible — one stale build
     * explains the six selector faults under it. Demoting governs what is
     * counted, not what is visible.
     */
    const ws = fresh();
    logNotice(ws, { flow: 'bridge', op: 'extension_stale', message: 'reload it' });
    logError(ws, { flow: 'bridge', op: 'inject', message: 'and then this broke' });
    assert.equal(readErrors(ws, { flow: 'bridge' }).length, 2);
  });

  await t.test('weightedErrors filters both of its halves', () => {
    /*
     * It reads on-disk lines and in-memory pending counts and adds them. A
     * filter applied to one half only is this module's recurring bug shape: the
     * pending half would hand a caller counting failures a pile of notices.
     */
    const ws = fresh();
    logNotice(ws, { flow: 'extension', op: 'discover_models', message: 'no tab' });
    logNotice(ws, { flow: 'extension', op: 'discover_models', message: 'no tab' }); // pending
    logError(ws, { flow: 'agent', op: 'real', message: 'a fault' });

    const errors = weightedErrors(ws, { level: 'error' });
    assert.equal(errors.reduce((n, e) => n + e.weight, 0), 1);
    assert.ok(errors.every((e) => e.record.level !== 'notice'));

    const notices = weightedErrors(ws, { level: 'notice' });
    assert.equal(notices.reduce((n, e) => n + e.weight, 0), 2, 'on-disk plus pending');
    assert.ok(notices.every((e) => e.record.level === 'notice'));

    assert.equal(weightedErrors(ws).length, errors.length + notices.length, 'unfiltered is both');
  });

  await t.test('clear takes both, and says so in its count', () => {
    const ws = fresh();
    logError(ws, { flow: 'agent', message: 'a fault' });
    logNotice(ws, { flow: 'tool', message: 'expected' });
    assert.equal(clearErrors(ws), 2);
    assert.deepEqual(readErrors(ws), []);
  });
});

test('what stays a failure', async (t) => {
  /*
   * The negative controls. Each of these is a real fault that shares an op, a
   * message or a subsystem with something demoted above, and demoting it would
   * hide precisely the thing `/logs` is read for.
   */
  await t.test('logError is unaffected by an unrelated level value', () => {
    const ws = fresh();
    logError(ws, { flow: 'agent', op: 'x', message: 'y', level: 'warning' });
    assert.equal(summarizeErrors(ws).total, 1, 'anything that is not "notice" is a failure');
    assert.equal(readErrors(ws)[0].level, undefined);
  });

  await t.test('logNotice still never throws', () => {
    // Same contract as logError: every caller is on a path that already has a
    // problem, and a logger that can fail is worse than none.
    assert.doesNotThrow(() => logNotice(null, { flow: 'agent', message: 'x' }));
    assert.doesNotThrow(() => logNotice(fresh(), null));
    assert.doesNotThrow(() => logNotice('/root/not-writable-xyz', { flow: 'agent', message: 'x' }));
  });
});
