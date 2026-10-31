/**
 * What the bridge does with each message type it is sent.
 *
 * `websocket-server.js` sat at **53% line coverage** while being the transport
 * every turn crosses — and it was edited four times in the week this file was
 * written, once to fix a message type that had been silently dropped for the
 * life of a feature. That is the combination CLAUDE.md flags twice already:
 * `diff-engine.js` was 358 untested lines that wrote files, and `migrate.js`
 * was at 46% while moving the user's data on startup.
 *
 * The dispatch switch is the testable half and it needs no socket at all:
 * `_handleMessage` takes a client id and a message, and the collaborators it
 * reaches are all on `agentLoop`. `picker-errors.test.js` established the
 * pattern; this covers the rest of the arms.
 *
 * Each test asserts the *routing* — that a type reaches the right collaborator
 * with the right argument — rather than what that collaborator then does, which
 * is its own suite's business. A message arriving at the wrong handler, or at
 * none, is the failure this file exists for.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from '../../src/bridge/websocket-server.js';
import { resolveEffort } from '../../src/core/effort.js';
import { _setExpectedExtensionVersion } from '../../src/core/extension-version.js';

/** A loop that records what it was asked to do, and nothing else. */
function fakeLoop(extra = {}) {
  return {
    workspace: mkdtempSync(join(tmpdir(), 'dispatch-')),
    modelConfig: { effort: 'high' },
    calls: [],
    isProcessing: false,
    callbacks: null,
    setBackgroundCallbacks() {},
    handleGeminiResponse(...a) { this.calls.push(['handleGeminiResponse', ...a]); },
    noteModelOptions(...a) { this.calls.push(['noteModelOptions', ...a]); },
    abortExtensionWork() { this.calls.push(['abortExtensionWork']); },
    settleModelOptions(...a) { this.calls.push(['settleModelOptions', ...a]); },
    ...extra,
  };
}

/** Deliver one message, with no socket involved. */
async function deliver(loop, message, clientType = 'extension') {
  const bridge = new WebSocketServer({ port: 0, agentLoop: loop });
  bridge.clients.set('c1', { type: clientType, ws: { readyState: 0 } });
  await bridge._handleMessage('c1', { id: 'm1', ...message });
  return bridge;
}

test('a scraped reply goes to the loop, with its message id', async () => {
  const loop = fakeLoop();
  await deliver(loop, { type: 'gemini_response', payload: { content: 'hi', complete: true } });

  const call = loop.calls.find((c) => c[0] === 'handleGeminiResponse');
  assert.ok(call, 'a completed turn never reached the agent');
  assert.equal(call[1], 'm1', 'the reply was not matched to the request that asked for it');
  assert.equal(call[2].content, 'hi');
});

test('a model list goes to the loop, switchedTo and requested included', async () => {
  const loop = fakeLoop();
  await deliver(loop, {
    type: 'model_options',
    payload: { models: [{ label: '3.1 Pro', selected: true }], switchedTo: '3.1 Pro', requested: '3.1 Pro' },
  });

  const call = loop.calls.find((c) => c[0] === 'noteModelOptions');
  assert.ok(call, 'the picker answered and the bridge dropped it');
  assert.equal(call[1][0].label, '3.1 Pro');
  assert.equal(call[2], '3.1 Pro', 'switchedTo is what makes a confirmation an observation');
  assert.equal(call[3], '3.1 Pro');
});

/*
 * Streaming is forwarded only while a turn owns the callbacks. Outside one
 * there is no live region to draw into, and CLAUDE.md records that re-rendering
 * the transcript at streaming speed is what used to tear the terminal.
 */
test('streamed text is forwarded to the live turn', async () => {
  const sent = [];
  const loop = fakeLoop({ callbacks: { sendToPanel: (m) => sent.push(m) } });
  await deliver(loop, { type: 'gemini_response_stream', payload: { content: 'partial' } });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'response_stream', 'it was forwarded under the wrong type');
  assert.equal(sent[0].payload.content, 'partial');
});

test('and dropped when no turn is listening, rather than throwing', async () => {
  const loop = fakeLoop({ callbacks: null });
  await assert.doesNotReject(
    deliver(loop, { type: 'gemini_response_stream', payload: { content: 'partial' } }),
  );
});

/*
 * The rung is attached here because the tab cannot know it: it was handed a
 * prompt, not the profile that built one. A trace without it cannot answer
 * "did pro get slower", which is the question the log exists for.
 */
