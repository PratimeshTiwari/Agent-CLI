/**
 * A provider error is re-asked with the prompt that failed, after a wait.
 *
 * It used to be re-asked at once, with a prompt rebuilt from the user's
 * original question. After a tool round that threw away the `<tool_results>`
 * the model had asked for — it was sent back to the start of the task — and
 * the immediate retry asked a struggling service again inside the same second:
 * on 2026-09-22 the identical error came back six seconds later.
 *
 * The prompt builder here answers with a marker, so a regression to rebuilding
 * is visible as that marker on the wire rather than as a crash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { MAX_PROVIDER_RETRIES } from '../../src/core/reply-recovery.js';

const PROVIDER = 'Sorry, something went wrong. Please try your request again.';
const TOOL_ROUND = '<tool_results>\n[read_file] the file the model asked for\n</tool_results>\nContinue.';

function loop() {
  const dir = mkdtempSync(join(tmpdir(), 'provider-retry-'));
  const l = new AgentLoop({
    workspace: dir,
    mcpServer: {},
    promptBuilder: { buildPrompt: () => 'REBUILT FROM THE OBJECTIVE', noteDrift() {} },
    diffEngine: {},
    riskClassifier: {},
  });
  const sent = [];
  const panel = [];
  l.callbacks = { sendToPanel: (m) => panel.push(m), injectPrompt: (p) => sent.push(p) };
  l.isProcessing = true;
  l.currentObjective = 'what does the parser do?';
  l._lastMainPrompt = TOOL_ROUND;
  return { l, sent, panel };
}

const reply = (content) => ({ content, complete: true });

test('the failed prompt is resent verbatim, not rebuilt from the objective', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, sent } = loop();
  await l.handleGeminiResponse('m1', reply(PROVIDER));
  t.mock.timers.tick(10_000);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].prompt, TOOL_ROUND, 'the tool results are what the model was answering');
  assert.notEqual(sent[0].prompt, 'REBUILT FROM THE OBJECTIVE');
  assert.equal(l.isProcessing, true, 'the turn is still alive');
});

test('it waits before re-asking', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, sent, panel } = loop();
  await l.handleGeminiResponse('m1', reply(PROVIDER));

  t.mock.timers.tick(2300); // below the shortest jittered first wait (2400)
  assert.equal(sent.length, 0, 'an immediate retry asks the same struggling service');
  t.mock.timers.tick(1400); // past the longest (3600)
  assert.equal(sent.length, 1);
  assert.ok(panel.some((m) => /retrying in \ds/.test(m.payload?.message || '')), 'the wait is said out loud');
});

test('stopping during the wait cancels the retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, sent } = loop();
  await l.handleGeminiResponse('m1', reply(PROVIDER));

  // What `:stop` and esc do, in this order (App.jsx).
  l.isProcessing = false;
  l.noteUserStop();
  l.abortExtensionWork();
  t.mock.timers.tick(10_000);

  assert.equal(sent.length, 0, 'a stopped turn must not come back to life');
});

test('a new user turn cancels a retry left over from the last one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l } = loop();
  await l.handleGeminiResponse('m1', reply(PROVIDER));
  assert.ok(l._retryTimer, 'control: a retry is pending');
  l._cancelScheduledRetry(); // what handleUserMessage does on entry
  assert.equal(l._retryTimer, null);
});

test('an inlined image is not uploaded a second time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, sent } = loop();
  l._lastMainPrompt = 'look at this\n<image_data>\ndata:image/png;base64,AAAA\n</image_data>';
  await l.handleGeminiResponse('m1', reply(PROVIDER));
  t.mock.timers.tick(10_000);

  assert.equal(sent.length, 1);
  assert.ok(!sent[0].prompt.includes('base64,AAAA'), 'the tab took the upload before it errored');
  assert.ok(sent[0].prompt.includes('look at this'), 'the text still goes');
});

test(`after ${MAX_PROVIDER_RETRIES} retries the error is shown, not re-asked`, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, sent, panel } = loop();
  l.sessionStore = { appendTurn() {} };
  l._sendTaskList = () => {};
  for (let i = 0; i < MAX_PROVIDER_RETRIES; i++) {
    await l.handleGeminiResponse(`m${i}`, reply(PROVIDER));
    t.mock.timers.tick(10_000);
  }
  assert.equal(sent.length, MAX_PROVIDER_RETRIES);

  await l.handleGeminiResponse('last', reply(PROVIDER));
  t.mock.timers.tick(10_000);
  assert.equal(sent.length, MAX_PROVIDER_RETRIES, 'no third retry');
  assert.ok(panel.some((m) => m.type === 'agent_response' && m.payload?.content === PROVIDER),
    'the error text reaches the person');
});

test('an ordinary answer is not retried — the control', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l, sent } = loop();
  l.sessionStore = { appendTurn() {} };
  l._sendTaskList = () => {};
  l._finishTurn = () => { l.isProcessing = false; };
  await l.handleGeminiResponse('m1', reply('The parser reads fenced JSON blocks out of the reply.'));
  t.mock.timers.tick(10_000);
  assert.equal(sent.length, 0);
});
