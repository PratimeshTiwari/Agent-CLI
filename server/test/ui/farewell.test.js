/**
 * Exit clears the screen and prints how to come back.
 *
 * And the id it prints is a real one: it resumes now, it is the id the
 * conversation is later filed under, and resuming a filed conversation keeps
 * it. An exit message that offers a command which resumes nothing is worse
 * than none.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { farewellText, farewellFor, exitWithFarewell, registerInk, _resetFarewell, CLEAR_SCREEN } from '../../src/ui/farewell.js';
import { SessionStore } from '../../src/storage/session-store.js';
import { AgentLoop } from '../../src/core/agent-loop.js';

const ws = () => mkdtempSync(join(tmpdir(), 'farewell-'));
const say = (store, text) => store.appendTurn({ role: 'user', content: text, timestamp: Date.now() });

test('the text names the command, with --workspace only when it is needed', () => {
  const here = farewellText('2026-10-19T11-00-00-000-abcd', { workspace: '/p', cwd: '/p' });
  assert.match(here, /agent --resume 2026-10-19T11-00-00-000-abcd\n/);
  assert.match(here, /agent --continue/);
  assert.doesNotMatch(here, /--workspace/);

  const elsewhere = farewellText('x', { workspace: '/my proj', cwd: '/tmp' });
  assert.match(elsewhere, /agent --resume x --workspace '\/my proj'/);
});

test('no conversation, no resume command', () => {
  const store = new SessionStore(ws());
  assert.match(farewellFor({ sessionStore: store }), /Nothing to resume/);
  // A file-watcher event is not a conversation either — the same rule rollover uses.
  store.appendTurn({ role: 'system', content: '[System Event] File x was modified' });
  assert.match(farewellFor({ sessionStore: store }), /Nothing to resume/);
});

test('the printed id is stable, and is the id the conversation is filed under', () => {
  const store = new SessionStore(ws());
  say(store, 'fix the parser');
  const atExit = farewellFor({ sessionStore: store }).match(/--resume (\S+)/)[1];
  assert.equal(store.liveId(), atExit, 'asking twice gives one id');

  const filed = store.rollover();
  assert.equal(filed, atExit, '/history shows the id the exit printed');
  store.clear();
  assert.equal(store.peekLiveId(), null, 'the next conversation gets its own');
});

test('--resume <the printed id> before it is filed is --continue', () => {
  const workspace = ws();
  const store = new SessionStore(workspace);
  say(store, 'fix the parser');
  const id = store.liveId();

  const loop = new AgentLoop({ workspace, mcpServer: {}, promptBuilder: {}, diffEngine: {}, riskClassifier: {}, resumeSessionId: id });
  assert.equal(loop.sessionStore.loadHistory().length, 1, 'the live history is kept, not replaced by a missing archive');
  assert.equal(loop._resumeOnConnect, true, 'and the tab is pointed back at its thread');
});

test('--resume <the printed id> after a later launch filed it still works', () => {
  const workspace = ws();
  const store = new SessionStore(workspace);
  say(store, 'fix the parser');
  const id = store.liveId();
  new AgentLoop({ workspace, mcpServer: {}, promptBuilder: {}, diffEngine: {}, riskClassifier: {} }); // plain launch files it

  const back = new AgentLoop({ workspace, mcpServer: {}, promptBuilder: {}, diffEngine: {}, riskClassifier: {}, resumeSessionId: id });
  assert.equal(back.sessionStore.loadHistory()[0].content, 'fix the parser');
  assert.equal(back.sessionStore.peekLiveId(), id, 'a resumed conversation keeps its id');
});

test('re-filing a resumed conversation updates its row instead of adding a copy', () => {
  const store = new SessionStore(ws());
  say(store, 'first');
  const id = store.rollover();
  store.clear();
  store.resumeSession(id);
  say(store, 'second');
  assert.equal(store.rollover(), id);
  const rows = store.listSessions().filter((r) => r.id === id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].turns, 2, 'the newest record wins');
});

test('exit: unmount first, then clear, then the command — once', async () => {
  _resetFarewell();
  const order = [];
  registerInk({ unmount: () => order.push('unmount') });
  const store = new SessionStore(ws());
  say(store, 'hello');
  const out = { write: (s) => order.push(s) };
  const codes = [];
  await exitWithFarewell({ agentLoop: { sessionStore: store }, out, exit: (c) => codes.push(c) });
  await exitWithFarewell({ agentLoop: { sessionStore: store }, out, exit: (c) => codes.push(c) });

  assert.equal(order[0], 'unmount', 'an unmount after the clear repaints the last frame over it');
  assert.ok(order[1].startsWith(CLEAR_SCREEN));
  assert.match(order[1], /agent --resume /);
  assert.deepEqual(codes, [0], 'a second ctrl+c during shutdown does not print it twice');
  _resetFarewell();
});
