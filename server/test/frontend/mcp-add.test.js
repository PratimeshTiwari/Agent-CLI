import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandLine, fitCommand, startAdd, stepBack, submitName, submitPaste, submitValue, testedLine } from '../../src/frontend/menus/mcp-add.js';

const JSON_TEXT = '{ "gh": { "command": "npx", "args": ["-y", "foo"], "env": { "A_TOKEN": "<TOKEN>", "REGION": "" } } }';

test('paste, name, each value, then the check', () => {
  let s = submitPaste(startAdd(), JSON_TEXT, { env: {} });
  assert.equal(s.step, 'name');
  assert.equal(s.name, 'gh');
  s = submitName(s, 'gh');
  assert.equal(s.step, 'value');
  assert.deepEqual(s.plan.ask[s.at], { key: 'A_TOKEN', hidden: true });
  s = submitValue(s, '  secret  ');
  assert.equal(s.at, 1);
  s = submitValue(s, 'eu');
  assert.equal(s.step, 'check');
  assert.deepEqual(s.values, { A_TOKEN: 'secret', REGION: 'eu' });
});

test('no values to ask for goes straight to the check, which always comes before anything runs', () => {
  const s = submitName(submitPaste(startAdd(), 'npx -y foo'), 'foo');
  assert.equal(s.step, 'check');
  assert.equal(commandLine(s.entry), 'npx -y foo');
});

test('a bad step stays where it is and says why', () => {
  const pasted = submitPaste(startAdd(), 'a "b');
  assert.equal(pasted.step, 'paste');
  assert.match(pasted.error, /quote/);
  assert.equal(pasted.text, 'a "b');
  const named = submitPaste(startAdd(), 'npx foo');
  assert.match(submitName(named, 'foo', { taken: ['foo'] }).error, /already/);
  const value = submitName(submitPaste(startAdd(), JSON_TEXT), 'gh');
  assert.equal(submitValue(value, '   ').step, 'value');
});

test('esc goes back a step at a time, and off the first step leaves', () => {
  let s = submitName(submitPaste(startAdd(), JSON_TEXT, { env: {} }), 'gh');
  s = submitValue(submitValue(s, 'a'), 'b');
  s = stepBack(s);
  assert.deepEqual([s.step, s.at], ['value', 1]);
  s = stepBack(s);
  assert.deepEqual([s.step, s.at], ['value', 0]);
  s = stepBack(s);
  assert.equal(s.step, 'name');
  s = stepBack(s);
  assert.equal(s.step, 'paste');
  assert.equal(s.text, JSON_TEXT, 'what was pasted is still there');
  assert.equal(stepBack(s), null);
  assert.equal(stepBack({ step: 'tested', result: {} }).step, 'check');
});

test('the command is shown whole, and when it cannot be its end survives', () => {
  const line = `${'a'.repeat(30)} evil-at-the-end`;
  assert.equal(fitCommand(line, 12, 9).join(''), line, 'it wraps when there is room');
  const cut = fitCommand(line, 12, 2);
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith('the-end') && cut[1].startsWith('…'), cut[1]);
  const one = fitCommand(line, 40, 1);
  assert.equal(one.length, 1);
  assert.ok(one[0].startsWith('aaa') && one[0].endsWith('the-end'), one[0]);
  assert.ok(one[0].length <= 38);
});

test('testedLine', () => {
  assert.equal(testedLine({ ok: true, tools: [{ name: 'a' }] }), '✔ 1 tool: a');
  assert.match(testedLine({ ok: true, tools: ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name })) }), /5 tools: a, b, c, d, …/);
  assert.equal(testedLine({ ok: false, error: 'nope' }), '✗ nope');
});

test('the field asks for bracketed paste itself: behind a menu nothing else has', () => {
  const read = (p) => readFileSync(new URL(`../../src/frontend/components/${p}`, import.meta.url), 'utf8');
  assert.match(read('McpAdd.jsx'), /usePaste\(\(text\) => set\(text\)\);/);
  assert.match(read('InputBar.jsx'), /\{ isActive: promptVisible && focus === FOCUS_INPUT \}/, 'the premise: the prompt lets go of it');
});
