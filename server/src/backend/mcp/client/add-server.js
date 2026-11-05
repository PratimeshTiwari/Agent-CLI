/**
 * Turning what a person pasted into a server entry (v9.2).
 *
 * Servers document themselves in four shapes, so all four are read: a command
 * line, `claude mcp add …`, the `mcpServers` JSON, and that JSON's inner entry
 * with no braces. Pure apart from `tryServer`, which starts the process.
 */
import { readServer, SERVER_NAME } from './config.js';
import { McpConnection } from './connection.js';

/** Split like a shell, quotes included. It does not run one: `spawn` gets the words. */
export function shellSplit(text) {
  const words = [];
  let word = null;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < text.length) { i += 1; word += text[i]; } else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      word ??= '';
    } else if (c === '\\' && i + 1 < text.length) {
      i += 1;
      word = (word ?? '') + (text[i] === '\n' ? '' : text[i]);
    } else if (/\s/.test(c)) {
      if (word !== null) { words.push(word); word = null; }
    } else {
      word = (word ?? '') + c;
    }
  }
  if (quote) return null;
  if (word !== null) words.push(word);
  return words;
}

const ENV_WORD = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function fromWords(words) {
  const env = {};
  let at = 0;
  while (at < words.length && ENV_WORD.test(words[at])) {
    const [, key, value] = words[at].match(ENV_WORD);
    env[key] = value;
    at += 1;
  }
  const [command, ...args] = words.slice(at);
  if (!command) return { problem: 'There is no command in that.' };
  if (words.some((w) => ['|', '||', '&&', ';', '>'].includes(w))) {
    return { problem: 'That is a shell line. A server is one command: no pipes or `&&`.' };
  }
  return { entry: { command, args, ...(Object.keys(env).length ? { env } : {}) } };
}

/** `claude mcp add [-e K=V] [-s scope] [--transport stdio] <name> -- <command> …` */
function fromClaudeAdd(words) {
  const split = words.indexOf('--');
  if (split === -1) return { problem: 'That has no `--` before the command, so it is a remote server, which is not supported yet.' };
  const flags = words.slice(3, split);
  const env = {};
  let name;
  for (let i = 0; i < flags.length; i += 1) {
    const f = flags[i];
    if (f === '-e' || f === '--env') {
      const hit = String(flags[i + 1]).match(ENV_WORD);
      if (hit) env[hit[1]] = hit[2];
      i += 1;
    } else if (f === '-s' || f === '--scope' || f === '-t' || f === '--transport') i += 1;
    else if (!f.startsWith('-')) name = f;
  }
  const parsed = fromWords(words.slice(split + 1));
  if (parsed.entry) parsed.entry.env = { ...env, ...parsed.entry.env };
  return { ...parsed, name };
}

function fromJson(text) {
  let value;
  const body = text.replace(/,\s*$/, '');
  try {
    value = JSON.parse(body.startsWith('"') ? `{${body}}` : body);
  } catch (err) {
    return { problem: `That is not valid JSON: ${err.message}` };
  }
  const table = value?.mcpServers || value?.mcp?.servers || value?.servers || value;
  if (typeof table?.command === 'string' || typeof table?.url === 'string') return { entry: table };
  const names = Object.keys(table || {});
  if (!names.length) return { problem: 'There is no server in that.' };
  if (names.length > 1) return { problem: `That has ${names.length} servers (${names.join(', ')}). Paste one at a time.` };
  return { name: names[0], entry: table[names[0]] };
}

/**
 * A pasted entry is someone else's text. An `env` key reaches the Keychain's
 * command line, so its shape is checked here and again where it is stored.
 */
function entryProblem(entry) {
  if (typeof entry.command !== 'string' || !entry.command) return 'That has no `command`.';
  if (entry.args !== undefined && !(Array.isArray(entry.args) && entry.args.every((a) => typeof a === 'string'))) {
    return '`args` should be a list of strings.';
  }
  if (entry.env !== undefined && (typeof entry.env !== 'object' || entry.env === null || Array.isArray(entry.env))) {
    return '`env` should be an object.';
  }
  const bad = Object.keys(entry.env || {}).find((k) => !ENV_NAME.test(k));
  return bad ? `\`${bad.slice(0, 30)}\` is not an environment variable name.` : null;
}

/**
 * @param {string} text - as pasted
 * @returns {{entry?: object, name?: string, problem?: string}}
 */
