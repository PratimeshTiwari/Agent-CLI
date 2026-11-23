import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (name) => readFileSync(new URL(`../../src/background/${name}`, import.meta.url), 'utf8');

test('the token is read only from the exact fragment the agent writes', async () => {
  const body = source('pairing.js');
  const pattern = new RegExp(body.match(/const TOKEN = \/(.+)\/;/)[1]);
  const token = 'a'.repeat(32);
  assert.equal(`https://gemini.google.com/app#g7k=${token}`.match(pattern)?.[1], token);
  // An older agent's link still pairs (1.72.0 renamed it).
  assert.equal(`https://gemini.google.com/app#agent-pair=${token}`.match(pattern)?.[1], token);
  assert.equal('https://gemini.google.com/app#agent-pair=short'.match(pattern), null);
  assert.equal(`https://gemini.google.com/app?agent-pair=${token}`.match(pattern), null);
});

test('it adds no permission: the id is storage, the link is `tabs`', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions.sort(), ['alarms', 'scripting', 'sidePanel', 'storage', 'tabs']);
});

test('identify carries the id, and the worker looks for a link on connect', () => {
  const socket = source('socket.js');
  assert.match(socket, /installId: install,/);
  assert.match(socket, /reportOpenPairings\(\);/, 'a tab Chrome opened before the worker existed fires no event');
  assert.match(source('main.js'), /reportPairing\(changeInfo\.url, isSocketOpen\(\)\);/);
});

/*
 * 1.72.0: the content script takes the code out of the address, so a worker
 * that was not connected cannot find it there later. It is held instead, and
 * reported on connect.
 */
test('a code read while nothing was connected is held and reported on connect', async () => {
  const session = {};
  globalThis.chrome = {
    storage: {
      session: { get: async (k) => ({ [k]: session[k] }), set: async (o) => Object.assign(session, o) },
      local: { get: async () => ({}), set: async () => {} },
    },
    tabs: { query: async () => [] },
  };
  const pairing = await import('../../src/background/pairing.js');
  const token = 'b'.repeat(32);
  await pairing.reportPairToken(token, false);
  await pairing.reportPairToken('nonsense', false);
  assert.deepEqual(session.heldPairTokens, [token], 'held, and only a real code');
  await pairing.reportOpenPairings();
  assert.deepEqual(session.heldPairTokens, [], 'reported once, not on every connect');
});
