/**
 * A reply that wrote into Gemini's Canvas is asked once for a file (v9.9.4).
 *
 * The Canvas is an iframe the scrape cannot read; the bridge leaves a marker
 * where its chip was, and without this the turn ended on "I've generated the
 * design document" with nothing on disk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentLoop } from '../../../src/backend/core/turn/agent-loop.js';
import { PromptBuilder } from '../../../src/backend/core/prompt/prompt-builder.js';
import { canvasTitles } from '../../../src/backend/core/turn/drift-detector.js';

function loop(version = 'v1') {
  const workspace = mkdtempSync(join(tmpdir(), 'canvas-'));
  const promptBuilder = new PromptBuilder(workspace, workspace);
  const l = new AgentLoop({ workspace, mcpServer: {}, diffEngine: {}, riskClassifier: {}, promptBuilder });
  promptBuilder.promptVersion = version;
  const sent = [];
  const panel = [];
  l._enqueueExtensionRequest = (p) => sent.push(p.prompt);
  l._releaseExtension = () => {};
  l.callbacks = { sendToPanel: (m) => panel.push(m), injectPrompt() {} };
  l.sessionStore = { appendTurn() {}, saveHistory() {} };
  l.requestModelOptions = () => {};
  l.isProcessing = true;
  l._canvasNudged = false;
  l._promiseNudged = false;
  l._turnEvidence = new Map();
  return { l, sent, panel };
}

const MARKER = `[Gemini Canvas: "Fruit Stand Design Document" — written in Gemini's Canvas, not in this reply]`;
const REPLY = `I will now generate the design document.\n\n${MARKER}\n\nI've generated a styled design document.`;

test('the marker is read back by title', () => {
  assert.deepEqual(canvasTitles(REPLY), ['Fruit Stand Design Document']);
  assert.deepEqual(canvasTitles('Gemini Canvas is a feature.'), []);
});

test('the bridge writes exactly what the server matches', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const bridge = readFileSync(join(here, '../../../../extension/content-scripts/gemini-bridge.js'), 'utf8');
  const body = bridge.match(/function canvasMarker\(title\) \{\n\s*return `(.*)`;/)[1];
  const written = body.replace('${String(title).replace(/"/g, "\'")}', 'T');
  assert.deepEqual(canvasTitles(written), ['T']);
});

for (const version of ['v1', 'v3']) {
  test(`${version}: a Canvas with no call is asked once for a file`, async () => {
    const { l, sent, panel } = loop(version);
    await l.handleGeminiResponse('m', { content: REPLY, complete: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0], /cannot read the Canvas/);
    assert.match(sent[0], /create_file/);
    assert.equal(l.isProcessing, true, 'the turn goes on');
    assert.equal(panel.find((m) => m.type === 'agent_response').payload.continuing, true);
    assert.ok(panel.some((m) => m.type === 'status' && /Canvas · asked for a file/.test(m.payload.message)));

    // A second Canvas in the same turn ends it.
    await l.handleGeminiResponse('m', { content: REPLY, complete: true });
    assert.equal(sent.length, 1);
    assert.equal(l.isProcessing, false);
  });
}

test('a reply with no Canvas ends the turn (control)', async () => {
  const { l, sent } = loop();
  await l.handleGeminiResponse('m', { content: 'The document is written.', complete: true });
  assert.equal(sent.length, 0);
  assert.equal(l.isProcessing, false);
});
