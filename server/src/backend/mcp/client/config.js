/**
 * Which MCP servers this person has configured (v9.0).
 *
 * The shape is Claude Code's and Cursor's, so an existing config can be pasted
 * in: `{ "mcpServers": { "<name>": { "command", "args", "env" } } }`. It lives in
 * `~/.agent/mcp.json`, because a server is a process that runs as you, and a
 * file you wrote yourself is the one place that can say so. A repo's own
 * `.mcp.json` is v9.2, and it will need its own approval: a cloned repo must
 * not start a process by itself.
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

export const mcpConfigPath = () => join(homeDir(), 'mcp.json');

/** A name the prompt and a tool call can carry unquoted (v9.1). */
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/** Expand one string. Unset variables with no default are collected, not guessed. */
export function expand(text, env, missing) {
  return String(text).replace(VARIABLE, (_, name, fallback) => {
    if (env[name] !== undefined && env[name] !== '') return env[name];
    if (fallback !== undefined) return fallback;
    missing.add(name);
    return '';
  });
}

/** Changes when the config does, and never holds an expanded value. */
function fingerprint(raw) {
  return createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 16);
}

/** One entry, checked. A bad entry is a row saying why, never a failed launch. */
function readServer(name, raw, env) {
  const entry = { name, source: 'user', fingerprint: fingerprint(raw), disabled: Boolean(raw?.disabled) };
  if (!NAME.test(name)) return { ...entry, problem: 'the name may use letters, digits, - and _' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...entry, problem: 'not an object' };
  if (raw.url || raw.type === 'http' || raw.type === 'sse') {
    return { ...entry, transport: 'http', problem: 'HTTP servers are not supported yet' };
  }
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
    env: Object.fromEntries(Object.entries(raw.env || {}).map(([k, v]) => [k, expand(v, env, missing)])),
  };
  if (missing.size) {
    return { ...entry, problem: `${[...missing].join(', ')} ${missing.size === 1 ? 'is' : 'are'} not set` };
  }
  return { ...entry, transport: 'stdio', ...expanded };
}

/**
 * Read the config. Never throws: a broken file costs its own row in `/mcp`.
 *
 * @returns {{path: string, exists: boolean, error: string|null, servers: object[]}}
 */
export function loadMcpConfig({ path = mcpConfigPath(), env = process.env } = {}) {
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
  return { path, exists: true, error: null, servers: Object.entries(table).map(([n, raw]) => readServer(n, raw, env)) };
}

/** Every value that came from `env`, longest first, for `scrub`. */
export function secretsOf(server) {
  return Object.values(server?.env || {}).filter((v) => v && v.length >= 4).sort((a, b) => b.length - a.length);
}

/** Take a server's own env values out of text that may reach a screen or a log. */
export function scrub(text, server) {
  let out = String(text ?? '');
  for (const secret of secretsOf(server)) out = out.split(secret).join('[hidden]');
  return out;
}
