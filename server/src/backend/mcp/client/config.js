/**
 * Which MCP servers this person has configured (v9.0).
 *
 * The shape is Claude Code's and Cursor's, so an existing config can be pasted
 * in: `{ "mcpServers": { "<name>": { "command", "args", "env" } } }`. It lives in
 * `~/.agent/mcp.json`, because a server is a process that runs as you, and a
 * file you wrote yourself is the one place that can say so. A repo's own
 * `.mcp.json` is read too (v9.6), and nothing in it runs until the person allows
 * it (`repo-approval.js`): a cloned repo must not start a process by itself. On a
 * name both files use, yours wins, so a repo cannot replace a server you trust.
 *
 * An HTTP server (v9.6) is `{ "type": "http", "url", "headers" }`.
 *
 * `${VAR}` and `${VAR:-default}` come from the environment at start. What that
 * yields is a secret as far as this code is concerned, so `problems` name the
 * variable and never the value, and `secretsOf` is what `scrub` wipes from
 * anything a server prints.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeDir } from '../../core/workspace/paths.js';
import { allowedFingerprint } from './repo-approval.js';
import { readSecret } from './secrets.js';

export const mcpConfigPath = () => join(homeDir(), 'mcp.json');
export const repoConfigPath = (workspace) => join(workspace, '.mcp.json');

/** A name the prompt and a tool call can carry unquoted (v9.1). */
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,40}$/;
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const HEADER_NAME = /^[A-Za-z0-9-]{1,60}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * What is wrong with a server's address, or null. Plain `http:` only to this
 * machine: a header holding a token must not cross a network in the clear. A
 * password in the URL would land in every error that quotes it.
 */
export function urlProblem(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return 'that is not a URL';
  }
  if (url.username || url.password) return 'put credentials in `headers`, not in the URL';
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname) ? null : 'plain http is only for this machine: use https';
  return 'the URL must be https';
}

/** Expand one string. Unset variables with no default are collected, not guessed. */
export function expand(text, env, missing) {
  return String(text).replace(VARIABLE, (_, name, fallback) => {
    if (env[name] !== undefined && env[name] !== '') return env[name];
    if (fallback !== undefined) return fallback;
    missing.add(name);
    return '';
  });
}

/**
 * `${secret:<server>/<VAR>}`, from `secrets.js`: what `/mcp add` writes in place
 * of a value. Only a server's own: a config pasted from a web page must not be
 * able to name another server's token and be handed it.
 */
function unseal(text, server, secret, missing) {
  return text.replace(/\$\{secret:([^}]+)\}/g, (_, key) => {
    const value = key.startsWith(`${server}/`) ? secret(key) : '';
    if (!value) missing.add(`the saved ${key}`);
    return value;
  });
}

/** Changes when the config does, and never holds an expanded value. */
function fingerprint(raw) {
  return createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 16);
}

function readHttp(entry, raw, env, secret) {
  const http = { ...entry, transport: 'http' };
  if (typeof raw.url !== 'string' || !raw.url.trim()) return { ...http, problem: 'no `url`' };
  const table = raw.headers ?? {};
  if (typeof table !== 'object' || table === null || Array.isArray(table)) return { ...http, problem: '`headers` must be an object' };
  const bad = Object.entries(table).find(([k, v]) => !HEADER_NAME.test(k) || typeof v !== 'string');
  if (bad) return { ...http, problem: `the header ${bad[0].slice(0, 30)} is not a name and a string` };

  const missing = new Set();
  const seal = (text) => unseal(expand(text, env, missing), entry.name, secret, missing);
  const url = seal(raw.url);
  const headers = Object.fromEntries(Object.entries(table).map(([k, v]) => [k, seal(v)]));
  if (missing.size) return { ...http, problem: `${[...missing].join(', ')} ${missing.size === 1 ? 'is' : 'are'} not set` };
  const wrong = urlProblem(url);
  if (wrong) return { ...http, problem: wrong };
  return { ...http, url, headers, host: new URL(url).host };
}

/**
 * One entry, checked. A bad entry is a row saying why, never a failed launch.
 *
 * `source: 'repo'` is read with no saved secrets at all. A secret is handed over
 * by server name, and a repo chooses its own names: `github` in a `.mcp.json`
 * must not be given the token you saved for your `github`.
 */
