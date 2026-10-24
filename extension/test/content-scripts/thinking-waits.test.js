/**
 * A model that is thinking is not a failed scrape.
 *
 * 2026-10-24 20:59: a 46s paste, then Gemini Pro thought for 36s with its Stop
 * button on screen before writing anything. The "nothing scraped" timeout
 * (45s from the start of the turn) fired, the turn ended, and the reply that
 * appeared moments later was discarded. The give-up clocks now never run while
 * Gemini is generating, and count from the last moment it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadFunction } from '../load-content-script.js';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '../../content-scripts/gemini-bridge.js');
const src = readFileSync(SCRIPT, 'utf8');
const NO_RESPONSE_TIMEOUT = Number(/const NO_RESPONSE_TIMEOUT = (\d+);/.exec(src)[1]);
const RESPONSE_IDLE_TIMEOUT = Number(/const RESPONSE_IDLE_TIMEOUT = (\d+);/.exec(src)[1]);
const noResponseExpired = loadFunction(SCRIPT, 'noResponseExpired', { NO_RESPONSE_TIMEOUT });
const idleFallbackExpired = loadFunction(SCRIPT, 'idleFallbackExpired', { RESPONSE_IDLE_TIMEOUT });

test('the incident: 82s in, still thinking, no text — keep waiting', () => {
  assert.equal(noResponseExpired({ now: 82_000, responseStartTime: 0, lastBusyAt: 82_000, isGenerating: true, hasText: false }), false);
});

test('the clock restarts when generation stops: the text gets its full window', () => {
  // Stop button gone at 86s; at 90s that is 4s of silence, not 90.
  assert.equal(noResponseExpired({ now: 90_000, responseStartTime: 0, lastBusyAt: 86_000, isGenerating: false, hasText: false }), false);
  assert.equal(noResponseExpired({ now: 86_000 + NO_RESPONSE_TIMEOUT, responseStartTime: 0, lastBusyAt: 86_000, isGenerating: false, hasText: false }), true,
    'control: a real scrape failure still gives up');
});

test('control: a turn where Gemini never started still gives up on time', () => {
  assert.equal(noResponseExpired({ now: NO_RESPONSE_TIMEOUT, responseStartTime: 0, lastBusyAt: 0, isGenerating: false, hasText: false }), true);
});

test('a mid-reply thinking pause with the Stop button up does not end the turn', () => {
  assert.equal(idleFallbackExpired({ now: 60_000, lastActivityTime: 0, lastBusyAt: 60_000, isGenerating: true, hasText: true }), false);
});

test('control: text, no Stop button, long silence — the fallback still ends it', () => {
  assert.equal(idleFallbackExpired({ now: RESPONSE_IDLE_TIMEOUT, lastActivityTime: 0, lastBusyAt: 0, isGenerating: false, hasText: true }), true);
});

test('generating on this very check wins even if the busy clock is stale', () => {
  // Defence in depth: the guard alone must hold, not only the clock.
  assert.equal(noResponseExpired({ now: 500_000, responseStartTime: 0, lastBusyAt: 0, isGenerating: true, hasText: false }), false);
  assert.equal(idleFallbackExpired({ now: 500_000, lastActivityTime: 0, lastBusyAt: 0, isGenerating: true, hasText: true }), false);
});
