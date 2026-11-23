/**
 * The agent's mark on a link it opened (1.72.0): read once, then taken out of
 * the address. Owner, 2026-11-23, on `#agent-pair=…`: "will google know about
 * this?" — a fragment is never sent in a request, but the page's scripts can
 * read it and it sat in the history; and "lets name it something random".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { loadFunction } from '../load-content-script.js';

const FILE = fileURLToPath(new URL('../../content-scripts/gemini-bridge.js', import.meta.url));
const takeAgentMark = loadFunction(FILE, 'takeAgentMark');

function page(hash) {
  const calls = [];
  const loc = { hash, pathname: '/app', search: '' };
  return { loc, calls, hist: { state: null, replaceState: (...a) => calls.push(a) } };
}

test('a pairing code is read and removed from the address', () => {
  const token = 'dc97db59b3a9035c1f3b1fcfae3c3656';
  for (const name of ['g7k', 'agent-pair']) {
    const p = page(`#${name}=${token}`);
    assert.equal(takeAgentMark(p.loc, p.hist), token);
    assert.deepEqual(p.calls, [[null, '', '/app']], 'left in the address');
  }
});

test('the start mark is read and removed', () => {
  const p = page('#g7k=o');
  assert.equal(takeAgentMark(p.loc, p.hist), 'o');
  assert.equal(p.calls.length, 1);
});

test('anything else is not ours: no mark, the address untouched', () => {
  for (const hash of ['', '#', '#g7k=xyz', '#other=dc97db59b3a9035c1f3b1fcfae3c3656', '#g7k=o&x']) {
    const p = page(hash);
    assert.equal(takeAgentMark(p.loc, p.hist), null, hash);
    assert.equal(p.calls.length, 0, hash);
  }
});

test('the content script logs and reports the address without the mark', async () => {
  const { readFileSync } = await import('fs');
  const src = readFileSync(FILE, 'utf8');
  assert.doesNotMatch(src, /Content script loaded on:', window\.location\.href/);
  assert.match(src, /url: window\.location\.origin \+ window\.location\.pathname/);
});
