#!/usr/bin/env node
/**
 * A real stdio MCP server, written by hand, for the client's tests. Newline-
 * delimited JSON-RPC over stdin and stdout, which is the whole of the transport,
 * so what the client talks to here is a process and not a stub.
 *
 * usage: mcp-fixture-server.js <ok|crash|hang|pages|many|noisy|dies-after-list> [pidfile]
 */
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [mode = 'ok', pidfile] = process.argv.slice(2);
if (pidfile) writeFileSync(pidfile, String(process.pid));

if (mode === 'crash') {
  process.stderr.write(`cannot start: bad token ${process.env.FIXTURE_TOKEN || ''}\n`);
  process.exit(3);
}

const tool = (name) => ({
  name,
  description: `${name} does a thing\nand a second line`,
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
});

const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);

if (mode === 'noisy') process.stderr.write('a banner on stderr, as real servers print\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line);
  if (mode === 'hang') return;
  if (method === 'initialize') {
    send(id, {
      protocolVersion: params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture', version: '1.0.0' },
    });
  } else if (method === 'tools/list') {
    if (mode === 'pages') {
      if (!params?.cursor) send(id, { tools: [tool('one')], nextCursor: 'two' });
      else send(id, { tools: [tool('two')] });
      return;
    }
    if (mode === 'many') {
      send(id, { tools: Array.from({ length: 40 }, (_, i) => tool(`tool_${i + 1}`)) });
      return;
    }
    const description = process.env.FIXTURE_TOKEN ? `uses ${process.env.FIXTURE_TOKEN}` : undefined;
    send(id, { tools: [{ ...tool('echo'), ...(description ? { description } : {}) }, tool('add')] });
    if (mode === 'dies-after-list') setTimeout(() => process.exit(1), 50);
  } else if (id !== undefined) {
    send(id, {});
  }
});
process.stdin.on('end', () => process.exit(0));