test('a turn trace is written with the rung the server knows', async () => {
  const loop = fakeLoop();
  await deliver(loop, {
    type: 'turn_trace',
    payload: { model: 'gemini', stages: { find_input: 1, type: 2, send: 3 } },
  });

  const file = join(loop.workspace, '.agent', 'logs', 'traces.jsonl');
  assert.ok(existsSync(file), 'the trace was not written anywhere');
  const row = JSON.parse(readFileSync(file, 'utf8').trim().split('\n').pop());
  // Compared against the ladder rather than a literal: the rung *names* have
  // been renamed twice, and a test that hardcodes one is testing the
  // vocabulary instead of the wiring it was written for.
  assert.equal(row.effort, resolveEffort(loop.modelConfig.effort).id,
    'the trace cannot say which profile produced it');
  assert.equal(row.stages.send, 3);
});

/*
 * An unknown type is logged rather than ignored. The worker learned this the
 * expensive way — `model_options` had no relay case there and vanished for the
 * life of the picker feature — and this is the same surface on the other side
 * of the socket.
 */
test('an unknown type is written down, not swallowed', async () => {
  const loop = fakeLoop();
  await deliver(loop, { type: 'something_new', payload: {} });

  const file = join(loop.workspace, '.agent', 'logs', 'errors.jsonl');
  assert.ok(existsSync(file), 'an unknown message type left no trace at all');
  const row = JSON.parse(readFileSync(file, 'utf8').trim().split('\n').pop());
  assert.equal(row.op, 'unknown_message');
  assert.match(row.message, /something_new/, 'it does not say which type was unknown');
});

/*
 * Identify is what makes a socket an extension rather than "some client", and
 * several things hang off that: held prompts are flushed, the version is
 * compared, and `broadcast('extension', …)` only reaches clients typed here.
 */
test('identify types the client, which is what broadcast selects on', async () => {
  const loop = fakeLoop();
  const bridge = new WebSocketServer({ port: 0, agentLoop: loop });
  bridge.clients.set('c1', { type: 'unknown', ws: { readyState: 0 } });

  await bridge._handleMessage('c1', {
    id: 'm1',
    type: 'identify',
    payload: { clientType: 'extension', version: '1.0.0' },
  });

  assert.equal(bridge.clients.get('c1').type, 'extension');
  assert.equal(bridge.clients.get('c1').extensionVersion, '1.0.0');
});

// A message from a client the bridge has never seen is ignored, not a crash.
// `_handleMessage` is reachable from a socket that closed mid-flight.
test('a message from an unknown client is ignored', async () => {
  const loop = fakeLoop();
  const bridge = new WebSocketServer({ port: 0, agentLoop: loop });
  await assert.doesNotReject(
    bridge._handleMessage('nobody', { id: 'm1', type: 'gemini_response', payload: {} }),
  );
  assert.deepEqual(loop.calls, [], 'it acted on a message from a client that is gone');
});

/*
 * `tab_status` is the extension saying which models it currently has tabs for.
 * Stored on the client rather than the loop, because it describes *that
 * connection* — a second extension, or a reconnect, has its own answer.
 */
test('tab status is remembered against the client that reported it', async () => {
  const loop = fakeLoop();
  const bridge = await deliver(loop, {
    type: 'tab_status',
    payload: { connectedModels: ['gemini'] },
  });

  assert.deepEqual(bridge.clients.get('c1').reportedModels, ['gemini']);
});

test('an empty report does not erase what was known', async () => {
  const loop = fakeLoop();
  const bridge = new WebSocketServer({ port: 0, agentLoop: loop });
  bridge.clients.set('c1', { type: 'extension', ws: { readyState: 0 }, reportedModels: ['gemini'] });

  await bridge._handleMessage('c1', { id: 'm1', type: 'tab_status', payload: { connectedModels: [] } });

  // A worker that has just been revived reports nothing before it has looked.
  // Treating that as "no tabs" would flap the status on every eviction.
  assert.deepEqual(bridge.clients.get('c1').reportedModels, ['gemini'],
    'an empty report overwrote a known-good one');
});

