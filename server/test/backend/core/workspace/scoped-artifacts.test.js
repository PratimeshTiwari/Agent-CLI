/**
 * #154: under a shared root, the path the prompt names is the agent's own folder.
 *
 * The prompt says `.agent/artifacts/task.md` to every repo. Resolved against the
 * workspace, that wrote `<repo>/.agent/artifacts/`, where nothing reads: no
 * `▸ task.md` row, no checklist in the next prompt, ctrl+o with nothing to open.
 * And that stray `.agent` was then taken for a root by the next launch.
 * These run the real tools, because each of them resolved the path itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as paths from '../../../../src/backend/core/workspace/paths.js';
import { createFile } from '../../../../src/backend/mcp/tools/create-file.js';
import { editFile } from '../../../../src/backend/mcp/tools/edit-file.js';
import { readFile } from '../../../../src/backend/mcp/tools/read-file.js';
import { listDirectory } from '../../../../src/backend/mcp/tools/list-directory.js';
import { DiffEngine } from '../../../../src/backend/core/edits/diff-engine.js';
import { isAgentArtifact } from '../../../../src/backend/core/edits/artifact-guard.js';
import { requiresApproval } from '../../../../src/backend/core/policy/tool-policy.js';
import { migrateStrayAgentDir } from '../../../../src/backend/core/install/migrate.js';

function mono() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-')));
  const repo = path.join(base, 'repo-1');
  fs.mkdirSync(path.join(base, '.agent'));
  fs.writeFileSync(path.join(base, '.agent', 'config.json'), '{}');
  fs.mkdirSync(repo);
  paths.clearPathCache();
  return { base, repo, artifacts: path.join(base, '.agent', 'repo-1', 'artifacts') };
}

function solo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'solo-')));
  paths.clearPathCache();
  return repo;
}

const context = (workspace) => {
  const diffEngine = new DiffEngine(workspace);
  return { workspace, diffEngine };
};

test('resolveToolPath: the two named folders move with the scope, nothing else does', () => {
  const { base, repo, artifacts } = mono();
  const scoped = path.join(base, '.agent', 'repo-1');
  assert.equal(paths.resolveToolPath(repo, '.agent/artifacts/task.md'), path.join(artifacts, 'task.md'));
  assert.equal(paths.resolveToolPath(repo, './.agent/artifacts/plans/a.md'), path.join(artifacts, 'plans', 'a.md'));
  assert.equal(paths.resolveToolPath(repo, path.join(repo, '.agent/artifacts/task.md')), path.join(artifacts, 'task.md'),
    'the absolute spelling is the same file');
  assert.equal(paths.resolveToolPath(repo, '.agent/tmp/out.txt'), path.join(scoped, 'tmp', 'out.txt'));
  // Controls: each of these must stay exactly where it was.
  assert.equal(paths.resolveToolPath(repo, 'src/a.js'), path.join(repo, 'src/a.js'));
  assert.equal(paths.resolveToolPath(repo, '.agent/skills/x.md'), path.join(repo, '.agent/skills/x.md'));
  assert.equal(paths.resolveToolPath(repo, '.agent/artifacts/../../x.md'), path.join(repo, 'x.md'),
    'a climb out of the folder is not the folder');
  assert.equal(paths.resolveToolPath(repo, '/etc/motd'), '/etc/motd');
});

test('resolveToolPath: an unscoped repo gets what it always got', () => {
  const repo = solo();
  assert.equal(paths.resolveToolPath(repo, '.agent/artifacts/task.md'), path.join(repo, '.agent/artifacts/task.md'));
  assert.equal(paths.resolveToolPath(repo, 'a/b.js'), path.join(repo, 'a/b.js'));
});

test('the tools write and read the file the checklist reads', async () => {
  const { repo, artifacts } = mono();
  const ctx = context(repo);
  const { diffId } = await createFile({ path: '.agent/artifacts/task.md', content: '- [ ] first step\n' }, ctx);
  ctx.diffEngine.acceptDiff(diffId);
  assert.equal(fs.readFileSync(path.join(artifacts, 'task.md'), 'utf8'), '- [ ] first step\n');
  assert.equal(fs.existsSync(path.join(repo, '.agent')), false, 'no folder grows in the repo');
});

test('reading and listing go to the same place', async () => {
  const { repo, artifacts } = mono();
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'task.md'), '- [ ] first step\n');
  const read = await readFile({ path: '.agent/artifacts/task.md' }, { workspace: repo });
  assert.match(JSON.stringify(read), /first step/);
  const listed = await listDirectory({ path: '.agent/artifacts' }, { workspace: repo });
  assert.match(JSON.stringify(listed), /task\.md/);
});

test('an over-budget result can be read back from where the prompt says it is', async () => {
  const { repo } = mono();
  fs.mkdirSync(paths.tmpDir(repo), { recursive: true });
  fs.writeFileSync(path.join(paths.tmpDir(repo), 'result.txt'), 'the full output\n');
  const read = await readFile({ path: '.agent/tmp/result.txt' }, { workspace: repo });
  assert.match(JSON.stringify(read), /the full output/);
});

test('editing goes through the same resolver as creating', async () => {
  const { repo, artifacts } = mono();
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'task.md'), '- [ ] one\n');
  const ctx = context(repo);
  const { diffId } = await editFile({ path: '.agent/artifacts/task.md', append: '- [ ] two\n' }, ctx);
  ctx.diffEngine.acceptDiff(diffId);
  assert.match(fs.readFileSync(path.join(artifacts, 'task.md'), 'utf8'), /- \[ \] two/);
});

test('the approval exemption sees the same file', () => {
  const { repo } = mono();
  assert.equal(isAgentArtifact(repo, '.agent/artifacts/task.md'), true, 'strict and plan asked for every task.md');
  assert.equal(requiresApproval(
    { name: 'create_file', args: { path: '.agent/artifacts/task.md' } }, { mode: 'strict', workspace: repo },
  ), false);
  // Controls: the location test must stay as narrow as it was.
  assert.equal(isAgentArtifact(repo, 'README.md'), false);
  assert.equal(isAgentArtifact(repo, '.agent/artifacts/../../README.md'), false);
  assert.equal(requiresApproval(
    { name: 'create_file', args: { path: 'README.md' } }, { mode: 'strict', workspace: repo },
  ), true);
});

test('a stray is not a root when there is one above it', () => {
  const { base, repo } = mono();
  fs.mkdirSync(path.join(repo, '.agent', 'artifacts'), { recursive: true });
  paths.clearPathCache();
  const state = paths.resolveState(repo);
  assert.equal(state.root, path.join(base, '.agent'));
  assert.equal(state.scope, 'repo-1');
});

test('an .agent holding only artifacts is the root of an ordinary repo', () => {
  const repo = solo();
  fs.mkdirSync(path.join(repo, '.agent', 'artifacts'), { recursive: true });
  paths.clearPathCache();
  const state = paths.resolveState(repo);
  assert.equal(state.root, path.join(repo, '.agent'));
  assert.equal(state.scope, '');
});

test('an .agent with anything of its own is a real root, under a shared one or not', () => {
  const { repo } = mono();
  fs.mkdirSync(path.join(repo, '.agent', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agent', 'config.json'), '{}');
  paths.clearPathCache();
  assert.equal(paths.resolveState(repo).root, path.join(repo, '.agent'), 'a launch filled this one: it is not ours to skip');
});

test('an empty .agent stays a root: someone made it', () => {
  const { repo } = mono();
  fs.mkdirSync(path.join(repo, '.agent'));
  paths.clearPathCache();
  assert.equal(paths.resolveState(repo).root, path.join(repo, '.agent'));
});

test('a stray\'s files come back, once, and overwrite nothing', () => {
  const { base, repo, artifacts } = mono();
  const stray = path.join(repo, '.agent');
  fs.mkdirSync(path.join(stray, 'artifacts', 'plans'), { recursive: true });
  fs.mkdirSync(path.join(stray, 'tmp'));
  fs.writeFileSync(path.join(stray, '.DS_Store'), 'x');
  fs.writeFileSync(path.join(stray, 'artifacts', 'task.md'), 'from the stray');
  fs.writeFileSync(path.join(stray, 'artifacts', 'plans', 'old.md'), 'a plan');
  fs.writeFileSync(path.join(stray, 'tmp', 'r.txt'), 'output');
  paths.clearPathCache();

  const moved = migrateStrayAgentDir(repo);
  assert.equal(moved.length, 3);
  assert.equal(fs.readFileSync(path.join(artifacts, 'task.md'), 'utf8'), 'from the stray');
  assert.equal(fs.readFileSync(path.join(artifacts, 'plans', 'old.md'), 'utf8'), 'a plan');
  assert.equal(fs.readFileSync(path.join(base, '.agent', 'repo-1', 'tmp', 'r.txt'), 'utf8'), 'output');
  assert.equal(fs.existsSync(stray), false);
  assert.deepEqual(migrateStrayAgentDir(repo), [], 'a no-op the second time');
});

test('a file already at the destination stays, and so does the stray\'s copy', () => {
  const { repo, artifacts } = mono();
  const stray = path.join(repo, '.agent');
  fs.mkdirSync(path.join(stray, 'artifacts'), { recursive: true });
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'task.md'), 'newer');
  fs.writeFileSync(path.join(stray, 'artifacts', 'task.md'), 'older');
  paths.clearPathCache();

  assert.deepEqual(migrateStrayAgentDir(repo), []);
  assert.equal(fs.readFileSync(path.join(artifacts, 'task.md'), 'utf8'), 'newer');
  assert.equal(fs.readFileSync(path.join(stray, 'artifacts', 'task.md'), 'utf8'), 'older');
  assert.equal(paths.resolveState(repo).scope, 'repo-1', 'and the leftover is still no root');
});

test('the migration leaves an ordinary repo\'s .agent and a real one alone', () => {
  const repo = solo();
  fs.mkdirSync(path.join(repo, '.agent', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agent', 'artifacts', 'task.md'), 'mine');
  paths.clearPathCache();
  assert.deepEqual(migrateStrayAgentDir(repo), []);
  assert.equal(fs.existsSync(path.join(repo, '.agent', 'artifacts', 'task.md')), true);

  const { repo: filled } = mono();
  fs.mkdirSync(path.join(filled, '.agent', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(filled, '.agent', 'config.json'), '{}');
  fs.writeFileSync(path.join(filled, '.agent', 'artifacts', 'task.md'), 'mine');
  paths.clearPathCache();
  assert.deepEqual(migrateStrayAgentDir(filled), []);
  assert.equal(fs.existsSync(path.join(filled, '.agent', 'artifacts', 'task.md')), true);
});
