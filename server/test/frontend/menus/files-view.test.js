import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileRows, rowDetail, rowLink, revealCommand, shownPath, fileBrowserName, revealedLine } from '../../../src/frontend/menus/files-view.js';
import * as paths from '../../../src/backend/core/workspace/paths.js';
import { SessionStore } from '../../../src/backend/storage/session-store.js';

function workspace() {
  const ws = mkdtempSync(join(tmpdir(), 'files-view-'));
  paths.clearPathCache();
  return ws;
}

test('every row is where paths.js keeps it, and a fresh repo says "not yet"', () => {
  const ws = workspace();
  const rows = fileRows(ws);
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.equal(by['Task list'].path, paths.artifactPath(ws, 'task.md'));
  assert.equal(by.Plans.path, paths.planArchiveDir(ws));
  assert.equal(by.Memory.path, paths.memoryDir(ws));
  assert.equal(by['This conversation'].path, paths.conversationsDir(ws), 'none started: the folder it will be in');
  assert.equal(by.Conversations.path, paths.conversationsDir(ws));
  assert.equal(by.Logs.path, paths.logsDir(ws));
  assert.equal(by['Backups for /undo'].path, paths.backupsDir(ws));
  assert.equal(by['Second copy'].path, paths.homeConversationsDir(ws));
  for (const r of rows.filter((x) => x.label !== 'Second copy')) {
    assert.equal(r.exists, false, r.label);
    assert.match(rowDetail(r), / · not yet$/, r.label);
  }
});

test('what a folder holds is counted, and only what it is for', () => {
  const ws = workspace();
  mkdirSync(paths.planArchiveDir(ws), { recursive: true });
  writeFileSync(join(paths.planArchiveDir(ws), 'a.md'), '# a');
  writeFileSync(join(paths.planArchiveDir(ws), 'b.md'), '# b');
  writeFileSync(join(paths.planArchiveDir(ws), 'notes.txt'), 'x');
  mkdirSync(paths.memoryDir(ws), { recursive: true });
  writeFileSync(join(paths.memoryDir(ws), 'one.md'), 'fact');
  writeFileSync(join(paths.memoryDir(ws), '.memory.md'), 'the imported legacy file');
  writeFileSync(paths.artifactPath(ws, 'task.md'), '- [ ] x');
  const by = Object.fromEntries(fileRows(ws).map((r) => [r.label, r]));
  assert.equal(rowDetail(by.Plans), '.agent/artifacts/plans · 2 plans');
  assert.equal(rowDetail(by.Memory), '.agent/memory · 1 fact');
  assert.equal(rowDetail(by['Task list']), '.agent/artifacts/task.md', 'a file says only where it is');
});

test('paths read relative to the repo, ~ under home, whole elsewhere', () => {
  assert.equal(shownPath('/r', '/r/.agent/logs', '/Users/me'), '.agent/logs');
  assert.equal(shownPath('/r', '/Users/me/.agent/workspaces/r-1', '/Users/me'), '~/.agent/workspaces/r-1');
  assert.equal(shownPath('/r', '/Users/meg/x', '/Users/me'), '/Users/meg/x', 'a sibling of home is not under it');
  assert.equal(shownPath('/r', '/opt/x', '/Users/me'), '/opt/x');
});

test('enter shows a file in its folder and opens a folder, by argv', () => {
  const file = { path: '/r/my repo/.agent/artifacts/task.md', kind: 'file', exists: true };
  const dir = { path: '/r/my repo/.agent/logs', kind: 'dir', exists: true };
  assert.deepEqual(revealCommand(file, { platform: 'darwin' }), ['open', ['-R', file.path]]);
  assert.deepEqual(revealCommand(dir, { platform: 'darwin' }), ['open', [dir.path]]);
  assert.deepEqual(revealCommand(file, { platform: 'linux' }), ['xdg-open', ['/r/my repo/.agent/artifacts']]);
  assert.deepEqual(revealCommand(file, { platform: 'win32' }), ['explorer', [`/select,${file.path}`]]);
  assert.equal(fileBrowserName('darwin'), 'Finder');
});

test('a row not written yet opens, and links to, the nearest folder that is', () => {
  const ws = workspace();
  mkdirSync(paths.artifactsDir(ws), { recursive: true });
  const plans = fileRows(ws).find((r) => r.label === 'Plans');
  assert.equal(plans.exists, false);
  assert.deepEqual(revealCommand(plans, { platform: 'darwin' }), ['open', [paths.artifactsDir(ws)]]);
  assert.match(rowLink(plans), /^file:\/\/.*\/\.agent\/artifacts$/);
});

test('/files is a listed command that takes no words, opening its menu', () => {
  const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(src('../../../src/frontend/constants.js'), /name: 'files'/);
  assert.match(src('../../../src/backend/core/turn/slash-commands.js'), /\bfiles: \[\]/);
  assert.match(src('../../../src/frontend/hooks/use-slash-commands.js'), /command === 'files'[\s\S]{0,200}type: 'files'/);
  assert.match(src('../../../src/frontend/components/Menus.jsx'), /activeMenu\?\.type === 'files'/);
});

test('after enter, the title says what opened, and says so when it was the folder above', () => {
  const ws = workspace();
  mkdirSync(paths.agentDir(ws), { recursive: true });
  const rows = Object.fromEntries(fileRows(ws).map((r) => [r.label, r]));
  assert.equal(revealedLine(rows['This conversation']), 'this conversation: not written yet · opened .agent/');
  const store = new SessionStore(ws);
  store.appendTurn({ role: 'user', content: 'hi', timestamp: 1 });
  const again = fileRows(ws).find((r) => r.label === 'This conversation');
  assert.equal(again.path, join(paths.conversationsDir(ws), store.peekLiveId(), 'conversation.jsonl'));
  assert.equal(revealedLine(again), 'shown: this conversation');
  const listed = fileRows(ws).find((r) => r.label === 'Conversations');
  assert.equal(listed.count, '1 conversation', 'a folder holding a conversation counts');
});
