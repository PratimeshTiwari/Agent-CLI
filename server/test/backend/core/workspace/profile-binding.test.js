import test from 'node:test';
import assert from 'node:assert/strict';
import { PAIR_TTL_MS, ProfileBinding, pairUrl } from '../../../../src/backend/core/workspace/profile-binding.js';

const rig = (saved = {}) => {
  const writes = [];
  let clock = 1000;
  const b = new ProfileBinding({ load: () => saved, save: (p) => writes.push(p), now: () => clock });
  return { b, writes, tick: (ms) => { clock += ms; } };
};
const WORK = { dir: 'Profile 2', name: 'Work', email: 'w@x.com' };

test('unbound admits anyone; bound only the install that paired', () => {
  const { b, writes } = rig();
  assert.equal(b.admits('a'), true);
  b.bind(WORK, 'a');
  assert.equal(b.admits('a'), true);
  assert.equal(b.admits('b'), false);
  assert.equal(b.admits(null), false, 'an older build with no id must not get through');
  assert.equal(writes[0].chromeProfile.install, 'a');
});

test('the choice survives a restart, and half a record is no choice', () => {
  assert.equal(rig({ chromeProfile: { ...WORK, install: 'a' } }).b.admits('b'), false);
  assert.equal(rig({ chromeProfile: { name: 'x' } }).b.current, null);
});

test('a token works once', () => {
  const { b } = rig();
  const token = b.startPairing(WORK);
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(b.takePairing('f'.repeat(32)), null);
  assert.equal(b.takePairing(token), WORK, "an old link in another profile's tab must not end the wait");
  assert.equal(b.takePairing(token), null, 'one use');
});

test('a token expires, and only the newest counts', () => {
  const { b, tick } = rig();
  const old = b.startPairing(WORK);
  const token = b.startPairing(WORK);
  assert.equal(b.takePairing(old), null);
  const late = b.startPairing(WORK);
  tick(PAIR_TTL_MS + 1);
  assert.equal(b.takePairing(late), null);
  assert.notEqual(token, late);
});

test('clear lifts it and says so; a screen that throws stops nothing', () => {
  const { b, writes } = rig({ chromeProfile: { ...WORK, install: 'a' } });
  const seen = [];
  b.onChange(() => { throw new Error('screen'); });
  b.onChange((c) => seen.push(c));
  b.clear();
  assert.deepEqual(seen, [null]);
  assert.equal(b.admits('z'), true);
  assert.deepEqual(writes, [{ chromeProfile: null }]);
});

test('the token is a fragment, which a browser never sends to Google', () => {
  assert.equal(new URL(pairUrl('ab')).search, '');
  assert.equal(new URL(pairUrl('ab')).hash, '#agent-pair=ab');
});
