/**
 * The loop writes its round count when a turn ends.
 *
 * `tool-usage.test.js` proves the logger can store rounds; this proves the
 * loop actually hands them over. The logger alone would pass with a caller
 * that never passed the number — the shape of `find_symbol` shipping broken
 * beside 1,474 green tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../src/backend/core/turn/agent-loop.js';
import { summariseToolUsage } from '../../../src/backend/core/logs/tool-usage.js';

test('a finished turn records how many tool rounds it took', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rounds-'));
  const l = new AgentLoop({ workspace: dir, mcpServer: {}, promptBuilder: {}, diffEngine: {}, riskClassifier: {} });
  l.callbacks = { sendToPanel() {} };
  l.isProcessing = true;
  l._auditHandover = () => {};
  l.requestModelOptions = () => {};
  l._turnEvidence = new Map([['read_file', 2], ['grep_search', 1]]);
  l._roundsThisTurn = 3;

  l._finishTurn('done', { isFirstReply: false, premature: false });

  assert.deepEqual(summariseToolUsage(dir).rounds, { samples: 1, median: 3, p90: 3 });
  assert.equal(l.isProcessing, false);
});
