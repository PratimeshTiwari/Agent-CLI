/**
 * Locked models, Gemini Auto and a ticked thinking level (v9.7).
 *
 * Both lists are the live picker as read on 2026-11-06 with Claude in Chrome:
 * one account on 3.8 Flash with four models, one on Auto with 3.1 Pro and
 * 4 Argon locked. Each has a Thinking level row with Low ticked, which the
 * extension reports as modes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickModelFor, planModelSwitch, rungForModel, explainModelMismatch, selectedModel, lockedReason,
} from '../../../../src/backend/core/models/model-match.js';
import { stopModel, tabDiffers } from '../../../../src/frontend/menus/effort-slider.js';
import { EFFORT_LEVELS } from '../../../../src/backend/core/models/effort.js';

const m = (label, description, extra = {}) => ({ label, description, isMode: false, ...extra });
const LEVELS = [
  m('Thinking level', '', { isMode: true }),
  m('Low', 'Quick and efficient', { isMode: true, selected: true }),
  m('Medium', 'Balanced depth', { isMode: true }),
  m('High', 'Extra thorough', { isMode: true }),
];
const AUTO = [
  m('Auto', 'Gemini 3 models', { selected: true }),
  m('3.1 Pro', 'Advanced reasoning', { locked: true }),
  m('4 Argon', 'Complex tasks', { locked: true }),
  ...LEVELS,
];
const FULL = [
  m('3.5 Flash-Lite', 'Fastest answers'),
  m('3.8 Flash', 'All-around help', { selected: true }),
  m('3.1 Pro', 'Advanced reasoning'),
  m('4 Argon', 'Complex tasks'),
  ...LEVELS,
];
const rung = (id) => EFFORT_LEVELS.find((e) => e.id === id);

test('no rung picks a locked model on the Auto account', () => {
  for (const id of ['low', 'medium', 'high']) {
    assert.equal(pickModelFor(id, AUTO)?.model.label, 'Auto', id);
    assert.equal(planModelSwitch(id, AUTO).action, 'none', id);
  }
  assert.equal(pickModelFor('max', AUTO), null);
  assert.equal(planModelSwitch('max', AUTO).action, 'unavailable');
});

test('negative control: the same list unlocked plans the switches it used to', () => {
  const open = AUTO.map((x) => ({ ...x, locked: false }));
  assert.equal(planModelSwitch('high', open).model.label, '3.1 Pro');
  assert.equal(planModelSwitch('max', open).model.label, '4 Argon');
});

test('the prompt follows the setting on Auto, Max taking High', () => {
  for (const id of ['low', 'medium', 'high']) assert.equal(rungForModel(AUTO, id), id);
  assert.equal(rungForModel(AUTO, 'max'), 'high');
});

test('a pin to a locked model is not honoured', () => {
  const pick = pickModelFor('high', AUTO, '3.1 Pro');
  assert.equal(pick.model.label, 'Auto');
  assert.match(pick.pinMissed, /does not offer/);
});

test('the reason names the lock, and only when it is the reason', () => {
  assert.equal(lockedReason('max', AUTO), '4 Argon is locked on this account');
  assert.equal(lockedReason('high', AUTO), null, 'High has a model, so no reason is owed');
  assert.equal(lockedReason('max', FULL), null, 'nothing is locked there');
  assert.equal(lockedReason('max', FULL.filter((x) => x.label !== '4 Argon')), null,
    'absent is not locked');
});

test('the effort slider says locked, not "not available"', () => {
  assert.deepEqual(stopModel(rung('max'), AUTO), { text: '4 Argon is locked', available: false });
  assert.deepEqual(stopModel(rung('high'), AUTO), { text: 'Auto', available: true });
});

test('a ticked level is never the tab\'s model', () => {
  const none = FULL.map((x) => (x.isMode ? x : { ...x, selected: false }));
  assert.equal(selectedModel(none), null);
  assert.equal(explainModelMismatch('high', none).state, 'unknown');
  assert.equal(rungForModel(none, 'high'), null);
  assert.equal(tabDiffers({ available: true, text: '3.1 Pro' }, none), null);
  // Control: with the model ticked, it is found.
  assert.equal(selectedModel(FULL).label, '3.8 Flash');
});

test('the four-model account maps as before, levels and all', () => {
  assert.deepEqual(['low', 'medium', 'high', 'max'].map((id) => pickModelFor(id, FULL).model.label),
    ['3.5 Flash-Lite', '3.8 Flash', '3.1 Pro', '4 Argon']);
});
