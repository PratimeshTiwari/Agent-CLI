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

test('it is one truncated row, still charged to the budget', () => {
  const row = app.slice(app.indexOf('{mismatch && ('), app.indexOf('{mismatch && (') + 200);
  assert.match(row, /wrap="truncate"/);
  assert.match(app, /const noticeRows = [^;]*\(mismatch \? 1 : 0\)/);
});

test('it names the tab first, so a narrow terminal keeps that part', () => {
  const row = app.slice(app.indexOf('{mismatch && ('), app.indexOf('{mismatch && (') + 300);
  assert.match(row, /'⚠ tab is on '\}<Text bold>\{mismatch\.current\}/);
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
test('it says which prompt is going out', () => {
  const row = app.slice(app.indexOf('{mismatch && ('), app.indexOf('<InputBar\n'));
  assert.match(row, /sentRung\.id !== effortRung\.id/);
  assert.match(row, /' — sending the '\}<Text bold>\{sentRung\.name\}/);
  assert.match(row, /effort \$\{effortRung\.name\} wants /, 'control: the mode case keeps its wording');
  assert.match(app, /const sentRung = resolveEffort\(agentLoop\._promptEffort\?\.\(\)/);
});
