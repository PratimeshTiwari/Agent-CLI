/**
 * "The reply arrived after the turn stopped" is two opposite readings.
 *
 * The browser was already generating when the turn ended, so a reply comes back
 * to a loop that no longer wants it and is discarded. Whether that is worth
 * reading about depends entirely on *why* the turn ended, and nothing recorded
 * it — so eight rows in three days said one of two things and there was no way
 * to tell which:
 *
 *   - you pressed esc or typed `:stop`. Discarding the reply is the feature
 *     working, exactly as asked. Nothing to act on.
 *   - a watchdog gave up. The same row now means the deadline was shorter than
 *     the work, which is the signal `stale_response` is worth having.
 *
 * The discriminator cannot be inferred inside the loop, because `isProcessing`
 * is false either way and `abortExtensionWork` runs on both paths — along with
 * injection errors, prompt-build exceptions and stalls. The front-end is the
 * only thing that knows a key was pressed, so it says so.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { readErrors, summarizeErrors } from '../../src/core/error-log.js';

const handleGeminiResponse = AgentLoop.prototype.handleGeminiResponse;
const noteUserStop = AgentLoop.prototype.noteUserStop;

/** Only the fields the stale branch reads. */
function loop() {
  return {
    workspace: mkdtempSync(join(tmpdir(), 'stale-level-')),
    isProcessing: false,
    released: 0,
    _recordThread() {},
    _releaseExtension() { this.released++; },
  };
}

const late = (l) => handleGeminiResponse.call(l, 'm1', { content: 'a late reply', complete: true });

test('after you stopped the turn it is a notice', async () => {
  const l = loop();
  noteUserStop.call(l);
  await late(l);

  const s = summarizeErrors(l.workspace);
  assert.equal(s.total, 0, 'you asked for this; it is not a failure');
  assert.equal(s.notices.count, 1);
  assert.match(readErrors(l.workspace)[0].message, /after you stopped/);
  assert.equal(l.released, 1, 'and the lane still comes back either way');
});

test('with nothing having asked for the stop it stays a failure', async () => {
  /*
   * The negative control, and the reason the demotion is keyed on a recorded
   * stop rather than on the op. A watchdog that gave up early is the one thing
   * this row is genuinely useful for — CLAUDE.md records the same mistake as
   * its own trap: "every timeout must outlast the work it waits on", found
   * twice by a repair whose deadline was shorter than the tab it opened.
   */
  const l = loop();
  await late(l);

  assert.equal(summarizeErrors(l.workspace).total, 1);
  const [row] = readErrors(l.workspace);
  assert.equal(row.level, undefined);
  assert.match(row.detail, /gave up/, 'and it says where to look');
});

test('a cleared stop makes the row loud again', async () => {
  /*
   * A reason with no clock is a flag that ages into a lie. This is the half of
   * that which can be driven: given no recorded stop, the row is a failure.
   * That the *clearing* happens is asserted against the source below — the
   * first cut of this test cleared the field by hand and then checked the
   * result, which measures the test rather than the code, and deleting the line
   * from `agent-loop.js` left it green.
   */
  const l = loop();
  noteUserStop.call(l);
  assert.ok(l._userStoppedAt, 'recorded');
  l._userStoppedAt = null;
  await late(l);
  assert.equal(summarizeErrors(l.workspace).total, 1, 'loud again');
});

test('and a new turn is what clears it', () => {
  /*
   * Source, because reaching this line means driving a real `handleUserMessage`
   * — context manager, prompt builder, session store and a browser on the end
   * of it — to observe one field being nulled. A stop an hour ago must not
   * quietly demote a genuine late reply in the turn happening now.
   *
   * Asserted *before* the compaction check, because that path can return early
   * and a clear placed after it would work in the common case and leave the
   * flag set for exactly the long session where it has had time to go stale.
   */
  const src = readFileSync(
    join(fileURLToPath(new URL('../../src/core/agent-loop.js', import.meta.url))), 'utf8',
  );
  const head = src.slice(
    src.indexOf('async handleUserMessage(content, callbacks) {'),
    src.indexOf('needsCompaction(this.contextTokens'),
  );
  assert.match(head, /this\._userStoppedAt = null;/,
    'a new turn no longer clears the stop, so it explains replies it had nothing to do with');
});

test('one stopped turn can strand more than one reply', async () => {
  // So the flag is not consumed by the first of them. A main lane's reply and a
  // subagent's both belong to the turn that was stopped.
  const l = loop();
  noteUserStop.call(l);
  await late(l);
  l._userStoppedAt = l._userStoppedAt; // unchanged by the read
  await handleGeminiResponse.call(l, 'm2', { content: 'another late reply', complete: true });

  const s = summarizeErrors(l.workspace);
  assert.equal(s.total, 0, 'neither is a failure');
  assert.equal(s.notices.count, 2);
});

test(':stop tells the loop, and does it before the abort', () => {
  /*
   * A source assertion. `abortExtensionWork` is deliberately *not* the hook —
   * it also runs for injection errors, prompt-build exceptions and stalls, all
   * of which are cases where a late reply is worth reading about — so the call
   * has to be its own line in the one handler that knows a key was pressed.
   * Observing it needs a live turn under the pty harness; moving or dropping
   * the line reads as tidying in a diff.
   */
  const app = readFileSync(
    join(fileURLToPath(new URL('../../src/ui/App.jsx', import.meta.url))), 'utf8',
  );
  const stop = app.slice(app.indexOf("cleanQuery === ':stop'"), app.indexOf('🛑 Agent forcefully stopped.'));
  assert.match(stop, /agentLoop\.noteUserStop\(\)/, ':stop no longer records that you stopped it');
  assert.ok(
    stop.indexOf('noteUserStop') < stop.indexOf('abortExtensionWork'),
    'recorded after the abort, which is the order that loses the reason',
  );
});
