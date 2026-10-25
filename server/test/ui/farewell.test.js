/**
 * Exit leaves the session on screen and prints how to come back.
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
import { farewellText, farewellFor, wantsDim, exitWithFarewell, registerInk, _resetFarewell } from '../../src/ui/farewell.js';
import { SessionStore } from '../../src/storage/session-store.js';
import { AgentLoop } from '../../src/core/agent-loop.js';

const ws = () => mkdtempSync(join(tmpdir(), 'farewell-'));
const say = (store, text) => store.appendTurn({ role: 'user', content: text, timestamp: Date.now() });

test('the text names the command, with --workspace only when it is needed', () => {
  const here = farewellText('2026-10-19T11-00-00-000-abcd', { workspace: '/p', cwd: '/p' });
  assert.match(here, /agent --resume 2026-10-19T11-00-00-000-abcd\n/);
  assert.doesNotMatch(here, /--workspace/);

  const elsewhere = farewellText('x', { workspace: '/my proj', cwd: '/tmp' });
  assert.match(elsewhere, /agent --resume x --workspace '\/my proj'/);
});

test('it is Claude Code\'s footer: blank line, label, command on its own line, prompt right under', () => {
  assert.equal(farewellText('abc', { workspace: '/p', cwd: '/p' }),
    '\nResume this session with:\nagent --resume abc\n');
});

test('dim is per line, and only into a terminal', () => {
  const lines = farewellText('abc', { workspace: '/p', cwd: '/p', dim: true }).split('\n');
  assert.deepEqual(lines, ['', '\x1b[2mResume this session with:\x1b[22m', '\x1b[2magent --resume abc\x1b[22m', '']);
  assert.equal(wantsDim({ isTTY: true }), true);
  assert.equal(wantsDim({ isTTY: false }), false, 'a pipe gets plain text');
  assert.equal(wantsDim({}), false);
});

test('no conversation, no resume command', () => {
  const store = new SessionStore(ws());
  assert.doesNotMatch(farewellFor({ sessionStore: store }), /--resume/);
  // A file-watcher event is not a conversation either — the same rule rollover uses.
  store.appendTurn({ role: 'system', content: '[System Event] File x was modified' });
  assert.doesNotMatch(farewellFor({ sessionStore: store }), /--resume/);
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

test('exit: erase the live frame, unmount, then the command — and never clear the screen', async () => {
  _resetFarewell();
  const order = [];
  registerInk({ clear: () => order.push('clear'), unmount: () => order.push('unmount') });
  const store = new SessionStore(ws());
  say(store, 'hello');
  const out = { write: (s) => order.push(s) };
  const codes = [];
  await exitWithFarewell({ agentLoop: { sessionStore: store }, out, exit: (c) => codes.push(c) });
  await exitWithFarewell({ agentLoop: { sessionStore: store }, out, exit: (c) => codes.push(c) });

  assert.deepEqual(order.slice(0, 2), ['clear', 'unmount'], 'unmounting first repaints the prompt box into the scrollback');
  assert.doesNotMatch(order[2], /\x1b\[2J|\x1b\[3J/, 'the transcript must survive exit, like Claude Code');
  assert.match(order[2], /agent --resume /);
  assert.deepEqual(codes, [0], 'a second ctrl+c during shutdown does not print it twice');
  _resetFarewell();
});

test('exit with nothing to resume: one blank row, no words', async () => {
  _resetFarewell();
  registerInk({ clear() {}, unmount() {} });
  const written = [];
  // Only a slash command was run: rows on screen, but no conversation.
  await exitWithFarewell({ agentLoop: { sessionStore: new SessionStore(ws()) }, out: { write: (s) => written.push(s) }, exit: () => {} });
  assert.deepEqual(written, ['\n'], 'the prompt sat flush against the last row');
  _resetFarewell();
});
