/**
 * A workspace switch without a restart (v9.9.9.5).
 *
 * Owner, 2026-11-23: "can you avoid restarting the agent in workspace change?
 * or make it more seamless?" The switch was once in-process and re-pointed only
 * some collaborators: memory went to the old project and its allowlist stayed
 * armed (docs/history.md, "The workspace commands"). These tests are that bug
 * class: after a switch, nothing may still read or write the old project.
 * Real collaborators, temp workspaces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildWorld, switchWorld, disposeWorld } from '../../../../src/backend/core/workspace/workspace-world.js';
import { requestWorkspaceSwitch, registerWorkspaceSwitcher } from '../../../../src/backend/core/install/restart.js';
import { WebSocketServer } from '../../../../src/backend/bridge/websocket-server.js';
import * as paths from '../../../../src/backend/core/workspace/paths.js';

function repo(name) {
  const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), `${name}-`)));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const opts = { agentSourceDir: join(process.cwd()), configHome: paths.homeDir(), watch: false };

test('after a switch, every collaborator is on the new project and none on the old', async () => {
  const a = repo('ws-a');
  const b = repo('ws-b');
  // Project A allows a command; project B must not inherit it.
  fs.mkdirSync(join(a, '.agent'), { recursive: true });
  fs.writeFileSync(paths.configPath(a), JSON.stringify({ commandRules: { allow: ['make deploy'], block: [] } }));
  const first = buildWorld(a, opts);
  assert.ok(first.agentLoop.commandRules.allow.includes('make deploy'), 'control: A reads its own allowlist');

  const bridge = new WebSocketServer({ port: 0, agentLoop: first.agentLoop });
  const next = await switchWorld(first, b, opts, { wsServer: bridge });
  const loop = next.agentLoop;

  assert.notEqual(loop, first.agentLoop, 'a new loop, not a re-pointed one');
  assert.equal(bridge.agentLoop, loop, 'the bridge talks to the new loop');
  for (const [name, ws] of [
    ['loop', loop.workspace], ['diffEngine', next.diffEngine.workspace ?? next.diffEngine.workspaceRoot],
    ['mcpServer', next.mcpServer.workspace], ['taskManager', next.taskManager.workspace],
    ['promptBuilder', next.promptBuilder.workspace ?? next.promptBuilder.workspacePath],
  ]) assert.equal(ws, b, `${name} is still on ${ws}`);

  assert.ok(!loop.commandRules.allow.includes('make deploy'), "A's allowlist is armed in B");
  loop.memoryManager.addMemory('B uses pnpm');
  const memA = JSON.stringify(first.agentLoop.memoryManager.getAllMemories?.() ?? []);
  assert.doesNotMatch(memA, /pnpm/, 'memory went to the old project');
  assert.match(JSON.stringify(loop.memoryManager.getAllMemories()), /pnpm/);
  assert.equal(loop.conversationHistory.length, 0, 'a fresh session in the new project');
  assert.equal(first.agentLoop.disposed, true, 'the old loop was taken down');
  await disposeWorld(next);
});

test('bridge.json moves with the switch, so the VS Code companion finds the agent in the new project', async () => {
  const a = repo('bj-a');
  const b = repo('bj-b');
  const first = buildWorld(a, opts);
  const bridge = new WebSocketServer({ port: 0, agentLoop: first.agentLoop });
  await bridge.start();
  try {
    assert.ok(fs.existsSync(paths.statePath(a, 'bridge.json')));
    const next = await switchWorld(first, b, opts, { wsServer: bridge });
    assert.equal(fs.existsSync(paths.statePath(a, 'bridge.json')), false, 'left in the old project');
    assert.ok(fs.existsSync(paths.statePath(b, 'bridge.json')));
    await disposeWorld(next);
  } finally {
    await bridge.stop();
  }
});

test('the switch waits for the turn, refuses a bad path, and refuses the same folder', async () => {
  const a = repo('rq-a');
  const b = repo('rq-b');
  const switched = [];
  registerWorkspaceSwitcher(async (t) => { switched.push(t); });
  // The idle poll is unref'd (it must not hold a quitting process open); hold
  // this one open while it runs.
  const keepalive = setInterval(() => {}, 1000);
  try {
    const loop = { workspace: a, isProcessing: true };
    const out = requestWorkspaceSwitch(b, { agentLoop: loop });
    assert.equal(out.ok, true);
    assert.equal(out.inPlace, true);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(switched, [], 'switched out from under a running turn');
    loop.isProcessing = false;
    await out.done;
    assert.deepEqual(switched, [b]);

    assert.equal(requestWorkspaceSwitch(join(a, 'nope'), { agentLoop: loop }).ok, false);
    assert.match(requestWorkspaceSwitch(a, { agentLoop: { workspace: a } }).error, /Already in/);
  } finally {
    clearInterval(keepalive);
    registerWorkspaceSwitcher(null);
  }
});

test('with no switcher registered it is the restart it was', () => {
  const out = requestWorkspaceSwitch(repo('rs'), { agentLoop: { workspace: '/x', isProcessing: true }, env: {} });
  assert.equal(out.ok, false);
  assert.match(out.error, /no supervisor to restart it/);
});
