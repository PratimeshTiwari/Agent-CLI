/**
 * An MCP server behind OAuth, shaped like Atlassian's (read 2026-11-08): a 401
 * naming its resource metadata, an authorization server that takes
 * self-registration and PKCE S256 only, refresh tokens. One real socket, so the
 * SDK talks to a server and not a stub. It records what it was asked.
 *
 * `browse(url)` stands in for the person in the browser: it follows the
 * authorize URL to its redirect and loads the callback, as Chrome would.
 */
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

const TOOLS = [
  { name: 'getJiraIssue', description: 'reads an issue', inputSchema: { type: 'object' } },
  { name: 'createJiraIssue', description: 'creates an issue', inputSchema: { type: 'object' } },
  { name: 'archiveEverything', description: 'a tool added later', inputSchema: { type: 'object' } },
];

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

export async function startOAuthFixture({ refuse = null, refreshFails = false } = {}) {
  const state = {
    clients: new Map(), codes: new Map(), access: new Set(), refresh: new Set(),
    registered: [], authorized: [], tokenGrants: [], calls: [], session: randomUUID(),
  };
  let base;
  const server = createServer((req, res) => {
    const url = new URL(req.url, base);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (url.pathname === '/.well-known/oauth-protected-resource/mcp' || url.pathname === '/.well-known/oauth-protected-resource') {
        json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['read:jira', 'write:jira', 'offline_access', 'read:loom'] });
        return;
      }
      if (url.pathname.startsWith('/.well-known/oauth-authorization-server') || url.pathname.startsWith('/.well-known/openid-configuration')) {
        json(res, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
        return;
      }
      if (url.pathname === '/register' && req.method === 'POST') {
        const meta = JSON.parse(body);
        const client = { ...meta, client_id: `client-${state.clients.size + 1}` };
        state.clients.set(client.client_id, client);
        state.registered.push(client);
        json(res, 201, client);
        return;
      }
      if (url.pathname === '/authorize') {
        const q = Object.fromEntries(url.searchParams);
        state.authorized.push(q);
        const client = state.clients.get(q.client_id);
        const back = new URL(q.redirect_uri);
        if (!client || !client.redirect_uris.includes(q.redirect_uri)) { res.writeHead(400); res.end('bad client'); return; }
        if (refuse) {
          back.searchParams.set('error', refuse);
        } else {
          const code = randomUUID();
          state.codes.set(code, { challenge: q.code_challenge, method: q.code_challenge_method, client: q.client_id });
          back.searchParams.set('code', code);
        }
        back.searchParams.set('state', q.state);
        res.writeHead(302, { location: String(back) });
        res.end();
        return;
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const p = Object.fromEntries(new URLSearchParams(body));
        state.tokenGrants.push(p.grant_type);
        const issue = () => {
          const access = `at-${randomUUID()}`;
          const refresh = `rt-${randomUUID()}`;
          state.access.add(access);
          state.refresh.add(refresh);
          json(res, 200, { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600 });
        };
        if (p.grant_type === 'authorization_code') {
          const c = state.codes.get(p.code);
          state.codes.delete(p.code);
          const proof = createHash('sha256').update(p.code_verifier || '').digest('base64url');
          if (!c || c.method !== 'S256' || proof !== c.challenge) { json(res, 400, { error: 'invalid_grant' }); return; }
          issue();
          return;
        }
        if (p.grant_type === 'refresh_token') {
          if (refreshFails || !state.refresh.has(p.refresh_token)) { json(res, 400, { error: 'invalid_grant' }); return; }
          state.refresh.delete(p.refresh_token);
          issue();
          return;
        }
        json(res, 400, { error: 'unsupported_grant_type' });
        return;
      }
      if (url.pathname === '/mcp') {
        const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
        if (!state.access.has(bearer)) {
          res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
          res.end('{"error":"invalid_token"}');
          return;
        }
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        const msg = JSON.parse(body);
        if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
        const reply = (result) => json(res, 200, { jsonrpc: '2.0', id: msg.id, result }, { 'mcp-session-id': state.session });
        if (msg.method === 'initialize') reply({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'atl', version: '1' } });
        else if (msg.method === 'tools/list') reply({ tools: TOOLS });
        else if (msg.method === 'tools/call') {
          state.calls.push(msg.params.name);
          reply({ content: [{ type: 'text', text: `${msg.params.name}:ok` }] });
        } else reply({});
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;

  return {
    url: `${base}/mcp`,
    state,
    /** The person in the browser: the consent page redirects, the callback loads. */
    async browse(authorizeUrl, { stateOverride } = {}) {
      const r = await fetch(authorizeUrl, { redirect: 'manual' });
      const location = r.headers.get('location');
      if (!location) return;
      const back = new URL(location);
      if (stateOverride !== undefined) back.searchParams.set('state', stateOverride);
      await fetch(back).catch(() => {});
    },
    /** Every access token stops working, as an hour passing would do. */
    expireAccess() { state.access.clear(); },
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}
