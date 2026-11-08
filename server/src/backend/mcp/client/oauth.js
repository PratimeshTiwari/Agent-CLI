/**
 * Signing in to an HTTP MCP server in the browser (v9.9).
 *
 * Owner, 2026-11-08: "I want `agent atlassian login` to work like Cursor's,
 * opening the Atlassian page in the browser to ask for permissions instead of
 * asking for the site URL, email and token." The MCP spec's own sign-in, which
 * the SDK implements: the server answers 401 naming its resource metadata, that
 * names the authorization server, the client registers itself there (no
 * client id to paste), and the browser does the rest. PKCE S256 throughout.
 *
 * What is ours: where the record lives, the one-shot callback on 127.0.0.1, and
 * that a connection never opens a browser by itself. A refresh happens inside
 * the SDK on a 401; anything that would need the browser again throws
 * `SignInNeeded`, and `/mcp` says "sign in again".
 *
 * **The record is a secret**: the refresh token lasts as long as an API token.
 * It goes where `/mcp add` puts secrets (Keychain, else `mcp-secrets.json` at
 * 0600), never into `mcp.json`, a prompt or a log. The Keychain's `security -i`
 * cuts a line at about 4 KB (measured 2026-11-08: 5,806 characters written,
 * 4,039 read back), so the record is stored in pieces and read back before it is
 * trusted.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readSecret, removeSecret, storeSecret } from './secrets.js';

const PIECE = 3000;
const MAX_PIECES = 20;
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export class SignInNeeded extends Error {
  constructor(server) {
    super(`${server} needs you to sign in again`);
    this.signIn = true;
  }
}

const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
const decode = (text) => JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
const pieceKey = (server, i) => `${server}/OAUTH_${i}`;
const countKey = (server) => `${server}/OAUTH_PIECES`;

/** The saved record for one server: `{ client, tokens, verifier, discovery }`. */
export function makeStore(server, { read = readSecret, store = storeSecret, remove = removeSecret } = {}) {
  let cached;
  const load = () => {
    if (cached !== undefined) return cached;
    cached = null;
    const n = Number(read(countKey(server)) || 0);
    if (n > 0 && n <= MAX_PIECES) {
      try {
        let text = '';
        for (let i = 0; i < n; i += 1) text += read(pieceKey(server, i));
        cached = decode(text);
      } catch { cached = null; } // a damaged record is no record: sign in again
    }
    return cached;
  };
  const clear = () => {
    const n = Number(read(countKey(server)) || 0);
    for (let i = 0; i < Math.min(Math.max(n, 0), MAX_PIECES); i += 1) remove(pieceKey(server, i));
    remove(countKey(server));
  };
  const save = (record) => {
    const text = encode(record);
    const pieces = text.match(new RegExp(`.{1,${PIECE}}`, 'g')) || [];
    if (pieces.length > MAX_PIECES) throw new Error('the sign-in record is too large to keep');
    clear();
    pieces.forEach((p, i) => store(pieceKey(server, i), p));
    store(countKey(server), String(pieces.length));
    // Read back: a store that cut a piece must fail here, not at the next start.
    const back = pieces.map((_, i) => read(pieceKey(server, i))).join('');
    if (back !== text) {
      clear();
      throw new Error('the sign-in could not be saved intact');
    }
    cached = record;
  };
  return {
    get: () => load() || {},
    update(patch) { save({ ...(load() || {}), ...patch }); },
    forget() { clear(); cached = null; },
    /** For this address, when given: a record made for another one is no sign-in. */
    signedIn: (url) => Boolean((load()?.tokens?.access_token || load()?.tokens?.refresh_token)
      && (!url || !load()?.url || load().url === String(url))),
  };
}

/**
 * The SDK's `OAuthClientProvider`.
 *
 * `interactive` is true only inside `signIn`. A connection's provider throws
 * instead of opening a browser: a sign-in is something a person starts.
 */
export class AgentOAuthProvider {
  constructor({ server, store, redirectUrl, interactive = false, open = null, scope = undefined }) {
    this.server = server;
    this.store = store;
    this._redirect = redirectUrl || store.get().redirect || undefined;
    this.interactive = interactive;
    this.open = open;
    this.scope = scope;
    this.lastState = null;
  }

  get redirectUrl() {
    return this._redirect;
  }

  get clientMetadata() {
    return {
      client_name: 'Agent CLI',
      redirect_uris: this._redirect ? [String(this._redirect)] : [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.scope ? { scope: this.scope } : {}),
    };
  }

  state() {
    this.lastState = randomBytes(16).toString('hex');
    return this.lastState;
  }

