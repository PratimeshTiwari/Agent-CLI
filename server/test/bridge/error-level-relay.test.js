/**
 * The browser gets to say an `error` was an expected state — and only that.
 *
 * `discover_models` declining because no tab exists yet accounted for **65 of
 * 274 rows** in three days of logs. It is correct behaviour: a background poll
 * must never make a window appear to answer a question nobody asked. But only
 * the extension knows whether a given ask was that poll or a `/effort` someone
 * is waiting on, because the discriminator is `userInitiated` and it lives in
 * the browser. So `level` travels on the payload.
 *
 * The risk in that is the whole reason for this file. A field the browser
 * controls, read by the code that decides what a failure *is*, could quietly
 * become a field that decides what the bridge *does* — and the bridge does two
 * load-bearing things in this branch: it settles the picker watchdog for
 * `NON_FATAL_EXTENSION_OPS`, and it resolves a lost subagent session. Coupling
 * either to how loudly something is recorded is how a demoted row would stop
 * settling a watchdog, which is a hung turn reported as a quiet log.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from '../../src/bridge/websocket-server.js';
import { readErrors, summarizeErrors } from '../../src/core/error-log.js';

function fakeLoop() {
  const workspace = mkdtempSync(join(tmpdir(), 'error-level-'));
  return {
    workspace,
    isProcessing: true,
    aborted: false,
    settled: [],
    resolved: [],
    callbacks: null,
    setBackgroundCallbacks() {},
    abortExtensionWork() { this.aborted = true; },
    settleModelOptions(reason) { this.settled.push(reason ?? null); },
    resolveSubagent(id, result) { this.resolved.push([id, result]); },
  };
}

async function deliver(loop, payload) {
  const bridge = new WebSocketServer({ port: 0, agentLoop: loop });
  bridge.clients.set('c1', { type: 'extension' });
  await bridge._handleMessage('c1', { type: 'error', payload });
}

test('level: notice on the payload is recorded as a notice', async () => {
  const loop = fakeLoop();
  await deliver(loop, {
    op: 'discover_models',
    stage: 'tab',
    level: 'notice',
    message: '[discover_models] no tab open yet, so there is no picker to read — nothing to do',
  });
  const s = summarizeErrors(loop.workspace);
  assert.equal(s.total, 0, 'not a failure');
  assert.equal(s.notices.count, 1);
  assert.equal(readErrors(loop.workspace)[0].level, 'notice');
});

test('the same op with no level is still a failure', async () => {
  /*
   * The negative control that matters most. `/effort` has already tried
   * `ensureModelTab` and failed to open one by the time it reports, so a
   * `discover_models` with no level is a real fault — and if demotion were
   * keyed on the op rather than on the payload, this row would vanish and the
   * picker faults P2 exists to contain would be invisible.
   */
  const loop = fakeLoop();
  await deliver(loop, {
    op: 'discover_models',
    stage: 'tab',
    message: 'no gemini tab this extension owns',
  });
  assert.equal(summarizeErrors(loop.workspace).total, 1);
  assert.equal(readErrors(loop.workspace)[0].level, undefined);
});

test('anything that is not the word "notice" is a failure', async () => {
  // The browser is not trusted to invent levels. Nothing downstream has to
  // reason about a third value, and a typo reads as loud rather than silent.
  for (const level of ['warning', 'info', 'NOTICE', '', true, null, 0]) {
    const loop = fakeLoop();
    await deliver(loop, { op: 'switch_model', level, message: 'the picker would not open' });
    assert.equal(
      summarizeErrors(loop.workspace).total, 1,
      `level ${JSON.stringify(level)} should not demote`,
    );
  }
});

test('a notice still settles the picker watchdog', async () => {
  /*
   * The point the whole file exists for. The watchdog is about *silence* and a
   * refusal is an answer, so it must be settled either way — otherwise one
   * unreachable tab reports twice, eight seconds apart, reading as two faults.
   * That was 13 and 36 rows of one cause.
   */
  const loop = fakeLoop();
  await deliver(loop, {
    op: 'discover_models', level: 'notice', message: 'no tab open yet',
  });
  assert.equal(loop.settled.length, 1, 'the watchdog was settled');
  assert.equal(loop.aborted, false, 'and the turn underneath it survived');
});

test('a notice still resolves a lost subagent session', async () => {
  // The other branch that reads this payload. A demoted `session_lost` that
  // stopped resolving would hang a batch task rather than resend its history.
  const loop = fakeLoop();
  await deliver(loop, {
    op: 'session_lost', requestId: 'r1', level: 'notice', message: 'tab closed',
  });
  assert.deepEqual(loop.resolved, [['r1', { sessionLost: true }]]);
});

test('a genuine failure still takes the lane down', async () => {
  // The last negative control: the level must not have turned every extension
  // error into something the bridge shrugs at.
  const loop = fakeLoop();
  await deliver(loop, { op: 'inject_prompt', message: 'the composer is gone' });
  assert.equal(loop.aborted, true);
  assert.equal(loop.isProcessing, false);
  assert.equal(summarizeErrors(loop.workspace).total, 1);
});

test('a notice never ends the turn, whatever its op', async () => {
  /*
   * Shipped broken in 1.41.0. `menu_left_open` is a notice from the content
   * script, and this branch decided fatality by op — so an op not on the
   * non-fatal allow-list aborted every lane, including the user's main turn,
   * while the subagent it had delegated to carried on generating in its tab.
   *
   * Any op, not a list of them: the failure was that a *new* informational op
   * fell through, and a test that names `menu_left_open` alone would pass the
   * next one straight into the same hole.
   */
  for (const op of ['menu_left_open', 'send_retried', 'some_future_notice', 'inject_prompt']) {
    const loop = fakeLoop();
    await deliver(loop, { op, level: 'notice', message: `[${op}] nothing went wrong for the user` });
    assert.equal(loop.aborted, false, `a ${op} notice aborted every lane`);
    assert.equal(loop.isProcessing, true, `a ${op} notice ended the turn`);
  }
});

test('and the same op without the level still ends it', async () => {
  // The negative control: the early exit is keyed on the level, so a real
  // failure that happens to share an op name is not quietly kept alive.
  const loop = fakeLoop();
  await deliver(loop, { op: 'menu_left_open', message: 'a real failure with this name' });
  assert.equal(loop.aborted, true);
});
