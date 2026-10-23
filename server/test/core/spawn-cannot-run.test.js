/**
 * "Could not start a process" is reported as that, not as something else.
 *
 * On the work laptop every spawn failed with EBADF (see
 * test/watcher/file-watcher.test.js for the cause). Two surfaces then said
 * the wrong thing about it: `/update` reported a git checkout as "not a git
 * checkout", because its helper folded every failure into null; and the model
 * was handed a bare `spawn EBADF`, retried with variations, and reported the
 * user's Ruby script as broken.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitOrError } from '../../src/core/update.js';
import { MCPServer } from '../../src/mcp/mcp-server.js';

const failing = (err) => async () => { throw err; };

test('git that could not be started says so', async () => {
  const ebadf = Object.assign(new Error('spawn EBADF'), { code: 'EBADF', syscall: 'spawn' });
  assert.deepEqual(await gitOrError('/x', ['status'], { runner: failing(ebadf) }),
    { stdout: null, cannotRun: 'EBADF' });
  const missing = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
  assert.equal((await gitOrError('/x', ['status'], { runner: failing(missing) })).cannotRun, 'ENOENT');
});

test('control: git that ran and said no is not "could not run"', async () => {
  const notRepo = Object.assign(new Error('exit 128'), { code: 128 });
  assert.deepEqual(await gitOrError('/x', ['status'], { runner: failing(notRepo) }),
    { stdout: null, cannotRun: null });
  const ok = async () => ({ stdout: 'true\n' });
  assert.deepEqual(await gitOrError('/x', ['status'], { runner: ok }), { stdout: 'true', cannotRun: null });
});

function serverWithTool(handler) {
  const server = new MCPServer(mkdtempSync(join(tmpdir(), 'ebadf-')));
  const def = server.tools.get('run_command');
  server.tools.set('run_command', { ...def, handler });
  return server;
}

test('the model is told the command never started, and not to retry', async () => {
  const server = serverWithTool(failing(
    Object.assign(new Error('spawn EBADF'), { code: 'EBADF', syscall: 'spawn' })));
  const out = await server.executeTool('run_command', { command: 'ruby script.rb' });
  assert.equal(out.success, false);
  assert.match(out.error, /could not start any process/);
  assert.match(out.error, /not a problem with the command/);
});

test('control: an ordinary failure keeps its own message', async () => {
  const server = serverWithTool(failing(new Error('boom')));
  const out = await server.executeTool('run_command', { command: 'x' });
  assert.equal(out.error, 'Tool run_command failed: boom');
});