// v8.1: "this should be a clickable link". A chrome:// link opens nothing from
// a terminal, so a build that can reload itself is asked to, between turns.
test('an older build since 1.58.0 is asked to reload once, and never mid-turn', async () => {
  _setExpectedExtensionVersion('1.59.0');
  try {
    const identify = async (bridge, version) => {
      const sent = [];
      bridge.clients.set('c1', { type: 'unknown', ws: { readyState: 1, send: (m) => sent.push(JSON.parse(m)) } });
      bridge._send = (ws, m) => sent.push(m);
      await bridge._handleMessage('c1', { id: 'm1', type: 'identify', payload: { clientType: 'extension', version } });
      return sent.map((m) => (m.type === 'status' ? `status:${m.payload.message}` : m.type));
    };
    const notes = [];
    const loop = fakeLoop({ _notify: (m) => notes.push(m) });
    const bridge = new WebSocketServer({ port: 0, agentLoop: loop });

    assert.ok((await identify(bridge, '1.58.0')).includes('reload_extension'));
    assert.deepEqual(notes, ['↻ Extension updated · 1.58.0 → 1.59.0']);
    // The same build back again: the reload did not take, so say how to do it.
    const again = await identify(bridge, '1.58.0');
    assert.ok(!again.includes('reload_extension'));
    assert.ok(again.some((m) => /reload at chrome:\/\/extensions/.test(m)));

    const busy = new WebSocketServer({ port: 0, agentLoop: fakeLoop({ isProcessing: true, _notify() {} }) });
    assert.ok(!(await identify(busy, '1.58.0')).includes('reload_extension'), 'a reload mid-turn orphans the tab');

    const old = new WebSocketServer({ port: 0, agentLoop: fakeLoop({ _notify() {} }) });
    assert.ok(!(await identify(old, '1.57.0')).includes('reload_extension'), '1.57.0 has no handler');
  } finally {
    _setExpectedExtensionVersion(undefined);
  }
});

// v8.1: a delegated read lost its tab and the user's turn, in another tab,
// ended with "Communication with the Gemini tab failed".
test("a subagent's tab failing settles that request, and leaves the user's turn running", async () => {
  const settled = [];
  const loop = fakeLoop({
    isProcessing: true,
    noteUndelivered() { this.calls.push(['noteUndelivered']); },
    resolveSubagent(id, outcome) { settled.push([id, outcome]); return true; },
  });
  await deliver(loop, { type: 'error', payload: { op: 'tab_unreachable', isSubagent: true, requestId: 'r1', detail: 'No tab with id: 5.' } });
  assert.deepEqual(settled, [['r1', { success: false, error: 'No tab with id: 5.' }]]);
  assert.equal(loop.isProcessing, true);
  assert.deepEqual(loop.calls, [], 'not aborted, not carried as undelivered');

  // Control: the main lane's own failure still ends the turn.
  const main = fakeLoop({ isProcessing: true, noteUndelivered() { this.calls.push(['noteUndelivered']); }, resolveSubagent() {} });
  await deliver(main, { type: 'error', payload: { op: 'tab_unreachable', detail: 'x' } });
  assert.equal(main.isProcessing, false);
  assert.ok(main.calls.some(([c]) => c === 'abortExtensionWork'));
});

test('a session tab outlives its turn: the worker asks its own map, not the reply', () => {
  const src = readFileSync(new URL('../../../extension/src/background/main.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!isSessionTab\(sender\.tab\.id\)\) \{\s*\n\s*forgetTab\(sender\.tab\.id\);\s*\n\s*chrome\.tabs\.remove/);
  const content = readFileSync(new URL('../../../extension/src/background/content.js', import.meta.url), 'utf8');
  assert.match(content, /\.\.\.\(payload\.isSubagent \? \{ isSubagent: true, requestId: payload\.requestId \} : \{\}\)/);
});

// v8.1, owner: "the agent should check whether it is continuing on the same
// chat … if it fails, show a warning and tell the user to switch manually".
test('a chat the tab could not return to: the turn ends, the message is carried, and the way out is named', async () => {
  const shown = [];
  const loop = fakeLoop({
    isProcessing: true,
    noteUndelivered() { this.calls.push(['noteUndelivered']); },
    callbacks: { sendToPanel: (m) => shown.push(m) },
  });
  await deliver(loop, { type: 'error', payload: { op: 'chat_unreachable', wanted: 'aaa111', landed: 'bbb222' } });
  assert.equal(loop.isProcessing, false);
  assert.ok(loop.calls.some(([c]) => c === 'noteUndelivered'), 'carried into the next message');
  const text = shown.at(-1).payload.message;
  assert.match(text, /^Not sent · the tab could not get back to this session's chat aaa111\n/);
  assert.match(text, /\/chat <link or id>.*\/new/);
});
