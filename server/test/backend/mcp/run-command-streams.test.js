/**
 * `run_command` hands its output to the screen as it arrives, and the model's
 * result is the same whether or not anything was watching.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCPServer } from '../../../src/backend/mcp/mcp-server.js';

const CMD = 'printf "one\\n"; sleep 0.3; printf "two\\n" 1>&2; printf "three"';

test('output reaches onOutput before the command exits, stdout and stderr both', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'stream-'));
  const seen = [];
  let exited = false;
  const run = new MCPServer(ws).executeTool('run_command', { command: CMD }, {
    onOutput: (chunk) => seen.push({ chunk, exited }),
  }).then((r) => { exited = true; return r; });

  const out = await run;
  const text = seen.map((s) => s.chunk).join('');
  assert.match(text, /one\n/);
  assert.match(text, /two\n/, 'stderr is shown too — a failing build writes there');
  assert.match(text, /three/);
  assert.equal(seen[0].exited, false, 'the first chunk arrived while the command was still running');
  assert.equal(out.result.stdout, 'one\nthree');
  rmSync(ws, { recursive: true, force: true });
});

test('the result is identical with and without a watcher, and a throwing watcher changes nothing', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'stream-'));
  const server = new MCPServer(ws);
  const plain = await server.executeTool('run_command', { command: CMD }, {});
  const watched = await server.executeTool('run_command', { command: CMD }, {
    onOutput: () => { throw new Error('render failed'); },
  });
  assert.equal(watched.success, true);
  assert.deepEqual(watched.result, plain.result);
  rmSync(ws, { recursive: true, force: true });
});
