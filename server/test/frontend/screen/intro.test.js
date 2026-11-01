/**
 * The header drawing in on every start, and the goodbye on exit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { introFrame, introLength, animationAllowed, outroFrame, OUTRO_MS, GOODBYE, MARK_WIDTH, INTRO_TICK_MS } from '../../../src/frontend/screen/intro.js';
import { exitWithFarewell, registerInk, registerOutro, _resetFarewell, OUTRO_CAP_MS } from '../../../src/frontend/screen/farewell.js';

const here = dirname(fileURLToPath(import.meta.url));

test('the mark width matches the mark', () => {
  const src = readFileSync(join(here, '../../../src/frontend/components/Banner.jsx'), 'utf8');
  const row = src.match(/export const MARK = \['([^']*)'/)[1];
  assert.equal(row.length, MARK_WIDTH);
});

test('the mark sweeps in, the name types out, then the lines arrive, in that order', () => {
  const name = 'Agent CLI';
  assert.deepEqual(introFrame(0, name), { reveal: 0, nameChars: 0, lines: 0, done: false });
  let last = introFrame(0, name);
  for (let t = 1; t <= introLength(name); t += 1) {
    const f = introFrame(t, name);
    assert.ok(f.reveal >= last.reveal && f.nameChars >= last.nameChars && f.lines >= last.lines, 'never goes backwards');
    if (f.lines > 0) assert.equal(f.nameChars, name.length, 'the name is whole before the dim lines start');
    last = f;
  }
  assert.deepEqual(last, { reveal: MARK_WIDTH, nameChars: name.length, lines: 3, done: true });
});

test('it is short: under half a second for the default name, and bounded for a long one', () => {
  assert.ok(introLength('Agent CLI') * INTRO_TICK_MS <= 500);
  assert.ok(introLength('x'.repeat(40)) * INTRO_TICK_MS <= 1000);
});

test('animated only in a terminal tall enough, and never when asked not to', () => {
  assert.equal(animationAllowed({ isTTY: true, rows: 24, env: {} }), true);
  assert.equal(animationAllowed({ isTTY: false, rows: 24, env: {} }), false, 'a pipe');
  assert.equal(animationAllowed({ isTTY: true, rows: 13, env: {} }), false, 'header plus the live frame would crowd the viewport');
  assert.equal(animationAllowed({ isTTY: true, rows: 24, env: { AGENT_CLI_NO_ANIMATION: '1' } }), false);
  assert.equal(animationAllowed({ isTTY: true, rows: 24, env: { CI: 'true' } }), false);
});

test('the goodbye types out, then dims, inside the time exit waits for it', () => {
  assert.equal(outroFrame(0).text, '');
  assert.equal(outroFrame(100).text, GOODBYE);
  assert.equal(outroFrame(100).dim, true);
  assert.equal(outroFrame(1).dim, false);
  assert.ok(OUTRO_MS < OUTRO_CAP_MS, 'the cap is a backstop, not the usual path');
});

test('exit plays the goodbye before clearing — and a goodbye that never ends cannot hold it', async () => {
  _resetFarewell();
  const order = [];
  registerInk({ clear: () => order.push('clear'), unmount: () => order.push('unmount') });
  registerOutro(() => { order.push('outro'); return new Promise(() => {}); });
  const started = Date.now();
  await exitWithFarewell({ agentLoop: {}, out: { isTTY: true, write: () => order.push('write') }, exit: () => {} });
  assert.deepEqual(order, ['outro', 'clear', 'unmount', 'write']);
  assert.ok(Date.now() - started < OUTRO_CAP_MS + 300);
  _resetFarewell();
});

test('no goodbye into a pipe', async () => {
  _resetFarewell();
  let played = false;
  registerOutro(() => { played = true; return Promise.resolve(); });
  await exitWithFarewell({ agentLoop: {}, out: { isTTY: false, write() {} }, exit: () => {} });
  assert.equal(played, false);
  _resetFarewell();
});
