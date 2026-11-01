/**
 * The status bar, Option A (v6.13): quiet by default, colour for departures,
 * absent at default, and a fixed order of what gives way as the terminal
 * narrows. Every state in the plan, at 60, 90 and 120 columns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contextText, shortModel, statusBarLayout, STATUS_RIGHT_GUTTER } from '../../src/frontend/status-bar.js';
import { contextMeter } from '../../src/frontend/format.js';

const text = (segs) => segs.map((s) => s.text).join('');
const render = (o) => {
  const { left, right } = statusBarLayout(o);
  return { left: text(left), right: text(right), width: [...text(left)].length + (right.length ? 2 + [...text(right)].length : 0), left_: left, right_: right };
};
const ctx = (pct) => ({ pct, meter: contextMeter(pct), compactAtPct: 80 });

test('a fresh chat: the mode, the hint, the model, and no context at all', () => {
  const r = render({ width: 120, mode: 'plan', hint: true, model: '3.5 Flash-Lite', pct: 0, meter: contextMeter(0) });
  assert.equal(r.left, '⏸ plan mode · shift+tab to cycle');
  assert.equal(r.right, '3.5 Flash-Lite');
});

test('mid-chat there is no hint: it is taught at the start, not on every frame', () => {
  const r = render({ width: 120, mode: 'plan', hint: false, model: '3.5 Flash-Lite', ...ctx(14) });
  assert.equal(r.left, '⏸ plan mode');
  assert.equal(r.right, '3.5 Flash-Lite · ▰▱▱▱▱ 14%');
});

test('auto, v2, a turn with a checklist, 38% used', () => {
  const r = render({ width: 120, mode: 'auto', tasks: { done: 2, total: 5 }, version: 'v2', model: '3.5 Flash-Lite', ...ctx(38) });
  assert.equal(r.left, '⏵⏵ auto mode');
  assert.equal(r.right, 'tasks 2/5 · v2 · 3.5 Flash-Lite · ▰▰▱▱▱ 38%');
});

test('the wrong model, near compaction: marked, and says how far', () => {
  const r = render({ width: 120, mode: 'plan', model: '3 Flash', modelMark: '⚠', ...ctx(68) });
  assert.equal(r.right, '⚠ 3 Flash · ▰▰▰▱▱ 12% to compact');
  assert.equal(r.right_.find((s) => s.text.includes('Flash')).role, 'attention');
});

test('background work and a step-down are attention; everything at its default is dim', () => {
  const r = render({ width: 120, mode: 'plan', running: 1, model: '3 Flash', modelMark: '↓', ...ctx(14) });
  assert.equal(r.right, '1 running · ↓ 3 Flash · ▰▱▱▱▱ 14%');
  const roles = Object.fromEntries(r.right_.filter((s) => s.text !== ' · ').map((s) => [s.text.trim(), s.role]));
  assert.equal(roles['1 running'], 'attention');
  assert.equal(roles['↓ 3 Flash'], 'attention');
  assert.equal(roles['▰▱▱▱▱'], 'dim');
  assert.equal(roles['14%'], 'dim');
});

test('the meter warns past 50 and the whole field is danger past 80', () => {
  const mid = render({ width: 120, mode: 'plan', ...ctx(55) }).right_;
  assert.equal(mid[0].role, 'attention');
  assert.equal(mid[1].role, 'dim');
  const full = render({ width: 120, mode: 'plan', ...ctx(85) }).right_;
  assert.deepEqual(full.map((s) => s.role), ['danger', 'danger']);
  assert.equal(text(full), '▰▰▰▰▱ 0% to compact');
});

test('the effort shows, bare, only while the picker is unread', () => {
  assert.equal(render({ width: 120, mode: 'plan', effort: 'medium' }).right, 'medium');
  assert.equal(render({ width: 120, mode: 'plan', effort: 'medium', model: '3 Flash' }).right, '3 Flash');
});

test('a notice replaces the hint and is never shed', () => {
  const r = render({ width: 40, mode: 'plan', hint: true, notice: 'Press Ctrl+C again to exit', model: '3 Flash' });
  assert.match(r.left, /Press Ctrl\+C again to exit/);
  assert.doesNotMatch(r.left, /shift\+tab/);
});

test('60 columns: the plan\'s example', () => {
  const r = render({ width: 60, mode: 'plan', hint: true, version: 'v2', model: '3.5 Flash-Lite', ...ctx(14) });
  assert.ok(r.width <= 60, `${r.width}: ${r.left} | ${r.right}`);
  assert.equal(r.left, '⏸ plan mode');
  assert.equal(r.right, 'v2 · 3.5 Flash-Lite · ▰▱▱▱▱ 14%');
});

test('the width order: hint, mode word, meter, version, model number, tasks', () => {
  const o = { mode: 'auto', hint: true, tasks: { done: 2, total: 5 }, version: 'v2', model: '3.5 Flash-Lite', ...ctx(38) };
  const at = (width) => render({ ...o, width });
  assert.match(at(80).left, /shift\+tab/, 'all of it fits at 80');
  assert.equal(at(76).left, '⏵⏵ auto mode', 'the hint goes first');
  assert.match(at(56).left, /^⏵⏵ auto$/, 'then the word mode');
  assert.doesNotMatch(at(50).right, /▰/, 'then the meter cells');
  assert.match(at(50).right, /38%/, 'the percent stays');
  assert.doesNotMatch(at(44).right, /v2/, 'then the version');
  assert.match(at(40).right, /^tasks 2\/5 · Flash-Lite · 38%$/, 'then the model version number');
  assert.equal(at(36).right, 'Flash-Lite · 38%', 'then tasks');
  for (const w of [80, 76, 56, 50, 44, 40, 36]) assert.ok(at(w).width <= w, `${w}: ${at(w).width}`);
});

test('never dropped at 30 columns: the mode, a marked model, background work, a full context', () => {
  const r = render({ width: 30, mode: 'strict', hint: true, running: 2, model: '3 Flash', modelMark: '⚠', ...ctx(90) });
  assert.match(r.left, /^⏹ strict/);
  assert.match(r.right, /2 running/);
  assert.match(r.right, /⚠ Flash/);
  assert.match(r.right, /0% to compact/);
});

test('every state fits at 60, 90 and 120 columns', () => {
  const states = [
    { mode: 'plan', hint: true, model: '3.5 Flash-Lite' },
    { mode: 'auto', tasks: { done: 2, total: 5 }, version: 'v2', model: '3.5 Flash-Lite', ...ctx(38) },
    { mode: 'plan', model: '3 Flash', modelMark: '⚠', ...ctx(68) },
    { mode: 'plan', running: 1, model: '3 Flash', modelMark: '↓', ...ctx(14) },
    { mode: 'strict', hint: true, pastes: 2, scope: 'repo-1', effort: 'medium', ...ctx(22) },
  ];
  for (const s of states) for (const width of [60, 90, 120]) {
    const r = render({ ...s, width });
    assert.ok(r.width <= width, `${width}: ${r.left} | ${r.right}`);
  }
});

test('helpers', () => {
  assert.equal(shortModel('3.5 Flash-Lite'), 'Flash-Lite');
  assert.equal(shortModel('4 Argon'), 'Argon');
  assert.equal(shortModel('Fast'), 'Fast');
  assert.equal(contextText(14, 80), '14%');
  assert.equal(contextText(60, 80), '20% to compact');
  assert.equal(contextText(93, 80), '0% to compact');
});

test('v6.22: the right half stops short of the last column', () => {
  // Flush, its last character sat under VS Code's overlay scrollbar and was
  // reported as running off the edge. App must lay out narrower *and* leave
  // the columns empty — either alone is the bug (or a wrap) again.
  assert.ok(STATUS_RIGHT_GUTTER >= 1);
  const app = readFileSync(new URL('../../src/frontend/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /width: Math\.max\(1, terminalWidth - STATUS_RIGHT_GUTTER\)/);
  assert.match(app, /marginRight=\{STATUS_RIGHT_GUTTER\}/);
});
