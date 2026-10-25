/**
 * An answered `ask_question`, drawn the way Claude Code draws one.
 *
 * It used to be two half-rows: `⏺ ask_question · User answered: Postgres` from
 * the loop's record, and a `[System: You answered: Postgres]` row the screen
 * added on its own — which a reprint or a resume never had. Neither showed the
 * question. Now the result turn carries the pairs and one block draws them.
 *
 * The record half is tested through `_executeToolCalls` with the real
 * `ask_question` dispatch, because a field that is set on the resolve and never
 * copied onto the result turn is exactly the write-only trap this repo keeps
 * finding: the answer would be drawn live and gone after a reprint.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { questionRows } from '../../src/ui/format.js';
import { AgentLoop } from '../../src/core/agent-loop.js';

describe('questionRows', () => {
  test('pairs from the result turn: one row per question, question then answer', () => {
    const out = questionRows({}, 'ignored', {
      answers: [
        { question: 'Which database?', answer: 'Postgres' },
        { question: 'Keep the old table?', answer: 'No' },
      ],
    });
    assert.equal(out.head, "User answered the agent's questions:");
    assert.deepEqual(out.rows, ['· Which database? → Postgres', '· Keep the old table? → No']);
  });

  test('one question reads singular', () => {
    const out = questionRows({}, '', { answers: [{ question: 'Which?', answer: 'A' }] });
    assert.equal(out.head, "User answered the agent's question:");
    assert.deepEqual(out.rows, ['· Which? → A']);
  });

  test('declined says so, with no rows', () => {
    assert.deepEqual(questionRows({}, 'x', { declined: true }),
      { head: 'User declined to answer', rows: [] });
  });

  // Older history: no `answers`, only what the model was sent.
  test('old single-answer history recovers the question from the call', () => {
    const out = questionRows({ question: 'Which database?' }, 'User answered: Postgres', {});
    assert.deepEqual(out.rows, ['· Which database? → Postgres']);
  });

  test('old batch history recovers each pair from the result', () => {
    const result = 'The user answered all of your questions:\n1. Which?\n   → A\n2. Why?\n   → B';
    assert.deepEqual(questionRows({}, result, {}).rows, ['· Which? → A', '· Why? → B']);
  });

  test('old dismissed history reads as declined', () => {
    const result = 'The user dismissed the question without answering. Do not ask it again.';
    assert.equal(questionRows({}, result, {}).head, 'User declined to answer');
  });

  // The control: a call with no question text must not name the placeholder
  // `normalizeQuestion` invents for it.
  test('a call with no question text shows the answer alone', () => {
    assert.deepEqual(questionRows({}, 'User answered: yes', {}).rows, ['· yes']);
  });

  test('a long question stays one row (the screen truncates it, never wraps)', () => {
    const long = 'word '.repeat(60);
    const [row] = questionRows({}, '', { answers: [{ question: long, answer: 'ok' }] }).rows;
    assert.ok(!row.includes('\n'));
  });
});

describe('the answers reach the record', () => {
  function loop() {
    const dir = mkdtempSync(join(tmpdir(), 'question-'));
    mkdirSync(join(dir, '.agent'), { recursive: true });
    const l = Object.create(AgentLoop.prototype);
    Object.assign(l, {
      workspace: dir,
      mode: 'auto',
      modelConfig: { main: 'gemini' },
      conversationHistory: [],
      commandRules: { enabled: false, allow: [], block: [] },
      sessionStore: { appendTurn() {} },
      riskClassifier: { classify: () => ({ level: 'safe', reason: '' }) },
      promptBuilder: { noteMessageSent() {}, buildToolResultBatch: (r) => JSON.stringify(r) },
      callbacks: { sendToPanel() {} },
      _sendToGemini() {},
      _turnEvidence: new Map(),
    });
    return { l, dir };
  }
  const recorded = (l) => l.conversationHistory.find((t) => t.type === 'tool_result');

  test('an answer is recorded as pairs, and the model is sent the same string as before', async () => {
    const { l, dir } = loop();
    const running = l._executeToolCalls([{ name: 'ask_question', args: { question: 'Which?' } }]);
    await new Promise((r) => setImmediate(r));
    l.answerQuestion([{ question: 'Which?', answer: 'A' }]);
    await running;

    const turn = recorded(l);
    assert.deepEqual(turn.answers, [{ question: 'Which?', answer: 'A' }]);
    assert.equal(turn.result, 'User answered: A', 'the model-facing string must not change');
    rmSync(dir, { recursive: true, force: true });
  });

  // The side panel answers with a bare string; the question comes from the ask.
  test('a bare-string answer is paired with the question that was asked', async () => {
    const { l, dir } = loop();
    const running = l._executeToolCalls([{ name: 'ask_question', args: { question: 'Which?' } }]);
    await new Promise((r) => setImmediate(r));
    l.answerQuestion('A');
    await running;

    assert.deepEqual(recorded(l).answers, [{ question: 'Which?', answer: 'A' }]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a dismissal is recorded as declined', async () => {
    const { l, dir } = loop();
    const running = l._executeToolCalls([{ name: 'ask_question', args: { question: 'Which?' } }]);
    await new Promise((r) => setImmediate(r));
    l.cancelQuestion();
    await running;

    const turn = recorded(l);
    assert.equal(turn.declined, true);
    assert.equal(turn.answers, undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  // Negative control: other tools carry neither field.
  test('other tools carry no answers', async () => {
    const { l, dir } = loop();
    l.mcpServer = { executeTool: async () => ({ success: true, result: 'ok' }) };
    await l._executeToolCalls([{ name: 'list_directory', args: { path: '.' } }]);
    const turn = recorded(l);
    assert.equal('answers' in turn, false);
    assert.equal('declined' in turn, false);
    rmSync(dir, { recursive: true, force: true });
  });
});
