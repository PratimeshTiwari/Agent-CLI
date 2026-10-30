/*
 * The question prompt, Claude Code's layout (v6.4, the owner's pick). The
 * frame rule from CLAUDE.md applies: the prompt is drawn in the live frame,
 * so every layout here must fit the rows it is given.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TYPE_SOMETHING, questionTabs, questionLayout, nextStep, submitSummary, submitLayout,
} from '../../src/ui/question-view.js';

const q = (header, n = 2) => ({
  header, question: `${header}?`,
  options: Array.from({ length: n }, (_, i) => ({ label: `opt ${i}`, value: `opt ${i}`, description: `why ${i}` })),
});
const items = (n, described = true) => [
  ...Array.from({ length: n }, (_, i) => ({ label: `o${i}`, description: described ? `d${i}` : '' })),
  { label: TYPE_SOMETHING, description: '' },
];
// What the prompt draws for a question: rule, head, gaps, keys, question, gap, options.
const drawn = (layout, its, questionLines) => {
  const furniture = 2 + (layout.tight ? 0 : 2) + 1 + questionLines + (layout.tight ? 0 : 1);
  const options = layout.under
    ? its.reduce((n, it) => n + (it.description ? 2 : 1), 0)
    : Math.min(its.length, layout.room);
  return furniture + options;
};

test('tabs: one per question, ☐ until answered, then Submit — and none for one question', () => {
  const qs = [q('Database'), q('Auth')];
  const tabs = questionTabs(qs, ['Postgres'], 1);
  assert.deepEqual(tabs.map((t) => [t.label, t.done, t.active]),
    [['Database', true, false], ['Auth', false, true], ['Submit', false, false]]);
  assert.equal(tabs[2].submit, true);
  assert.deepEqual(questionTabs([q('Only')], [], 0), []);
});

test('descriptions sit under their option when there is room', () => {
  const layout = questionLayout({ items: items(3), rows: 20, questionLines: 1 });
  assert.equal(layout.under, true);
  assert.equal(layout.room, 4);
});

test('descriptions give way before any option does', () => {
  // 8 options + Type something: 17 rows with descriptions under them.
  const layout = questionLayout({ items: items(8), rows: 16, questionLines: 1 });
  assert.equal(layout.under, false, 'too tall for two rows each');
  assert.equal(layout.room, 9, 'every option still shown');
});

test('never taller than its rows, from 6 to 30, for 1–8 options and 1–3 question lines', () => {
  for (let rows = 6; rows <= 30; rows++) {
    for (let n = 1; n <= 8; n++) {
      for (let lines = 1; lines <= 3; lines++) {
        const its = items(n);
        const layout = questionLayout({ items: its, rows, questionLines: lines });
        const need = drawn(layout, its, lines);
        // The floor: one option row is the least a question can show.
        const floor = 2 + (layout.tight ? 0 : 2) + 1 + lines + (layout.tight ? 0 : 1) + 1;
        assert.ok(need <= Math.max(rows, floor), `${rows} rows, ${n} options, ${lines} lines: drew ${need}`);
      }
    }
  }
});

test('enter goes to the next unanswered question, then Submit', () => {
  const qs = [q('A'), q('B'), q('C')];
  assert.equal(nextStep(qs, ['x'], 0), 1);
  assert.equal(nextStep(qs, ['x', undefined, 'z'], 2), 1, 'wraps back to the gap');
  assert.equal(nextStep(qs, ['x', 'y', 'z'], 2), 3, 'all answered: Submit');
  assert.equal(nextStep([q('Only')], ['x'], 0), null, 'one question answers at once');
});

test('the Submit tab lists every answer, unanswered ones as null', () => {
  assert.deepEqual(submitSummary([q('A'), q('B')], ['x']), [
    { header: 'A', answer: 'x' }, { header: 'B', answer: null },
  ]);
});

test('the Submit tab fits its rows: heading and gap go first, then the answers share a row', () => {
  for (let rows = 6; rows <= 24; rows++) {
    for (let count = 2; count <= 4; count++) {
      const fit = submitLayout({ count, rows });
      const need = 2 + (fit.tight ? 0 : 2) + 1 + 2 + (fit.heading ? 1 : 0) + (fit.gap ? 1 : 0)
        + (fit.inline ? 1 : count);
      const floor = 2 + (fit.tight ? 0 : 2) + 1 + 2 + 1;
      assert.ok(need <= Math.max(rows, floor), `${rows} rows, ${count} answers: drew ${need}`);
    }
  }
  assert.deepEqual(submitLayout({ count: 3, rows: 20 }), { tight: false, heading: true, gap: true, inline: false });
  // Mid-turn at 13 rows a menu has about six: the answers share one row rather
  // than all hiding behind "+3 more".
  assert.equal(submitLayout({ count: 3, rows: 6 }).inline, true);
});

test('the component draws descriptions under options and offers Type something.', () => {
  const src = readFileSync(new URL('../../src/ui/components/QuestionPrompt.jsx', import.meta.url), 'utf8');
  assert.match(src, /layout\.under && item\.description/);
  assert.match(src, /TYPE_SOMETHING/);
  assert.doesNotMatch(src, /Something else…/, 'the old freeform label is back');
  assert.doesNotMatch(src, /↳/, 'the description line under the list is back');
});