  clientInformation() {
    const { client, redirect } = this.store.get();
    // A registration names its redirect: a new port is a new registration.
    if (this.interactive && client && redirect !== String(this._redirect)) return undefined;
    return client || undefined;
  }

  saveClientInformation(client) {
    this.store.update({ client, redirect: String(this._redirect) });
  }

  tokens() {
    return this.store.get().tokens || undefined;
  }

  saveTokens(tokens) {
    this.store.update({ tokens, savedAt: Date.now() });
  }

  async redirectToAuthorization(url) {
    if (!this.interactive || !this.open) throw new SignInNeeded(this.server);
    await this.open(String(url));
  }

  saveCodeVerifier(verifier) {
    this.store.update({ verifier });
  }

  codeVerifier() {
    const { verifier } = this.store.get();
    if (!verifier) throw new Error('no sign-in is in progress');
    return verifier;
  }

  discoveryState() {
    return this.store.get().discovery || undefined;
  }

  saveDiscoveryState(discovery) {
    this.store.update({ discovery });
  }

  invalidateCredentials(scope) {
    const record = this.store.get();
    if (scope === 'all') { this.store.forget(); return; }
    const drop = { client: ['client'], tokens: ['tokens'], verifier: ['verifier'], discovery: ['discovery'] }[scope] || [];
    if (!drop.length) return;
    const next = { ...record };
    for (const key of drop) delete next[key];
    this.store.forget();
    if (Object.keys(next).length) this.store.update(next);
  }
}

const PAGE = (title, line) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui;margin:4em auto;max-width:32em;color:#222">
<h2>${title}</h2><p>${line}</p></body>`;

/**
 * One request to `/callback`, then closed. Anything else gets 404. The state
 * must match the one this sign-in sent: a page that knows the port must not be
 * able to finish someone else's sign-in.
 */
export function startCallback({ expectState, timeoutMs = SIGN_IN_TIMEOUT_MS }) {
  let server;
  let timer;
  const result = new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const fail = (why) => {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE('Not signed in', 'Go back to the terminal to see why.'));
        reject(new Error(why));
      };
      if (error) { fail(`the sign-in was refused: ${url.searchParams.get('error_description') || error}`.slice(0, 300)); return; }
      if (!code) { fail('the browser came back with no code'); return; }
      if (state !== expectState()) { fail('the browser came back from a different sign-in'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE('Signed in', 'You can close this tab and go back to the terminal.'));
      resolve(code);
    });
    timer = setTimeout(() => reject(new Error(`no answer from the browser in ${Math.round(timeoutMs / 60000)} minutes`)), timeoutMs);
    timer.unref?.();
  });
  const close = () => {
    clearTimeout(timer);
    server.closeAllConnections?.();
    return new Promise((r) => { server.close(() => r()); });
  };
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/callback`));
  });
  result.catch(() => {}); // handled by the caller; never an unhandled rejection
  return { listening, result, close };
}

async function loadAuth() {
  const mod = await import('@modelcontextprotocol/sdk/client/auth.js');
  return mod.auth;
}

/**
 * The whole sign-in: a callback, the browser, the code, the tokens.
 *
 * @param {{server: string, url: string, open: (url: string) => any, scope?: string,
 *          store?: object, fetchFn?: Function, timeoutMs?: number, auth?: Function}} opts
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function signIn({ server, url, open, scope, store = makeStore(server), fetchFn, timeoutMs, auth = null }) {
  const run = auth || await loadAuth();
  let provider;
  const callback = startCallback({ expectState: () => provider?.lastState, timeoutMs });
  try {
    const redirectUrl = await callback.listening;
    provider = new AgentOAuthProvider({ server, store, redirectUrl, interactive: true, open, scope });
    // A fresh sign-in: old tokens must not make the SDK skip the browser, and a
    // cached discovery from another address must not pin the old resource. The
    // harness found it: a record from one address failed every sign-in at the
    // next with "Protected resource … does not match expected".
    provider.invalidateCredentials('tokens');
    provider.invalidateCredentials('discovery');
    const first = await run(provider, { serverUrl: url, scope, ...(fetchFn ? { fetchFn } : {}) });
    if (first === 'AUTHORIZED') return { ok: true };
    const code = await callback.result;
    const second = await run(provider, { serverUrl: url, scope, authorizationCode: code, ...(fetchFn ? { fetchFn } : {}) });
    if (second !== 'AUTHORIZED') return { ok: false, error: 'the server did not accept the sign-in' };
    store.update({ verifier: null, url: String(url) });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 300) };
  } finally {
    await callback.close();
  }
}

/** A connection's provider: refreshes on its own, never opens a browser. */
export function connectionAuth(server, store = makeStore(server)) {
  return new AgentOAuthProvider({ server, store });
}
