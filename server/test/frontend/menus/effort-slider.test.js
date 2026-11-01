/**
 * `/effort` as a slider (`frontend/menus/effort-slider.js`): the marker sits over the
 * level it names, the names never overlap, and nothing is wider than the room.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sliderLayout } from '../../../src/frontend/menus/effort-slider.js';
import { EFFORT_LEVELS } from '../../../src/backend/core/effort.js';

const FOUR = [...EFFORT_LEVELS, { id: 'max', name: 'Max' }];

test('the marker is under the level it names, at every position and width', () => {
  for (const levels of [EFFORT_LEVELS, FOUR]) {
    for (const width of [40, 60, 80, 120, 200]) {
      for (let at = 0; at < levels.length; at++) {
        const l = sliderLayout({ levels, at, width });
        const marker = l.bar.before.length;
        const label = l.labels[at];
        assert.ok(marker >= label.col - 1 && marker <= label.col + label.text.length,
          `width ${width}, at ${at}: marker ${marker} is not under "${label.text}" at ${label.col}`);
      }
    }
  }
});

test('names never overlap and stay inside the bar', () => {
  for (const levels of [EFFORT_LEVELS, FOUR]) {
    for (const width of [30, 40, 80, 200]) {
      const l = sliderLayout({ levels, at: 0, width });
      l.labels.forEach((x, i) => {
        assert.ok(x.col >= 0 && x.col + x.text.length <= l.span, `width ${width}: ${x.text} outside`);
        if (i) assert.ok(x.col > l.labels[i - 1].col + l.labels[i - 1].text.length, `width ${width}: ${x.text} overlaps`);
      });
    }
  }
});

test('every row is the span wide, and the span fits the terminal where it can', () => {
  const l = sliderLayout({ levels: EFFORT_LEVELS, at: 1, width: 80 });
  assert.equal(l.bar.before.length + 1 + l.bar.after.length, l.span);
  assert.equal(l.ends.length, l.span);
  assert.ok(l.indent + l.span <= 80);
  assert.ok(l.ends.startsWith('Faster') && l.ends.endsWith('Smarter'));
});

test('the menu moves it with ←/→ and draws no list', () => {
  const menus = readFileSync(new URL('../../../src/frontend/components/Menus.jsx', import.meta.url), 'utf8');
  const effort = menus.slice(menus.indexOf("activeMenu?.type === 'effort' && (() =>"));
  assert.match(effort.slice(0, 4000), /sliderLayout\(/);
  assert.match(menus, /activeMenu\?\.type === 'effort'[\s\S]{0,400}leftArrow/);
});

/*
 * C2: the line under the bar names the model the marked stop maps to on this
 * account, and Max says it is not available before it is chosen.
 */
test('each stop names its model on this account', async () => {
  const { stopModel } = await import('../../../src/frontend/menus/effort-slider.js');
  const rung = (id) => EFFORT_LEVELS.find((e) => e.id === id);
  const m = (label) => ({ label, isMode: false });
  const four = [m('3.5 Flash-Lite'), m('3.8 Flash'), m('3.1 Pro'), m('4 Argon')];
  assert.deepEqual(EFFORT_LEVELS.map((e) => stopModel(e, four).text),
    ['3.5 Flash-Lite', '3.8 Flash', '3.1 Pro', '4 Argon']);
  assert.deepEqual(stopModel(rung('max'), four.slice(0, 3)),
    { text: 'not available on this account', available: false });
  // Before the picker reports, the rung's own text, as before.
  assert.deepEqual(stopModel(rung('max'), null), { text: 'Gemini Argon', available: true });
});

test('the menu draws the stop\'s model, dimmed when unavailable', () => {
  const menus = readFileSync(new URL('../../../src/frontend/components/Menus.jsx', import.meta.url), 'utf8');
  const block = menus.slice(menus.indexOf("activeMenu?.type === 'effort' && (() =>"));
  assert.match(block, /stopModel\(e, agentLoop\.modelOptions, agentLoop\.modelConfig\)/);
  assert.match(block, /dimColor=\{!model\.available\}/);
  assert.doesNotMatch(block.slice(0, block.indexOf('</Panel>')), /marked\.browser/,
    'the generic family name is back under the bar');
});

test('tabDiffers: the slider warns when the tab is on another model (v7.9)', async () => {
  const { tabDiffers } = await import('../../../src/frontend/menus/effort-slider.js');
  const models = [{ label: '3.8 Flash', selected: true }, { label: '3.1 Pro' }];
  assert.equal(tabDiffers({ text: '3.1 Pro', available: true }, models), '3.8 Flash');
  assert.equal(tabDiffers({ text: '3.8 Flash', available: true }, models), null, 'control: same model');
  assert.equal(tabDiffers({ text: '3.1 Pro', available: false }, models), null);
  assert.equal(tabDiffers({ text: '3.1 Pro', available: true }, []), null, 'picker never read');
  assert.equal(tabDiffers({ text: '3.1 Pro', available: true }, [{ label: 'Deep Research', isMode: true, selected: true }]), null);
});
