/**
 * `sessions/` → `conversations/` (v9.9.2). The fixture is the old layout as
 * `session-store.js` wrote it before v9.9.2 and as this repo's own `.agent/`
 * held it on 2026-11-08, conflict copy included.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateConversations } from '../../../../src/backend/core/install/migrate-conversations.js';
import { SessionStore } from '../../../../src/backend/storage/session-store.js';
import * as paths from '../../../../src/backend/core/workspace/paths.js';

let ws, savedHome;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'migconv-'));
  savedHome = process.env.AGENT_CLI_HOME;
  process.env.AGENT_CLI_HOME = join(ws, 'home');
  paths.clearPathCache();
});
afterEach(() => {
  if (savedHome === undefined) delete process.env.AGENT_CLI_HOME;
  else process.env.AGENT_CLI_HOME = savedHome;
  rmSync(ws, { recursive: true, force: true });
});

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const user = (content, timestamp) => ({ role: 'user', content, timestamp });
const OLD = '2026-09-16T19-50-53-639-7r4r';
const RESUMED = '2026-11-05T18-47-48-304-6par';
const LIVE_ONLY = '2026-11-08T10-00-00-000-live';

/** The old layout, in one folder: what `sessions/` held, or the home folder did. */
function oldLayout(dir, { live = true } = {}) {
  mkdirSync(join(dir, 'sessions', `${OLD}-artifacts`), { recursive: true });
  writeFileSync(join(dir, 'sessions', `${OLD}.jsonl`), jsonl([user('first ever', 1)]));
  writeFileSync(join(dir, 'sessions', `${OLD}-artifacts`, 'task.md'), '- [x] old\n');
  writeFileSync(join(dir, 'sessions', `${RESUMED}.jsonl`), jsonl([user('resumed', 2)]));
  writeFileSync(join(dir, 'index.jsonl'), jsonl([
    { id: OLD, title: 'first ever', thread: { model: 'gemini', id: 't-old' } },
    { id: RESUMED, title: 'resumed', thread: null },
  ]));
  if (live) {
    // Resumed, then talked in: the live copy is the filed one plus more.
    writeFileSync(join(dir, 'history.jsonl'), jsonl([user('resumed', 2), user('and then more', 3)]));
    writeFileSync(join(dir, 'session-meta.json'), JSON.stringify({ liveId: RESUMED, thread: { model: 'gemini', id: 't-live' } }));
  }
}

test('the workspace copy: one folder per conversation, the list, the compacted turns, the current one', () => {
  const old = paths.oldSessionsDir(ws);
  oldLayout(old);
  writeFileSync(join(old, 'archive.jsonl'), jsonl([user('compacted away', 0)]));
  writeFileSync(join(old, 'history 2.jsonl'), jsonl([user('a conflict copy', 9)]));
  writeFileSync(join(old, '.DS_Store'), '');

  const result = migrateConversations(ws);
  const root = paths.conversationsDir(ws);

  assert.equal(existsSync(old), false, 'sessions/ is gone');
  assert.equal(readFileSync(join(root, OLD, 'conversation.jsonl'), 'utf8'), jsonl([user('first ever', 1)]));
  assert.equal(readFileSync(join(root, OLD, 'plans', 'task.md'), 'utf8'), '- [x] old\n');
  assert.deepEqual(JSON.parse(readFileSync(join(root, OLD, 'chat.json'), 'utf8')).thread, { model: 'gemini', id: 't-old' });
  assert.equal(readFileSync(join(root, 'compacted.jsonl'), 'utf8'), jsonl([user('compacted away', 0)]));
  assert.ok(existsSync(join(root, 'index.jsonl')));

  // The resumed conversation: the longer, live copy is kept.
  assert.equal(readFileSync(join(root, RESUMED, 'conversation.jsonl'), 'utf8').split('\n').filter(Boolean).length, 2);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')), { id: RESUMED });

  // Nothing deleted: the shorter copy, the conflict copy and the old meta are in the trash.
  assert.ok(result.trash.startsWith(join(paths.homeDir(), 'trash')));
  const trashed = readdirSync(join(result.trash, 'repo')).sort();
  assert.deepEqual(trashed, [`${RESUMED}.conversation.jsonl`, 'history 2.jsonl', 'session-meta.json'].sort());
});

