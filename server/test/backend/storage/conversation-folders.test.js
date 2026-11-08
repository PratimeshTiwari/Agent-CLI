/**
 * One folder per conversation (v9.9.2). Asked for after the owner looked in
 * `.agent/sessions/` and found `sessions/sessions/`, `archive.jsonl`,
 * `history.jsonl`, `history 2.jsonl`, `index.jsonl` and `session-meta.json`:
 * "what is all this … can we have a better arrangement".
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SessionStore, currentConversationFile, isConversationId } from '../../../src/backend/storage/session-store.js';
import * as paths from '../../../src/backend/core/workspace/paths.js';

let dir, savedHome;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'conv-'));
  savedHome = process.env.AGENT_CLI_HOME;
  process.env.AGENT_CLI_HOME = join(dir, 'home');
  paths.clearPathCache();
});
afterEach(() => {
  if (savedHome === undefined) delete process.env.AGENT_CLI_HOME;
  else process.env.AGENT_CLI_HOME = savedHome;
  rmSync(dir, { recursive: true, force: true });
});

const say = (store, content, ts = 1) => store.appendTurn({ role: 'user', content, timestamp: ts });
const root = () => paths.conversationsDir(dir);

test('the first turn starts a folder named by the id exit will print', () => {
  const store = new SessionStore(dir);
  assert.equal(store.peekLiveId(), null, 'nothing yet, no folder yet');
  say(store, 'hello');
  const id = store.peekLiveId();
  assert.ok(isConversationId(id));
  assert.equal(currentConversationFile(dir), join(root(), id, 'conversation.jsonl'));
  assert.equal(store.liveId(), id);
  assert.ok(existsSync(join(paths.homeConversationsDir(dir), id, 'conversation.jsonl')), 'and the home copy');
});

test('filing copies nothing: the folder is where the conversation already was', () => {
  const store = new SessionStore(dir);
  say(store, 'walk me through the bridge');
  const file = currentConversationFile(dir);
  const before = statSync(file).ino;
  const id = store.rollover();
  store.clear();
  assert.equal(statSync(join(root(), id, 'conversation.jsonl')).ino, before, 'the same file, not a copy');
  assert.equal(currentConversationFile(dir), null, 'and nothing is current until the next turn');
  assert.deepEqual(readdirSync(root()).sort(), [id, 'index.jsonl'].sort());
});

test('/clear and file-watcher noise leave no folder behind; a filed one stays', () => {
  const store = new SessionStore(dir);
  store.appendTurn({ role: 'system', type: 'fs_event', content: '[System Event] x', timestamp: 1 });
  const noise = store.peekLiveId();
  assert.equal(store.rollover(), null);
  store.clear();
  assert.equal(existsSync(join(root(), noise)), false, 'a folder of file events is not a conversation');

  say(store, 'keep this');
  const kept = store.rollover();
  store.resumeSession(kept);
  say(store, 'and this', 2);
  store.clear();
  assert.equal(existsSync(join(root(), kept, 'conversation.jsonl')), true, 'a filed conversation is never removed by /clear');
});

test('--resume files the conversation in progress instead of overwriting it', () => {
  const store = new SessionStore(dir);
  say(store, 'the old one');
  const old = store.rollover();
  store.clear();
  say(store, 'the one in progress');
  const inProgress = store.peekLiveId();

  const turns = store.resumeSession(old);
  assert.equal(turns[0].content, 'the old one');
  assert.equal(store.peekLiveId(), old);
  assert.ok(store.listSessions().some((r) => r.id === inProgress), 'the conversation in progress was lost');
});

test('an id is a folder name and nothing more', () => {
  const store = new SessionStore(dir);
  for (const bad of ['..', '../x', 'a/b', '', null, '.']) assert.equal(store.resumeSession(bad), null, String(bad));
  assert.ok(isConversationId('2026-09-16T19-50-53-639-7r4r'));
});

test('a wiped .agent/ comes back from the home copy: pointer, conversation and list', () => {
  const store = new SessionStore(dir);
  say(store, 'filed');
  const filed = store.rollover();
  store.clear();
  say(store, 'in progress', 2);
  store.setThread({ model: 'gemini', id: 'abc123' });
  const id = store.peekLiveId();
  rmSync(join(dir, '.agent'), { recursive: true, force: true });

  const fresh = new SessionStore(dir);
  assert.equal(fresh.peekLiveId(), id);
  assert.equal(fresh.loadHistory()[0].content, 'in progress');
  assert.equal(fresh.getThread().id, 'abc123');
  assert.ok(existsSync(join(root(), id, 'conversation.jsonl')), 'restored into the workspace');
  assert.deepEqual(fresh.listSessions().map((r) => r.id), [filed]);
});

test('a filed conversation\'s plans go in its folder', () => {
  const store = new SessionStore(dir);
  say(store, 'plan something');
  paths.ensureDir(paths.artifactsDir(dir));
  const task = paths.artifactPath(dir, 'task.md');
  writeFileSync(task, '- [x] done\n');
  const id = store.rollover();
  assert.equal(readFileSync(join(root(), id, 'plans', 'task.md'), 'utf8'), '- [x] done\n');
});

