/** `/mcp`'s rows (v9.0). */
import { statusLine } from '../../src/backend/mcp/client/integrations.js';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mcpHomeItems, serverToolItems, homeLine, ALLOW_ITEMS, serverOrigin,
} from '../../src/frontend/menus/mcp-view.js';

const T = { danger: 'red', attention: 'yellow' };
const row = (over) => ({ name: 's', state: 'ready', tools: [{ name: 'echo', description: 'one\ntwo' }], ...over });
const list = (rows, over = {}) => ({ path: '/x/mcp.json', exists: true, error: null, rows, ...over });

test('each row says its state, and a failure says why', () => {
  const items = mcpHomeItems(list([
    row({ name: 'up' }),
    row({ name: 'down', state: 'failed', error: 'bad token', tools: [] }),
    row({ name: 'wait', state: 'connecting', tools: [] }),
  ]), { T });
  assert.equal(items[0].value, 'add');
  assert.equal(items[1].detail, 'connected · 1 tool');
  assert.equal(items[2].detail, 'failed · bad token');
  assert.equal(items[2].colour, 'red');
  assert.equal(items[3].detail, 'starting');
  assert.equal(items[3].colour, 'yellow');
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
  assert.equal(none.value, 'add', 'no file yet: adding is the first thing on offer');
  assert.ok(!mcpHomeItems(list([], { error: 'x' }), { T }).some((i) => i.value === 'add'), 'a file that cannot be read cannot be added to');
  assert.ok(!mcpHomeItems(list([row()]), { T }).some((i) => i.label === 'mcp.json'), 'control: a good file has no such row');
});

test('off v5 the line says so, and a row offers the switch', () => {
  assert.match(homeLine(list([row()]), { needsPrompt: true }), /prompt v5/);
  assert.doesNotMatch(homeLine(list([row()])), /prompt v5/);
  const offer = (rows, needsPrompt) => mcpHomeItems(list(rows), { needsPrompt }).some((i) => i.value === 'prompt');
  assert.equal(offer([row()], true), true);
  assert.equal(offer([row()], false), false, 'control: already on it');
  assert.equal(offer([row({ state: 'disabled' })], true), false, 'nothing usable to offer');
  assert.equal(offer([row({ builtin: true })], true), false, 'Jira alone is not a reason');
});

test('a custom server has switches, and a built-in has none', () => {
  const switchOf = (tool) => (tool === 'echo' ? 'auto' : 'ask');
  const items = serverToolItems(row(), { switchOf });
  assert.deepEqual(items.map((i) => [i.label, i.value, i.action]), [
    ['New tools', '*', undefined], ['Turn off', '', 'toggle'], ['Remove', '', 'remove'], ['echo', 'echo', undefined],
  ]);
  assert.equal(new Set(items.map((i) => i.key ?? i.value)).size, items.length, 'every row its own React key');
  assert.equal(items[0].detail.split(' · ')[0], 'ask');
  assert.equal(items[3].detail, 'auto · one');
  assert.equal(serverToolItems(row({ state: 'disabled', tools: [] }), { switchOf })[1].label, 'Turn on');
  assert.deepEqual(serverToolItems(row({ state: 'invalid', tools: [] }), { switchOf }).map((i) => i.label), ['No tools', 'Remove'], 'a broken entry can still be removed');
  const jira = serverToolItems(row({ builtin: true }), { switchOf });
  assert.ok(jira.every((i) => i.value === ''), 'its writes always ask');
});

test('a status is drawn once, wherever it had room', () => {
  const failed = row({ tools: [], state: 'failed', error: 'x' });
  assert.equal(serverToolItems(failed, { said: true })[0].detail, '');
  assert.equal(serverToolItems(failed, { said: false })[0].detail, 'failed · x');
});

test('a repo\'s server waits, the first answer runs nothing, and it has no mcp.json actions', () => {
  const row = { name: 's', source: 'repo', state: 'unapproved', tools: [], error: null, changed: false };
  const items = mcpHomeItems({ rows: [row], exists: false, repo: { exists: true, error: null, shadowed: [] } }, { T: { attention: 'A' }, needsPrompt: true });
  const found = items.find((i) => i.label === 's');
  assert.match(found.detail, /needs your ok/);
  assert.equal(found.colour, 'A');
  assert.ok(!items.some((i) => i.value === 'prompt'), 'nothing to teach the chat yet');
  assert.ok(items.some((i) => i.value === 'reload'), 'a repo file alone can be reloaded');
  assert.match(statusLine({ ...row, changed: true }), /changed/);
  assert.equal(ALLOW_ITEMS[0].value, 'no');
  const page = serverToolItems({ ...row, state: 'ready', tools: [{ name: 't' }] }, { switchOf: () => 'ask' });
  assert.ok(page.some((i) => i.action === 'forget'));
  assert.ok(!page.some((i) => i.action === 'remove' || i.action === 'toggle'));
  const mine = serverToolItems({ name: 'm', source: 'user', state: 'ready', tools: [{ name: 't' }] }, { switchOf: () => 'ask' });
  assert.ok(mine.some((i) => i.action === 'remove'), 'control');
  assert.equal(serverOrigin(row), '.mcp.json · this repo');
});

test('a broken .mcp.json and a shadowed name are rows', () => {
  const items = mcpHomeItems({ rows: [], exists: true, repo: { exists: true, error: 'not valid JSON', shadowed: ['gh'] } }, { T: { danger: 'D' } });
  assert.equal(items.find((i) => i.label === '.mcp.json').colour, 'D');
  assert.match(items.find((i) => i.label === 'gh').detail, /yours is the one used/);
});

describe('Atlassian\'s page (v9.9)', () => {
  const row = (state, tools = []) => ({ name: 'atlassian', atlassian: true, source: 'builtin', state, tools });

  it('signed out: one row, Sign in, and the home row says what it is', () => {
    const items = serverToolItems(row('signed_out'));
    assert.deepEqual(items.map((i) => i.action), ['signin']);
    assert.match(statusLine(row('signed_out')), /Jira and Confluence Cloud · not signed in/);
    assert.equal(serverOrigin(row('signed_out')), 'built in');
  });

  it('signed in: Sign out, then each tool as a read that runs or a write that always asks, with no switch', () => {
    const items = serverToolItems(row('ready', [
      { name: 'getJiraIssue', description: 'reads' },
      { name: 'createJiraIssue', description: 'writes' },
      { name: 'somethingNew', description: '?' },
    ]), { switchOf: () => 'auto' });
    assert.equal(items[0].action, 'signout');
    assert.match(items[1].detail, /^reads, runs/);
    assert.match(items[2].detail, /^always asks, in every mode/);
    assert.match(items[3].detail, /^always asks, in every mode/);
    assert.ok(items.slice(1).every((i) => i.value === ''), 'enter changes nothing on a tool');
    assert.ok(!items.some((i) => /auto/.test(i.detail)), 'no switch is shown');
  });

  it('a signed-out Atlassian does not offer the prompt switch', () => {
    const items = mcpHomeItems({ exists: true, rows: [row('signed_out')] }, { needsPrompt: true });
    assert.ok(!items.some((i) => i.value === 'prompt'));
  });
});
