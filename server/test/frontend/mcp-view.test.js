/** `/mcp`'s rows (v9.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpHomeItems, serverToolItems, homeLine } from '../../src/frontend/menus/mcp-view.js';

const T = { danger: 'red', attention: 'yellow' };
const row = (over) => ({ name: 's', state: 'ready', tools: [{ name: 'echo', description: 'one\ntwo' }], ...over });
const list = (rows, over = {}) => ({ path: '/x/mcp.json', exists: true, error: null, rows, ...over });

test('each row says its state, and a failure says why', () => {
  const items = mcpHomeItems(list([
    row({ name: 'up' }),
    row({ name: 'down', state: 'failed', error: 'bad token', tools: [] }),
    row({ name: 'wait', state: 'connecting', tools: [] }),
  ]), { T });
  assert.equal(items[0].detail, 'connected · 1 tool');
  assert.equal(items[1].detail, 'failed · bad token');
  assert.equal(items[1].colour, 'red');
  assert.equal(items[2].detail, 'starting');
  assert.equal(items[2].colour, 'yellow');
});

test('Reload only when there is a file to read', () => {
  assert.equal(mcpHomeItems(list([row()])).at(-1).value, 'reload');
  assert.ok(!mcpHomeItems(list([row()], { exists: false })).some((i) => i.value === 'reload'));
});

test('a description is its first line: rows do not wrap', () => {
  assert.equal(serverToolItems(row())[0].detail, 'one');
});

test('a server with no tools still says something', () => {
  assert.equal(serverToolItems(row({ tools: [], state: 'failed', error: 'x' }))[0].detail, 'failed · x');
});

test('a fault or a missing file is a row: the line above is shed on a short terminal', () => {
  const broken = mcpHomeItems(list([], { error: 'not valid JSON' }), { T })[0];
  assert.deepEqual([broken.detail, broken.value, broken.colour], ['not valid JSON', '', 'red']);
  const none = mcpHomeItems(list([], { exists: false }))[0];
  assert.match(`${none.label} ${none.detail}`, /No servers yet add them to .*mcp\.json/);
  assert.equal(none.value, '', 'nothing to open');
  assert.ok(!mcpHomeItems(list([row()]), { T }).some((i) => i.label === 'mcp.json'), 'control: a good file has no such row');
});

test('the line says the model has none of this yet', () => {
  assert.match(homeLine(list([row()])), /cannot call these yet/);
});

test('a status is drawn once, wherever it had room', () => {
  const failed = row({ tools: [], state: 'failed', error: 'x' });
  assert.equal(serverToolItems(failed, { said: true })[0].detail, '');
  assert.equal(serverToolItems(failed, { said: false })[0].detail, 'failed · x');
});
