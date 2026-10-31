/*
 * `/prompt` as a comparison (v6.11): a rounds bar per version and what the
 * highlighted version changes, both given up before the list is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundsBar, promptPanelPlan, roundsLabel } from '../../src/ui/prompt-view.js';
import { PROMPT_VERSIONS, FLAG_NOTES, versionChanges, versionAdds } from '../../src/core/prompt-versions.js';

test('a bar fills to the median and traces to the p90, scaled to the largest p90', () => {
  assert.deepEqual(roundsBar({ median: 1, p90: 3, max: 3, width: 12 }), { fill: 4, tail: 8 });
  assert.deepEqual(roundsBar({ median: 2, p90: 2, max: 4, width: 12 }), { fill: 6, tail: 0 });
  assert.deepEqual(roundsBar({ median: null, p90: null, max: 3, width: 12 }), { fill: 0, tail: 0 }, 'not used yet: no bar');
  const { fill, tail } = roundsBar({ median: 9, p90: 40, max: 40, width: 10 });
  assert.ok(fill >= 1 && fill + tail <= 10);
});

test('the blocks give way from the bottom; the list never does', () => {
  const changes = ['a', 'b', 'c', 'd'];
  assert.deepEqual(promptPanelPlan({ room: 20, versions: 2, changes }), { stats: true, changes });
  // 4 for the stats, 2 for gap + heading, room for one line and a "more" row.
  assert.deepEqual(promptPanelPlan({ room: 8, versions: 2, changes }), { stats: true, changes: ['a', '… +3 more'] });
  assert.deepEqual(promptPanelPlan({ room: 6, versions: 2, changes }), { stats: true, changes: [] });
  assert.deepEqual(promptPanelPlan({ room: 4, versions: 2, changes }), { stats: true, changes: [] });
  assert.deepEqual(promptPanelPlan({ room: 3, versions: 2, changes }), { stats: false, changes: [] }, 'never a bare "+4 more"');
  assert.deepEqual(promptPanelPlan({ room: 3, versions: 2, changes: ['only'] }), { stats: false, changes: ['only'] });
  assert.deepEqual(promptPanelPlan({ room: 0, versions: 2, changes }), { stats: false, changes: [] });
});

test('the label says how much a version has been used', () => {
  assert.equal(roundsLabel({ turns: 0 }), 'not used yet');
  assert.equal(roundsLabel({ turns: 39, median: 1, p90: 3 }), 'median 1 · p90 3 · 39 turns');
  assert.equal(roundsLabel({ turns: 1, median: null }), '1 turn');
});

test('every switch a version turns on has a line to say what it changes', () => {
  for (const v of Object.values(PROMPT_VERSIONS)) {
    for (const flag of Object.keys(v.flags || {})) assert.ok(FLAG_NOTES[flag], `${v.id}.${flag} has no FLAG_NOTES entry`);
  }
  assert.deepEqual(versionChanges('v1'), [], 'v1 is the baseline');
  assert.equal(versionChanges('v2').length, Object.keys(PROMPT_VERSIONS.v2.flags).length);
});

test('each version is described by what it adds to the one before (v8.1)', () => {
  // v4's only new line, Jira, used to sit behind "… +6 more".
  assert.deepEqual(versionAdds('v1'), { from: null, lines: [] });
  assert.equal(versionAdds('v2').from, 'v1');
  assert.deepEqual(versionAdds('v2').lines, versionChanges('v2'));
  assert.deepEqual(versionAdds('v3'), { from: 'v2', lines: [FLAG_NOTES.lookFirst] });
  assert.deepEqual(versionAdds('v4'), { from: 'v3', lines: [FLAG_NOTES.jira] });
});

test('the → page scrolls, and says what is above and below', async () => {
  const { changesPage } = await import('../../src/ui/prompt-view.js');
  const c = Array.from({ length: 13 }, (_, i) => `c${i}`);
  assert.deepEqual(changesPage({ changes: c, rows: 20 }), { lines: c, offset: 0, max: 0 });
  assert.deepEqual(changesPage({ changes: c, rows: 5 }).lines, ['c0', 'c1', 'c2', 'c3', '… +9 more']);
  assert.deepEqual(changesPage({ changes: c, rows: 5, offset: 3 }).lines, ['… 3 above', 'c3', 'c4', 'c5', '… +7 more']);
  const last = changesPage({ changes: c, rows: 5, offset: 99 });
  assert.deepEqual(last, { lines: ['… 9 above', 'c9', 'c10', 'c11', 'c12'], offset: 9, max: 9 }, 'clamped; the end shows');
  for (let o = 0; o <= 9; o++) assert.equal(changesPage({ changes: c, rows: 5, offset: o }).lines.length, 5, `offset ${o}`);
});
