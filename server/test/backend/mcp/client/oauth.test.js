/**
 * Browser sign-in for an MCP server (v9.9), against a real OAuth server on a
 * socket: discovery from the 401, self-registration, PKCE S256, the callback,
 * refresh, and the cases that must not open a browser.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOAuthFixture } from '../../../fixtures/oauth-fixture.js';
import { AgentOAuthProvider, makeStore, signIn, startCallback } from '../../../../src/backend/mcp/client/oauth.js';
import { McpServers } from '../../../../src/backend/mcp/client/servers.js';
import { atlassianEntry, ATLASSIAN_SCOPES } from '../../../../src/backend/mcp/client/atlassian-server.js';
import { McpConnection } from '../../../../src/backend/mcp/client/connection.js';

const here = dirname(fileURLToPath(import.meta.url));
let n = 0;
const fresh = () => `oauth${(n += 1)}`;

/** A store over a map, optionally cutting every value the way `security -i` does. */
function mapStore(server, cut = Infinity) {
  const map = new Map();
  return {
    map,
    store: makeStore(server, {
      read: (k) => map.get(k) || '',
      store: (k, v) => map.set(k, String(v).slice(0, cut)),
      remove: (k) => map.delete(k),
    }),
  };
}

describe('the record', () => {
  it('survives a store that cuts values at 4 KB, by keeping pieces under it', () => {
    const { store } = mapStore('a', 4039);
    const tokens = { access_token: 'x'.repeat(9000), refresh_token: 'r'.repeat(2000) };
    store.update({ tokens });
    assert.equal(store.get().tokens.access_token.length, 9000);
    assert.equal(store.signedIn(), true);
  });

  it('a store that cuts harder refuses, and keeps nothing half-written', () => {
    const { store, map } = mapStore('b', 100);
    assert.throws(() => store.update({ tokens: { access_token: 'x'.repeat(500) } }), /could not be saved intact/);
    assert.equal(map.size, 0);
    assert.equal(store.signedIn(), false);
  });

  it('forget removes every piece', () => {
    const { store, map } = mapStore('c');
    store.update({ tokens: { access_token: 'x'.repeat(7000) } });
    assert.ok(map.size >= 3);
    store.forget();
    assert.equal(map.size, 0);
  });
});

describe('the callback', () => {
  it('answers only /callback, once, and only with the state it sent', async () => {
    const cb = startCallback({ expectState: () => 'good', timeoutMs: 5000 });
    const url = await cb.listening;
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.equal((await fetch(url.replace('/callback', '/other'))).status, 404);
    await fetch(`${url}?code=c1&state=bad`);
    await assert.rejects(cb.result, /different sign-in/);
    await cb.close();
  });

  it('a refusal in the browser is named', async () => {
    const cb = startCallback({ expectState: () => 's', timeoutMs: 5000 });
    const url = await cb.listening;
    await fetch(`${url}?error=access_denied&state=s`);
    await assert.rejects(cb.result, /refused: access_denied/);
    await cb.close();
  });

  it('gives up after its time, and frees the port', async () => {
    const cb = startCallback({ expectState: () => 's', timeoutMs: 50 });
    await cb.listening;
    await assert.rejects(cb.result, /no answer from the browser/);
    await cb.close();
  });
});