export function parseServerInput(text) {
  const clean = String(text ?? '').trim()
    .replace(/^```\w*\s*/, '').replace(/\s*```$/, '')
    .replace(/^\$\s+/, '')
    .trim();
  if (!clean) return { problem: 'Paste a command or JSON first.' };
  // `"name": {…}` is JSON; `"/a path/server" --flag` is a command.
  const parsed = /^\{|^"[^"]*"\s*:/.test(clean) ? fromJson(clean) : null;
  if (parsed?.entry?.url || /^https?:\/\//i.test(clean)) {
    return { problem: 'Remote (HTTP) servers are not supported yet. Only a local command works for now.' };
  }
  if (parsed) return parsed.entry ? { ...parsed, problem: entryProblem(parsed.entry) ?? undefined } : parsed;
  const words = shellSplit(clean);
  if (!words) return { problem: 'A quote is not closed.' };
  return words[0] === 'claude' && words[1] === 'mcp' && words[2] === 'add' ? fromClaudeAdd(words) : fromWords(words);
}

/** `@scope/server-github` → `github`, `mcp-server-foo` → `foo`. A suggestion: the next step can change it. */
export function suggestName(entry, taken = []) {
  const runners = new Set(['npx', 'pnpx', 'bunx', 'uvx', 'pipx', 'docker', 'node', 'python', 'python3', 'deno', 'uv']);
  const words = [entry.command, ...(entry.args || [])];
  const leaf = (w) => String(w).split('/').pop();
  const main = words.find((w, i) => !w.startsWith('-') && !(i === 0 && runners.has(leaf(w))) && !['run', 'dlx', 'x'].includes(w)) || entry.command;
  const base = leaf(main).replace(/@[^@]*$/, '').replace(/\.(js|mjs|py)$/, '');
  const short = base.replace(/^(mcp[-_]server|server[-_]mcp|mcp|server)[-_]/i, '').replace(/[-_](mcp|mcp[-_]server|server)$/i, '');
  const name = short.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 30) || 'server';
  let out = name;
  for (let n = 2; taken.includes(out); n += 1) out = `${name}-${n}`;
  return out;
}

export function nameProblem(name, taken = []) {
  if (!SERVER_NAME.test(name)) return 'Letters, digits, - and _ only, up to 40.';
  if (taken.includes(name)) return `There is already a server called ${name}.`;
  return null;
}

const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL|AUTH|\bPAT\b|_PAT$/i;
const PLACEHOLDER = /^<.*>$|^\[.*\]$|^your[-_ ]|^xxx|_here$|\.\.\.$|^changeme$/i;
const REFERENCE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export const isSecretName = (name) => SECRET_NAME.test(name);

/**
 * `env` as the check step draws it. A reference is shown, because where a value
 * comes from is what a pasted config can abuse (`"X": "${AWS_SECRET_ACCESS_KEY}"`);
 * a secret or anything typed shows only its name.
 */
export function envLine(entry, values = {}) {
  return Object.entries({ ...entry.env, ...values }).map(([key, raw]) => {
    const value = String(raw);
    if (key in values || (isSecretName(key) && !REFERENCE.test(value))) return key;
    return `${key}=${value}`;
  }).join(' ');
}

/**
 * Which `env` values to ask for, and which pasted values to move out of the file.
 * A `${VAR}` that is set stays a reference: the person already keeps it elsewhere.
 *
 * @returns {{ask: {key: string, hidden: boolean}[], keep: string[]}}
 */
export function planEnv(entry, env = process.env) {
  const ask = [];
  const keep = [];
  for (const [key, raw] of Object.entries(entry.env || {})) {
    const value = String(raw ?? '');
    const ref = value.match(REFERENCE);
    if (value === '' || PLACEHOLDER.test(value) || (ref && !env[ref[1]])) ask.push({ key, hidden: isSecretName(key) });
    else if (!ref && isSecretName(key)) keep.push(key);
  }
  return { ask, keep };
}

/**
 * Start it once, list its tools and stop it, before anything is saved.
 *
 * @param {object} entry
 * @param {Object<string, string>} values - what was typed for `env`
 * @returns {{connection: McpConnection, result: Promise<{ok: boolean, tools?: object[], error?: string}>}}
 */
export function tryServer(name, entry, values, { cwd, env = process.env, connection = (s, o) => new McpConnection(s, o) } = {}) {
  const server = readServer(name, { ...entry, env: { ...entry.env, ...values } }, env);
  if (server.problem) return { connection: null, result: Promise.resolve({ ok: false, error: server.problem }) };
  const conn = connection(server, { cwd });
  const result = (async () => {
    try {
      await conn.connect();
      return { ok: true, tools: await conn.listTools() };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      await conn.close();
    }
  })();
  return { connection: conn, result };
}
