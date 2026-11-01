import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claim, exclusive, holderOf } from '../../../src/backend/core/local-jobs.js';

test('a second claim is told who holds the slot, and release frees it', () => {
  const a = claim('t1', '/doctor fix');
  assert.equal(a.ok, true);
  assert.deepEqual(claim('t1', '/update pull'), { ok: false, holder: '/doctor fix' });
  assert.equal(holderOf('t1'), '/doctor fix');
  a.release();
  a.release();
  assert.equal(holderOf('t1'), null);
  const b = claim('t1', '/update pull');
  assert.equal(b.ok, true);
  a.release();
  assert.equal(holderOf('t1'), '/update pull', 'a stale release must not free someone else\'s claim');
  b.release();
});

test('exclusive runs one at a time and answers the other without running it', async () => {
  let ran = 0;
  let open;
  const first = exclusive('t2', 'install ink@7.2.0', () => new Promise((r) => { ran += 1; open = r; }));
  const second = await exclusive('t2', 'npm install', () => { ran += 1; return { ok: true }; });
  assert.deepEqual(second, { busy: 'install ink@7.2.0' });
  open({ ok: true });
  assert.deepEqual(await first, { ok: true });
  assert.equal(ran, 1);
  assert.equal(holderOf('t2'), null);
});

test('a throwing job still frees the slot', async () => {
  await assert.rejects(exclusive('t3', 'x', async () => { throw new Error('boom'); }));
  assert.equal(holderOf('t3'), null);
});
