import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStatus, companionDetail, editorItems, homeItems, installLines, otherCommand, startingPicks,
} from '../../../src/frontend/menus/update-view.js';
import { checkFailure } from '../../../src/backend/core/install/update.js';

const vsix = { path: '/c/x.vsix', version: '1.8.15' };
const ed = (id, name, version, read = true) => ({ id, name, version, read, cli: `/bin/${id}` });

describe('the title row', () => {
  test('says what the check found', () => {
    assert.equal(checkStatus(null), 'checking…');
    assert.equal(checkStatus({ available: false, version: 'v9.4' }), 'up to date · v9.4');
    assert.equal(checkStatus({ available: true }), 'update available');
    assert.equal(checkStatus({ reason: 'not a git checkout' }), 'could not check');
  });

  test('each failure gets words to act on', () => {
    assert.match(checkFailure({ reason: 'git could not run (EBADF)' }), /too many open files/);
    assert.match(checkFailure({ reason: 'git could not run (ENOENT)' }), /on the PATH/);
    assert.match(checkFailure({ reason: 'not a git checkout' }), /git checkout/);
    assert.match(checkFailure({ reason: 'no origin/main' }), /origin\/main/);
  });
});

describe('the home list', () => {
  const available = { available: true, version: 'v9.3', latest: 'v9.5', releases: 2, behind: 9 };

  test('Update is there only when there is one', () => {
    assert.equal(homeItems({ check: { available: false }, editors: [], vsix })[0].label, 'Editor companion');
    const [row] = homeItems({ check: available, editors: [], vsix });
    assert.deepEqual([row.label, row.detail], ['Update', 'v9.3 → v9.5 · 2 releases']);
  });

  test('a dirty tree is said on the row, before a pull is refused', () => {
    const [row] = homeItems({ check: available, blocked: ['a.js'], editors: [], vsix });
    assert.equal(row.tone, 'attention');
    assert.match(row.detail, /commit or stash/);
  });

  test('no .vsix, no companion row; a reminder, a dismiss row', () => {
    assert.deepEqual(homeItems({ check: null, editors: null, vsix: null }), []);
    const items = homeItems({ check: null, editors: [], vsix, pending: { steps: [{ what: 'Update the editor companion' }] } });
    assert.deepEqual(items.map((i) => i.value), ['editors', 'dismiss']);
  });

  test('the companion row says who is behind, and is marked', () => {
    const items = homeItems({ check: null, vsix, editors: [ed('cursor', 'Cursor', '1.8.13'), ed('code', 'VS Code', '1.8.15')] });
    assert.equal(items[0].detail, 'Cursor 1.8.13 → 1.8.15');
    assert.equal(items[0].tone, 'attention');
  });

  test('its other answers', () => {
    assert.equal(companionDetail(null, vsix), 'reading…');
    assert.match(companionDetail([], vsix), /no editor found/);
    assert.equal(companionDetail([ed('a', 'A', '1.8.15'), ed('b', 'B', null)], vsix), '1.8.15 · current in 1 of 2');
    assert.equal(companionDetail([ed('b', 'B', null)], vsix), '1.8.15 · not installed yet');
  });
});

describe('choosing editors', () => {
  const editors = [ed('cursor', 'Cursor', '1.8.13'), ed('code', 'VS Code', null), ed('ag', 'Antigravity', '1.8.15'), ed('w', 'Windsurf', null, false)];

  test('what is behind starts ticked; a new install is a choice', () => {
    assert.deepEqual([...startingPicks(editors, '1.8.15')], ['cursor']);
  });

  test('every row says where it stands, and Other comes last', () => {
    const items = editorItems(editors, '1.8.15', new Set(['cursor']));
    assert.deepEqual(items.map((i) => i.detail), ['1.8.13 → 1.8.15', 'not installed', '1.8.15 · current', 'could not read it', 'show the command']);
    assert.deepEqual(items.map((i) => i.glyph), ['●', '○', '○', '○', ' ']);
    assert.equal(items.at(-1).value, 'other');
  });

  test('ticking keeps the keys, so the cursor stays on its row', () => {
    const keys = (picks) => editorItems(editors, '1.8.15', picks).map((i) => i.key ?? i.value).join();
    assert.equal(keys(new Set()), keys(new Set(['code'])));
  });

  test('Other shows a command to paste, path quoted', () => {
    assert.equal(otherCommand('/my stuff/x.vsix'), '<editor> --install-extension "/my stuff/x.vsix" --force');
  });
});

describe('what the transcript keeps', () => {
  test('what landed, then each that did not', () => {
    assert.equal(installLines([{ ok: true, name: 'Cursor' }], '1.8.15'), '✔ Companion 1.8.15 · Cursor · reload its window to start it');
    assert.equal(installLines([{ ok: true, name: 'A' }, { ok: true, name: 'B' }, { ok: false, name: 'C', error: 'no' }], '1.8.15'),
      '✔ Companion 1.8.15 · A, B · reload each window to start it\n✗ C: no');
  });
});
