/**
 * `/copy` puts the last reply on the clipboard as the markdown the agent wrote.
 *
 * Only the choice of text is tested here: driving the real clipboard would
 * overwrite whatever the person running the tests had copied (see
 * `clipboard.js`, `writeThrough`). The command itself is driven by the slash
 * smoke sweep.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lastReply } from '../../src/ui/format.js';
import { handleSlashCommand } from '../../src/ui/hooks/use-slash-commands.js';

test('the newest agent reply, skipping tool rows, notices and the user', () => {
  const history = [
    { role: 'user', content: 'explain the parser' },
    { role: 'agent', content: '**The parser** reads `tokens`.\n\n- one\n- two' },
    { role: 'system', type: 'tool_call', toolName: 'read_file' },
    { role: 'assistant', isLocal: true, content: '🎨 Theme: Dark' },
    { role: 'user', content: 'thanks' },
  ];
  assert.equal(lastReply(history), '**The parser** reads `tokens`.\n\n- one\n- two', 'markdown, not the rendered rows');
});

test('a reply that failed to parse, or is empty, is not an answer', () => {
  const history = [
    { role: 'agent', content: 'the real answer' },
    { role: 'agent', content: '```json\n{"name": broken', parseError: 'Unexpected token' },
    { role: 'agent', content: '   ' },
  ];
  assert.equal(lastReply(history), 'the real answer');
  assert.equal(lastReply([]), null);
  assert.equal(lastReply(undefined), null);
});

test('with nothing to copy it says so, and never touches the clipboard', async () => {
  const rows = [];
  await handleSlashCommand('/copy', {
    agentLoop: { conversationHistory: [{ role: 'user', content: 'hi' }], commandRules: {} },
    wsServer: { clients: new Set() },
    resetScreen() {}, setActiveMenu() {}, setIsProcessing() {}, setPendingImage() {},
    setHistory: (f) => rows.push(...f([])),
  });
  assert.equal(rows.at(-1).content, '📋 No reply to copy yet.');
  assert.equal(rows.at(-2).content, '/copy', 'the command is echoed above its answer, as /theme does');
});
