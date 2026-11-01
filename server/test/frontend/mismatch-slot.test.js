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

const app = readFileSync(new URL('../../src/frontend/App.jsx', import.meta.url), 'utf8');

test('there is no mismatch row above the input any more; the footer says it (v7.9)', async () => {
  // Owner: "just show ⚠ 3 Flash, that's it nothing else, keep it simple and minimal".
  assert.doesNotMatch(app, /\{mismatch && \(/);
  assert.doesNotMatch(app, /const noticeRows = [^;]*mismatch/);
  assert.match(app, /modelMark: browserModelLabel \? \(agentLoop\.effortFallback \? '↓' : modelDiffers \? '⚠' : null\)/);
  const { statusBarLayout } = await import('../../src/frontend/status-bar.js');
  const text = (l) => l.right.map((f) => f.text).join('');
  assert.equal(text(statusBarLayout({ width: 120, mode: 'plan', model: '3 Flash', modelMark: '⚠' })), '⚠ 3 Flash');
});

/*
 * Found by the pty run for this file: the harness config holds the retired
 * word `standard`. The status bar read `effort: high` and the high prompt went
 * out, but the mismatch check said "nothing offered suits standard" and stayed
 * silent — on every config written before the rename.
 */
test('the row is computed from the resolved rung, not the stored word', async () => {
  const { modelMismatch } = await import('../../src/backend/core/model-match.js');
  const { resolveEffort } = await import('../../src/backend/core/effort.js');
  const models = [{ label: '3.1 Flash-Lite' }, { label: '3 Flash', selected: true }, { label: '3.1 Pro' }];
  // Control: the raw retired word is silent — which is the bug, if passed raw.
  assert.equal(modelMismatch('standard', models), null);
  assert.deepEqual(modelMismatch(resolveEffort('standard').id, models), { current: '3 Flash', wanted: '3.1 Pro' });
  const call = app.slice(app.indexOf(': modelMismatch('), app.indexOf(': modelMismatch(') + 80);
  assert.match(call, /modelMismatch\(\s*effortRung\.id,/);
});
