/**
 * A real streamable-HTTP MCP server, written by hand, for the client's tests. The
 * JSON-RPC is answered over a real socket, so what the SDK talks to is a server
 * and not a stub. It records every request's headers.
 *
 * @param {{status?: number, redirectTo?: string, movedFrom?: string}} [opts] - the first two
 *        answer everything; `movedFrom` redirects that path to `/mcp` on this server
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const TOOL = { name: 'echo', description: 'echoes', inputSchema: { type: 'object' } };

export async function startHttpFixture({ status, redirectTo, movedFrom } = {}) {
  const seen = [];
  const state = { session: randomUUID() };
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (redirectTo) { res.writeHead(307, { location: redirectTo }); res.end(); return; }
    if (movedFrom && req.url === movedFrom) { res.writeHead(307, { location: '/mcp' }); res.end(); return; }
    if (status) { res.writeHead(status); res.end('no'); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const msg = JSON.parse(body);
      if (msg.method !== 'initialize' && req.headers['mcp-session-id'] !== state.session) {
        res.writeHead(404); res.end('no such session'); return;
      }
      if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
      const reply = (result) => {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': state.session });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      };
      if (msg.method === 'initialize') {
        reply({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } });
      } else if (msg.method === 'tools/list') reply({ tools: [TOOL] });
      else if (msg.method === 'tools/call') reply({ content: [{ type: 'text', text: `echo:${msg.params.arguments?.q ?? ''}` }] });
      else reply({});
    });
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    seen,
    /** A restart, as far as a client can tell: its session means nothing now. */
    forgetSessions() { state.session = randomUUID(); },
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}
