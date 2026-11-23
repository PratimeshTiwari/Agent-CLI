/**
 * The terminal's prompt is held while the extension is away (v9.9.9.3).
 *
 * Reported 2026-11-23: "changing workspace also restarts the agent and the
 * older tab is not closed". After the restart the extension is a few seconds
 * from reconnecting; the terminal's `injectPrompt` broadcast on its own and,
 * finding nobody, ran `open https://gemini.google.com/app` — a second tab the
 * extension does not own, beside the agent's — and handed the prompt back.
 * Reproduced in `tabrig/` before the fix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAgentCallbacks } from '../../../src/frontend/hooks/use-agent-callbacks.js';
import { WebSocketServer } from '../../../src/backend/bridge/websocket-server.js';

function setup() {
  const history = [];
  const wsServer = new WebSocketServer({ port: 0, agentLoop: { setBackgroundCallbacks() {} } });
  const sent = [];
  wsServer._send = (_ws, m) => sent.push(m);
  const noop = () => {};
  const callbacks = buildAgentCallbacks({
    agentLoop: { conversationHistory: [], isProcessing: true },
    isToolRunningRef: { current: false },
    setActiveMenu: noop, setActiveToolCalls: noop, setDiffRequest: noop, setFocus: noop,
    setHistory: (f) => history.splice(0, history.length, ...f(history)),
    setInputAtEnd: noop, setIsProcessing: noop, setPlanReviewReady: noop, setStatus: noop,
    setWalkthroughReady: noop, setSteered: noop, streamRef: { current: null }, wsServer,
  });
  return { callbacks, wsServer, sent, history };
}

test('no extension yet: the prompt is held and sent when it connects, nothing opened', () => {
  const { callbacks, wsServer, sent, history } = setup();
  callbacks.injectPrompt({ prompt: 'hello', expectResponse: true });
  assert.equal(sent.length, 0);
  assert.equal(wsServer.pendingInjects.length, 1, 'held, not dropped');
  assert.match(history.at(-1).content, /Waiting for the Chrome extension/);
  assert.doesNotMatch(history.at(-1).content, /in your browser/);

  wsServer.clients.set('ext', { type: 'extension', ws: {} });
  assert.equal(wsServer.hasExtension(), true);
  assert.equal(wsServer.flushPendingInjects(), 1);
  assert.equal(sent[0].type, 'inject_prompt');
  assert.equal(sent[0].payload.prompt, 'hello');
});

test('with the extension connected it goes at once, and says nothing', () => {
  const { callbacks, wsServer, sent, history } = setup();
  wsServer.clients.set('ext', { type: 'extension', ws: {} });
  callbacks.injectPrompt({ prompt: 'hi' });
  assert.equal(sent.length, 1);
  assert.equal(history.length, 0);
});

test('the terminal never opens a Gemini tab through the OS', () => {
  const src = readFileSync(new URL('../../../src/frontend/hooks/use-agent-callbacks.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /exec\(`open "\$\{startUrl\}"`\)|xdg-open/);
});
