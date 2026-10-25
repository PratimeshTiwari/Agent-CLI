/**
 * `/effort` as a slider (`ui/effort-slider.js`): the marker sits over the
 * level it names, the names never overlap, and nothing is wider than the room.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sliderLayout } from '../../src/ui/effort-slider.js';
import { EFFORT_LEVELS } from '../../src/core/effort.js';

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
  const menus = readFileSync(new URL('../../src/ui/components/Menus.jsx', import.meta.url), 'utf8');
  const effort = menus.slice(menus.indexOf("activeMenu?.type === 'effort' && (() =>"));
  assert.match(effort.slice(0, 4000), /sliderLayout\(/);
  assert.match(menus, /activeMenu\?\.type === 'effort'[\s\S]{0,400}leftArrow/);
});