test('the store reads the migrated tree as it read the old one', () => {
  oldLayout(paths.oldSessionsDir(ws));
  migrateConversations(ws);
  const store = new SessionStore(ws);
  assert.equal(store.peekLiveId(), RESUMED, 'the id exit printed still resumes it');
  assert.equal(store.loadHistory().length, 2);
  assert.equal(store.getThread().id, 't-live');
  assert.deepEqual(store.listSessions().map((r) => r.id), [RESUMED, OLD]);
  store.rollover();
  store.clear();
  assert.equal(store.resumeSession(OLD)[0].content, 'first ever');
  assert.ok(existsSync(paths.artifactPath(ws, 'task.md')), 'its plan came back with it');
});

test('the home copy: only the old names move, and its own conversations/ is left as it is', () => {
  const home = paths.workspaceHomeDir(ws);
  oldLayout(home);
  writeFileSync(join(home, 'something-else.json'), '{}');
  migrateConversations(ws);
  const root = paths.homeConversationsDir(ws);
  assert.ok(existsSync(join(root, OLD, 'conversation.jsonl')));
  assert.ok(existsSync(join(root, 'current.json')));
  for (const name of ['history.jsonl', 'session-meta.json', 'index.jsonl', 'sessions']) {
    assert.equal(existsSync(join(home, name)), false, `${name} stayed in the home folder`);
  }
  assert.ok(existsSync(join(home, 'something-else.json')), 'an entry it does not know is not its to move');
});

test('a live conversation filed under no id gets one; a second run does nothing', () => {
  const old = paths.oldSessionsDir(ws);
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, 'history.jsonl'), jsonl([user('never filed', 5)]));
  const first = migrateConversations(ws);
  assert.ok(first.moved.length > 0);
  const store = new SessionStore(ws);
  assert.equal(store.loadHistory()[0].content, 'never filed');

  const again = migrateConversations(ws);
  assert.deepEqual(again.moved, [], 'a second start moves nothing');
  assert.equal(new SessionStore(ws).loadHistory()[0].content, 'never filed');
});

test('a file already at its destination is never overwritten', () => {
  const root = paths.conversationsDir(ws);
  mkdirSync(join(root, LIVE_ONLY), { recursive: true });
  writeFileSync(join(root, LIVE_ONLY, 'conversation.jsonl'), jsonl([user('newer layout', 1), user('longer', 2), user('still', 3)]));
  const old = paths.oldSessionsDir(ws);
  mkdirSync(join(old, 'sessions'), { recursive: true });
  writeFileSync(join(old, 'sessions', `${LIVE_ONLY}.jsonl`), jsonl([user('older', 1)]));
  const result = migrateConversations(ws);
  assert.match(readFileSync(join(root, LIVE_ONLY, 'conversation.jsonl'), 'utf8'), /newer layout/);
  assert.deepEqual(readdirSync(join(result.trash, 'repo')), ['sessions'], 'the older copy went to the trash with its folder');
});

test('nothing to migrate: no conversations/ is made and no trash folder either', () => {
  const result = migrateConversations(ws);
  assert.deepEqual(result, { moved: [], leftovers: [], trash: null });
  assert.equal(existsSync(paths.conversationsDir(ws)), false);
});

test('runMigrations calls it, after the stray-folder move (source)', () => {
  const src = readFileSync(new URL('../../../../src/backend/core/install/migrate.js', import.meta.url), 'utf8');
  assert.ok(src.indexOf('migrateConversations(workspace)') > src.indexOf('migrateStrayAgentDir(workspace);'));
});