describe('signing in, against a real OAuth server', () => {
  let fx;
  before(async () => { fx = await startOAuthFixture(); });
  after(() => fx.close());

  it('registers itself, sends PKCE S256 and our scopes, and keeps the tokens', async () => {
    const name = fresh();
    const { store } = mapStore(name);
    const opened = [];
    const r = await signIn({ server: name, url: fx.url, store, scope: ATLASSIAN_SCOPES, open: (u) => { opened.push(u); fx.browse(u); } });
    assert.deepEqual(r, { ok: true });
    assert.equal(opened.length, 1, 'one browser page');
    const asked = fx.state.authorized.at(-1);
    assert.equal(asked.code_challenge_method, 'S256');
    assert.equal(asked.scope, ATLASSIAN_SCOPES, 'what the agent uses, not every scope the server lists');
    assert.match(asked.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.equal(fx.state.registered.at(-1).token_endpoint_auth_method, 'none');
    assert.equal(store.signedIn(), true);
    assert.equal(store.get().verifier, null, 'the verifier is spent');
  });

  it('signing in again opens the browser again: old tokens do not skip it', async () => {
    const name = fresh();
    const { store } = mapStore(name);
    let opened = 0;
    const open = (u) => { opened += 1; fx.browse(u); };
    assert.deepEqual(await signIn({ server: name, url: fx.url, store, open }), { ok: true });
    const first = store.get().tokens.access_token;
    assert.deepEqual(await signIn({ server: name, url: fx.url, store, open }), { ok: true });
    assert.equal(opened, 2);
    assert.notEqual(store.get().tokens.access_token, first);
  });

  it('a provider that is not signing in never opens a browser, even holding an opener', async () => {
    const { store } = mapStore(fresh());
    let opened = 0;
    const p = new AgentOAuthProvider({ server: 's', store, open: () => { opened += 1; } });
    await assert.rejects(p.redirectToAuthorization(new URL('https://example.invalid/authorize')), /sign in again/);
    assert.equal(opened, 0);
  });

  it('a browser coming back from another sign-in is refused, and nothing is kept', async () => {
    const name = fresh();
    const { store } = mapStore(name);
    const r = await signIn({ server: name, url: fx.url, store, open: (u) => fx.browse(u, { stateOverride: 'someone-else' }) });
    assert.equal(r.ok, false);
    assert.match(r.error, /different sign-in/);
    assert.equal(store.signedIn(), false);
  });
});

describe('a second address', () => {
  it('a record from one address neither signs in another nor blocks signing in there', async () => {
    const a = await startOAuthFixture();
    const b = await startOAuthFixture();
    const { store } = mapStore('moved');
    try {
      assert.deepEqual(await signIn({ server: 'moved', url: a.url, store, timeoutMs: 8000, open: (u) => a.browse(u) }), { ok: true });
      assert.equal(store.signedIn(a.url), true);
      assert.equal(store.signedIn(b.url), false, 'a token for a is not a sign-in at b');
      assert.deepEqual(await signIn({ server: 'moved', url: b.url, store, timeoutMs: 8000, open: (u) => b.browse(u) }), { ok: true });
      assert.equal(store.signedIn(b.url), true);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe('a refused sign-in', () => {
  it('says what Atlassian said and keeps no tokens', async () => {
    const fx = await startOAuthFixture({ refuse: 'access_denied' });
    const { store } = mapStore('refused');
    const r = await signIn({ server: 'refused', url: fx.url, store, open: (u) => fx.browse(u) });
    await fx.close();
    assert.equal(r.ok, false);
    assert.match(r.error, /access_denied/);
    assert.equal(store.signedIn(), false);
  });
});

describe('the built-in server, signed in', () => {
  let fx;
  let mcp;
  const name = 'atlassian';
  before(async () => {
    fx = await startOAuthFixture();
    const store = makeStore(name);
    mcp = new McpServers({ workspace: here, load: () => ({ path: '/none', exists: false, error: null, servers: [] }), cachePath: join(mkdtempSync(join(tmpdir(), 'oauth-cache-')), 'cache.json'), builtins: () => [atlassianEntry({ store: makeStore(name), url: fx.url })] });
    store.forget();
  });
  after(async () => { makeStore(name).forget(); await mcp.dispose(); await fx.close(); });

  it('is listed and unusable before a sign-in', () => {
    const row = mcp.snapshot().servers.find((s) => s.name === name);
    assert.equal(row.state, 'signed_out');
    assert.equal(row.atlassian, true);
    assert.equal(mcp.usable(name), false);
  });

  it('signs in, connects and lists its tools', async () => {
    const r = await mcp.signIn(name, { open: (u) => fx.browse(u) });
    assert.deepEqual(r, { ok: true });
    assert.equal(mcp.usable(name), true);
    assert.equal(fx.state.authorized.at(-1).scope, ATLASSIAN_SCOPES, 'Jira and Confluence only, not loom');
    const tools = await mcp.toolsOf(name);
    assert.deepEqual(tools.map((t) => t.name), ['getJiraIssue', 'createJiraIssue', 'archiveEverything']);
  });

  it('an expired access token is refreshed with no browser', async () => {
    fx.expireAccess();
    const before = fx.state.tokenGrants.filter((g) => g === 'refresh_token').length;
    const result = await mcp.call(name, 'getJiraIssue', {});
    assert.match(JSON.stringify(result), /getJiraIssue:ok/);
    assert.equal(fx.state.tokenGrants.filter((g) => g === 'refresh_token').length, before + 1);
  });

  it('reads and writes are told apart by name, and an unknown tool is a write', () => {
    assert.equal(mcp.kindOf(name, 'getJiraIssue'), 'read');
    assert.equal(mcp.kindOf(name, 'createJiraIssue'), 'write');
    assert.equal(mcp.kindOf(name, 'archiveEverything'), 'write');
    assert.equal(mcp.kindOf(name, undefined), 'write');
    assert.equal(mcp.alwaysAsks(name), true);
  });

  it('signing out makes it unusable and forgets the tokens', async () => {
    await mcp.signOut(name);
    assert.equal(mcp.usable(name), false);
    assert.equal(makeStore(name).signedIn(), false);
  });
});

it('an Atlassian address always asks, under any name a person gives it', () => {
  const mcp = new McpServers({
    load: () => ({ path: '/none', exists: false, error: null, servers: [
      { name: 'work', source: 'user', transport: 'http', url: 'https://mcp.atlassian.com/v2/mcp', host: 'mcp.atlassian.com', fingerprint: 'f', headers: {} },
    ] }),
    cachePath: join(mkdtempSync(join(tmpdir(), 'oauth-cache-')), 'cache.json'),
  });
  assert.equal(mcp.alwaysAsks('work'), true);
  assert.equal(mcp.kindOf('work', 'createJiraIssue'), 'write');
  mcp.dispose();
});

describe('a lapsed sign-in', () => {
  it('fails as "signed out" and never opens a browser by itself', async () => {
    const fx = await startOAuthFixture({ refreshFails: true });
    const name = 'lapsed';
    const store = makeStore(name);
    try {
      await signIn({ server: name, url: fx.url, store, timeoutMs: 8000, open: (u) => fx.browse(u) });
      fx.expireAccess();
      const server = { name, transport: 'http', auth: 'oauth', atlassian: true, url: fx.url, headers: {} };
      const c = new McpConnection(server, { timeoutMs: 5000 });
      await assert.rejects(c.connect(), /signed out · run `agent atlassian login`/);
      assert.equal(fx.state.authorized.length, 1, 'only the sign-in went to /authorize');
    } finally {
      store.forget();
      await fx.close();
    }
  });
});

it('the read list is names, never the server\'s own hints', () => {
  const src = readFileSync(join(here, '../../../../src/backend/mcp/client/atlassian-server.js'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\*\*[\s\S]*?\*\//g, ''), /readOnlyHint|annotations/);
});