export function readServer(name, raw, env, secret = readSecret, source = 'user') {
  const entry = {
    name, source, fingerprint: fingerprint(raw), disabled: Boolean(raw?.disabled), alwaysAsk: raw?.alwaysAsk === true,
  };
  if (!SERVER_NAME.test(name)) return { ...entry, problem: 'the name may use letters, digits, - and _' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...entry, problem: 'not an object' };
  if (source === 'repo' && JSON.stringify(raw).includes('${secret:')) {
    return { ...entry, problem: 'a repo\'s config cannot use saved secrets' };
  }
  if (raw.type === 'sse') return { ...entry, transport: 'http', problem: 'SSE servers are not supported: use its streamable HTTP address' };
  if (raw.url !== undefined || raw.type === 'http') return readHttp(entry, raw, env, secret);
  if (typeof raw.command !== 'string' || !raw.command.trim()) return { ...entry, problem: 'no `command`' };
  if (raw.args !== undefined && (!Array.isArray(raw.args) || raw.args.some((a) => typeof a !== 'string'))) {
    return { ...entry, problem: '`args` must be a list of strings' };
  }
  if (raw.env !== undefined && (typeof raw.env !== 'object' || Array.isArray(raw.env) || raw.env === null)) {
    return { ...entry, problem: '`env` must be an object' };
  }

  const missing = new Set();
  const expanded = {
    command: expand(raw.command, env, missing),
    args: (raw.args || []).map((a) => expand(a, env, missing)),
    // `${secret:…}` after `${VAR}`, so a saved value is never read as a pattern.
    env: Object.fromEntries(Object.entries(raw.env || {}).map(([k, v]) => [k, unseal(expand(v, env, missing), name, secret, missing)])),
  };
  if (missing.size) {
    return { ...entry, problem: `${[...missing].join(', ')} ${missing.size === 1 ? 'is' : 'are'} not set` };
  }
  return { ...entry, transport: 'stdio', ...expanded };
}

/** One file, either one. Never throws: a broken file costs its own row in `/mcp`. */
function readTable(path, env, secret, source) {
  if (!existsSync(path)) return { path, exists: false, error: null, servers: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { path, exists: true, error: `not valid JSON: ${err.message}`, servers: [] };
  }
  const table = parsed?.mcpServers;
  if (table === undefined) return { path, exists: true, error: 'no `mcpServers` object', servers: [] };
  if (typeof table !== 'object' || table === null || Array.isArray(table)) {
    return { path, exists: true, error: '`mcpServers` must be an object', servers: [] };
  }
  return { path, exists: true, error: null, servers: Object.entries(table).map(([n, raw]) => ({ ...readServer(n, raw, env, secret, source), raw })) };
}

/**
 * This person's own file.
 *
 * @returns {{path: string, exists: boolean, error: string|null, servers: object[]}}
 */
export function loadMcpConfig({ path = mcpConfigPath(), env = process.env, secret = readSecret } = {}) {
  return readTable(path, env, secret, 'user');
}

/**
 * Both files. A repo's entry comes back marked `unapproved` until this exact
 * entry has been allowed here, and `switchKey` ties its ask/auto/block to that
 * entry: a switch is keyed by name, and a repo picks its own names, so without
 * this one could arrive on `auto` by reusing the name of a server you trust, and
 * an edit would keep the trust given to what it replaced.
 */
export function loadServers({ workspace, path, env = process.env, secret = readSecret, allowed = allowedFingerprint } = {}) {
  const user = loadMcpConfig({ path, env, secret });
  if (!workspace) return { ...user, repo: null };
  const file = readTable(repoConfigPath(workspace), env, secret, 'repo');
  const mine = new Set(user.servers.map((s) => s.name));
  const shadowed = file.servers.filter((s) => mine.has(s.name)).map((s) => s.name);
  const theirs = file.servers.filter((s) => !mine.has(s.name)).map((s) => {
    const was = allowed(workspace, s.name);
    return { ...s, unapproved: was !== s.fingerprint, changed: Boolean(was) && was !== s.fingerprint, switchKey: `${s.name}@${s.fingerprint}` };
  });
  return {
    ...user,
    servers: [...user.servers, ...theirs],
    repo: { path: file.path, exists: file.exists, error: file.error, shadowed },
  };
}

/** What may hold a token in an address: the query's values. */
function urlSecrets(url) {
  try {
    return [...new URL(url).searchParams.values()];
  } catch {
    return [];
  }
}

/**
 * Every value a server was handed, longest first, for `scrub`. A header is taken
 * whole and word by word: a server echoing a token drops the `Bearer` in front.
 */
export function secretsOf(server) {
  const headers = Object.values(server?.headers || {}).flatMap((v) => [v, ...String(v).split(/\s+/)]);
  const all = [...Object.values(server?.env || {}), ...headers, ...urlSecrets(server?.url)];
  return [...new Set(all)].filter((v) => v && v.length >= 4 && !/^bearer$/i.test(v)).sort((a, b) => b.length - a.length);
}

/** Take a server's own env values out of text that may reach a screen or a log. */
export function scrub(text, server) {
  let out = String(text ?? '');
  for (const secret of secretsOf(server)) out = out.split(secret).join('[hidden]');
  return out;
}
