/**
 * The model-mismatch warning sits directly above the input, not over the turn.
 *
 * Reported with a screenshot, 2026-10-26: the `⚠ browser is on …` row appeared
 * at the top of the live frame mid-turn, above the turn's own rows, and moved
 * as they grew — "looks odd". It has a fixed slot now: below the turn, the
 * running calls and the diff prompt, immediately before the input bar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../src/ui/App.jsx', import.meta.url), 'utf8');

test('the row is drawn after the in-flight turn and right before the input', () => {
  const row = app.indexOf('{mismatch && (');
  const turn = app.indexOf('liveTurns.map((turn) => (');
  const input = app.indexOf('<InputBar\n');
  assert.ok(row > -1 && turn > -1 && input > -1, 'control: all three are still here');
  assert.ok(row > turn, 'above the turn is where it looked odd');
  assert.ok(row < input);
  assert.doesNotMatch(app.slice(row, input), /<TranscriptTurn|<DiffApproval|runningCalls\.map/,
    'nothing between it and the input, so it never moves');
});

test('it is truncated rows, charged to the budget by height', async () => {
  const row = app.slice(app.indexOf('{mismatch && ('), app.indexOf('<InputBar\n'));
  assert.equal((row.match(/wrap="truncate"/g) || []).length, 2, 'both lines truncate');
  assert.match(app, /const noticeRows = [^;]*mismatchRows\(mismatch, terminalHeight\)/);
  const { mismatchRows, MISMATCH_TWO_LINES_FROM } = await import('../../src/ui/mismatch-row.js');
  assert.equal(mismatchRows(null, 40), 0);
  assert.equal(mismatchRows({}, MISMATCH_TWO_LINES_FROM - 1), 1, 'a short terminal keeps line 1 only');
  assert.equal(mismatchRows({}, MISMATCH_TWO_LINES_FROM), 2);
  // The second line is drawn exactly when it is charged.
  assert.match(row, /mismatchRows\(mismatch, terminalHeight\) === 2 && \(/);
});

test('line 1 names the browser and the agent first, so a narrow terminal keeps them (v7.9)', () => {
  const row = app.slice(app.indexOf('{mismatch && ('), app.indexOf('<InputBar\n'));
  assert.match(row, /'⚠ Model mismatch · browser '\}<Text bold>\{mismatch\.current\}/);
  assert.match(row, /' ≠ agent '\}<Text bold>\{mismatch\.wanted\}/);
});

/*
 * Found by the pty run for this file: the harness config holds the retired
 * word `standard`. The status bar read `effort: high` and the high prompt went
 * out, but the mismatch check said "nothing offered suits standard" and stayed
 * silent — on every config written before the rename.
 */
test('the row is computed from the resolved rung, not the stored word', async () => {
  const { modelMismatch } = await import('../../src/core/model-match.js');
  const { resolveEffort } = await import('../../src/core/effort.js');
  const models = [{ label: '3.1 Flash-Lite' }, { label: '3 Flash', selected: true }, { label: '3.1 Pro' }];
  // Control: the raw retired word is silent — which is the bug, if passed raw.
  assert.equal(modelMismatch('standard', models), null);
  assert.deepEqual(modelMismatch(resolveEffort('standard').id, models), { current: '3 Flash', wanted: '3.1 Pro' });
  const call = app.slice(app.indexOf(': modelMismatch('), app.indexOf(': modelMismatch(') + 80);
  assert.match(call, /modelMismatch\(\s*effortRung\.id,/);
});

/*
 * C0: the prompt follows the tab, so "effort High wants Pro" stopped being the
 * whole story — the Medium prompt is what goes out. The row says so, and keeps
 * the old wording for the case where the setting's prompt still goes (a mode).
 */
test('line 2 says what the next message does', async () => {
  const { mismatchNext } = await import('../../src/ui/mismatch-row.js');
  const base = { current: '3.8 Flash', wanted: '3.1 Pro' };
  assert.equal(mismatchNext({ ...base, policy: 'ask', asks: true }), 'Your next message asks first');
  assert.equal(mismatchNext({ ...base, policy: 'switch', asks: false }), 'Your next message switches the tab to 3.1 Pro first');
  assert.equal(mismatchNext({ ...base, policy: 'follow', asks: false, sentPrompt: 'Medium' }),
    'Sending the Medium prompt, written for 3.8 Flash');
  assert.equal(mismatchNext({ ...base, policy: 'follow', asks: false }), 'Messages go to 3.8 Flash as it is',
    'control: a mode in the tab, where the setting\'s prompt still goes');
  const row = app.slice(app.indexOf('{mismatch && ('), app.indexOf('<InputBar\n'));
  assert.match(row, /sentPrompt: sentRung\.id !== effortRung\.id \? sentRung\.name : null/);
  assert.match(app, /const sentRung = resolveEffort\(agentLoop\._promptEffort\?\.\(\)/);
});

test('the footer keeps its ⚠ at every height, and says "model mismatch"', async () => {
  assert.match(app, /modelMark: browserModelLabel \? \(agentLoop\.effortFallback \? '↓' : modelDiffers \? '⚠' : null\)/);
  assert.match(app, /const mismatch = isCompactHeight\(terminalHeight\) \? null : modelDiffers;/);
  const { statusBarLayout } = await import('../../src/ui/status-bar.js');
  const text = (l) => l.right.map((f) => f.text).join('');
  const wide = statusBarLayout({ width: 120, mode: 'plan', model: '3.8 Flash', modelMark: '⚠' });
  assert.match(text(wide), /⚠ 3\.8 Flash · model mismatch/);
  const down = statusBarLayout({ width: 120, mode: 'plan', model: '3.8 Flash', modelMark: '↓' });
  assert.doesNotMatch(text(down), /mismatch/, 'control: a step-down is not a mismatch');
  const narrow = statusBarLayout({ width: 40, mode: 'plan', model: '3.8 Flash', modelMark: '⚠' });
  assert.match(text(narrow), /⚠/, 'the words give way, the mark does not');
});

