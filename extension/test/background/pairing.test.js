import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (name) => readFileSync(new URL(`../../src/background/${name}`, import.meta.url), 'utf8');

test('the token is read only from the exact fragment the agent writes', async () => {
  const body = source('pairing.js');
  const pattern = new RegExp(body.match(/const TOKEN = \/(.+)\/;/)[1]);
  const token = 'a'.repeat(32);
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
