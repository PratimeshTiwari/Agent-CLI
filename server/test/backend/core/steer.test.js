/**
 * Steering: a message typed during a turn, sent into it with ctrl+x ctrl+s.
 *
 * Queueing is the default; a steer rides with the next tool-results prompt as
 * `<user_steer>`, and one the turn ends without delivering becomes the next
 * message. Driven through a real loop, prompt builder and tool server, so the
 * prompt asserted on is the one that would be typed into Gemini.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentLoop } from '../../../src/backend/core/turn/agent-loop.js';
import { PromptBuilder } from '../../../src/backend/core/prompt/prompt-builder.js';
import { MCPServer } from '../../../src/backend/mcp/mcp-server.js';
import { DiffEngine } from '../../../src/backend/core/edits/diff-engine.js';
import { RiskClassifier } from '../../../src/backend/core/commands/risk-classifier.js';
import { chordGate, extractHotkeys, STEER_WINDOW_MS } from '../../../src/frontend/input/hotkeys.js';
import { parseTurnActions } from '../../../src/frontend/transcript/transcript.js';
import { buildAgentCallbacks } from '../../../src/frontend/hooks/use-agent-callbacks.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../src');

function realLoop() {
  const dir = mkdtempSync(join(tmpdir(), 'steer-'));
  writeFileSync(join(dir, 'notes.md'), '# notes\n');
  const diffEngine = new DiffEngine(dir);
  const l = new AgentLoop({
    workspace: dir,
    mcpServer: new MCPServer(dir, diffEngine),
    promptBuilder: new PromptBuilder(dir, SRC),
    diffEngine,
    riskClassifier: new RiskClassifier(dir),
  });
  const sent = [];
  const panel = [];
  l.mode = 'auto';
  l.callbacks = { sendToPanel: (m) => panel.push(m), injectPrompt: (p) => sent.push(p) };
  l.isProcessing = true;
  return { l, sent, panel };
}

const TOOL_ROUND = 'Looking.\n```json\n{"name": "list_directory", "args": {"path": "."}}\n```';
const lastPrompt = (sent) => {
  const p = sent.at(-1);
  return typeof p === 'string' ? p : p?.prompt ?? JSON.stringify(p);
};

test('a steer rides with the next tool results, once, and is on the record', async () => {
  const { l, sent, panel } = realLoop();
  assert.equal(l.steer('actually, only look at notes.md'), true);

  await l.handleGeminiResponse('m1', { content: TOOL_ROUND, complete: true });
  const prompt = lastPrompt(sent);
  assert.match(prompt, /<user_steer>\nactually, only look at notes\.md\n<\/user_steer>/);
  assert.ok(prompt.indexOf('<user_steer>') > prompt.indexOf('</tool_results>'), 'after the results, near the instruction');
  assert.ok(panel.some((m) => m.type === 'steer_delivered'), 'the screen is told it went in');
  assert.ok(l.conversationHistory.some((t) => t.type === 'steer' && /only look at notes/.test(t.content)));
  assert.deepEqual(l.takeSteers(), [], 'delivered means gone — it is not sent twice');

  // Control: the next round, with nothing steered, carries no block.
  await l.handleGeminiResponse('m2', { content: TOOL_ROUND, complete: true });
  assert.doesNotMatch(lastPrompt(sent), /<user_steer>/);
});

test('no turn, no steer — the caller sends it as a message instead', () => {
  const { l } = realLoop();
  l.isProcessing = false;
  assert.equal(l.steer('hello'), false);
  l.isProcessing = true;
  assert.equal(l.steer('   '), false, 'nothing to say is not a steer');
});

test('undelivered steers are handed back once; an explicit stop drops them', () => {
  const { l } = realLoop();
  l.steer('one'); l.steer('two');
  assert.deepEqual(l.takeSteers(), ['one', 'two']);
  assert.deepEqual(l.takeSteers(), []);
  l.steer('three');
  l.noteUserStop();
  assert.deepEqual(l.takeSteers(), [], 'stopping means stopping');
});

test('without a steer the tool-results prompt is byte-identical to before', () => {
  const pb = new PromptBuilder(mkdtempSync(join(tmpdir(), 'steer-pb-')), SRC);
  const results = [{ name: 'list_directory', result: { children: [] } }];
  assert.equal(pb.buildToolResultBatch(results, '', '', '', ''), pb.buildToolResultBatch(results));
});

test('ctrl+x then ctrl+s inside the window completes the chord; anything else does not', () => {
  const gate = chordGate(STEER_WINDOW_MS);
  assert.equal(gate.fire(1000), false, 'ctrl+s alone');
  gate.arm(1000);
  assert.equal(gate.fire(1000 + STEER_WINDOW_MS), true);
  assert.equal(gate.fire(1000 + STEER_WINDOW_MS + 1), false, 'disarmed after firing');
  gate.arm(5000);
  assert.equal(gate.fire(5000 + STEER_WINDOW_MS + 1), false, 'too late');
});

test('both keys are taken off stdin, so neither types a letter into the prompt', () => {
  const out = extractHotkeys('ab\x18\x13c');
  assert.equal(out.text, 'abc');
  assert.deepEqual(out.events ?? out.hotkeys ?? out.names, ['steer-arm', 'steer']);
});

test('a delivered steer is drawn in the turn, and clears the waiting row', () => {
  const turn = { id: 't', userMsg: { role: 'user', content: 'go' }, steps: [{ role: 'system', type: 'steer', content: 'skip the tests' }] };
  const { items } = parseTurnActions(turn);
  assert.ok(items.some((a) => a.type === 'steer' && a.content === 'skip the tests'));

  let steered = ['skip the tests'];
  const noop = () => {};
  const cb = buildAgentCallbacks({
    agentLoop: { isProcessing: true, conversationHistory: [], historyOffset: 0 },
    isToolRunningRef: { current: false },
    setActiveMenu: noop, setActiveToolCalls: noop, setDiffRequest: noop, setFocus: noop, setHistory: noop,
    setInputAtEnd: noop, setIsProcessing: noop, setPlanReviewReady: noop, setStatus: noop, setWalkthroughReady: noop,
    setSteered: (v) => { steered = v; },
    wsServer: { broadcast: () => true },
  });
  cb.sendToPanel({ type: 'steer_delivered', payload: { count: 1 } });
  assert.deepEqual(steered, []);
});
