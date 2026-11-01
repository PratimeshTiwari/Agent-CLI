/**
 * `/reset` moves this repo's agent state to the trash — only this repo's, and
 * only what is known to be agent state.
 *
 * The negative controls are the point: a reset that empties a monorepo's
 * root `.agent/` takes every sibling repo's history with it, and one that
 * deletes rather than moves cannot be taken back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planReset, applyReset } from '../../../../src/backend/core/install/reset.js';
import { describeDestructive } from '../../../../src/frontend/menus/destructive.js';
import { clearPathCache, homeDir, workspaceHomeDir } from '../../../../src/backend/core/workspace/paths.js';

function populate(stateDir) {
  for (const d of ['sessions', 'logs', 'artifacts', 'state', 'skills', 'data']) {
    fs.mkdirSync(join(stateDir, d), { recursive: true });
  }
  fs.writeFileSync(join(stateDir, 'sessions', 'history.jsonl'), '{"role":"user"}\n');
  fs.writeFileSync(join(stateDir, 'config.json'), '{"mode":"auto"}');
  fs.writeFileSync(join(stateDir, 'memory.md'), '- fact');
  fs.writeFileSync(join(stateDir, 'skills', 'mine.md'), 'a skill a person wrote');
}

function repo() {
  const ws = fs.mkdtempSync(join(tmpdir(), 'reset-'));
  populate(join(ws, '.agent'));
  clearPathCache();
  fs.mkdirSync(workspaceHomeDir(ws), { recursive: true });
  fs.writeFileSync(join(workspaceHomeDir(ws), 'history.jsonl'), '{"role":"user"}\n');
  return ws;
}

test('a reset moves the agent state and the ~/.agent history copy', () => {
  const ws = repo();
  const plan = planReset(ws);
  const names = plan.moves.map((m) => m.name).sort();
  assert.deepEqual(names, ['artifacts', 'config.json', 'logs', 'memory.md', 'sessions', 'state', '~/.agent history copy']);
  assert.ok(plan.trashDir.startsWith(join(homeDir(), 'trash')));

  const { moved, failed } = applyReset(plan);
  assert.equal(failed, null);
  assert.equal(moved.length, names.length);
  assert.equal(fs.existsSync(join(ws, '.agent', 'sessions')), false);
  assert.equal(fs.existsSync(workspaceHomeDir(ws)), false, 'the copy that survives a wiped repo must go too');
  // Moved, not deleted: the history is readable in the trash.
  assert.equal(fs.readFileSync(join(plan.trashDir, 'repo', 'sessions', 'history.jsonl'), 'utf8'), '{"role":"user"}\n');
  assert.ok(fs.existsSync(join(plan.trashDir, 'home', 'history.jsonl')));
});

test('control: what a person wrote, and anything unknown, stays', () => {
  const ws = repo();
  const plan = planReset(ws);
  assert.deepEqual(plan.kept, ['data', 'skills']);
  applyReset(plan);
  assert.equal(fs.readFileSync(join(ws, '.agent', 'skills', 'mine.md'), 'utf8'), 'a skill a person wrote');
  assert.ok(fs.existsSync(join(ws, '.agent', 'data')));
});

test('--keep-settings keeps config and memory', () => {
  const ws = repo();
  const plan = planReset(ws, { keepSettings: true });
  const names = plan.moves.map((m) => m.name);
  assert.ok(!names.includes('config.json') && !names.includes('memory.md'));
  assert.ok(names.includes('sessions'));
});

test('in a monorepo, only this repo\'s scope moves — the siblings and the root stay', () => {
  const base = fs.mkdtempSync(join(tmpdir(), 'reset-mono-'));
  populate(join(base, '.agent', 'repo-1'));
  populate(join(base, '.agent', 'repo-2'));
  fs.writeFileSync(join(base, '.agent', 'config.json'), '{"shared":true}');
  fs.mkdirSync(join(base, 'repo-1'));
  clearPathCache();

  const plan = planReset(join(base, 'repo-1'));
  for (const m of plan.moves.filter((x) => !x.name.startsWith('~'))) {
    assert.ok(m.from.startsWith(join(base, '.agent', 'repo-1')), `${m.from} is outside repo-1's scope`);
  }
  applyReset(plan);
  assert.ok(fs.existsSync(join(base, '.agent', 'repo-2', 'sessions', 'history.jsonl')), 'a sibling lost its history');
  assert.ok(fs.existsSync(join(base, '.agent', 'config.json')), 'the shared root config went');
});

test('the confirm prompt says where things go and that nothing is deleted', () => {
  const ws = repo();
  const w = describeDestructive('reset', [], { resetPlan: planReset(ws) });
  assert.match(w.detail, /nothing is deleted/);
  assert.match(w.detail, /trash/);
  assert.match(w.detail, /Left in place: data, skills/);
});

test('control: with nothing to move, there is nothing to confirm', () => {
  const ws = fs.mkdtempSync(join(tmpdir(), 'reset-empty-'));
  clearPathCache();
  const plan = planReset(ws);
  assert.equal(plan.moves.length, 0);
  assert.equal(describeDestructive('reset', [], { resetPlan: plan }), null);
});
