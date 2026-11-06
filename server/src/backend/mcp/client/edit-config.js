/**
 * Writing `~/.agent/mcp.json` from the `/mcp` screens (v9.2). A person's file:
 * keys this does not know are kept, a file it cannot read is refused rather than
 * replaced, and a secret goes in the store before the file names it.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mcpConfigPath } from './config.js';
import { headerValue, isSecretName } from './add-server.js';
import { removeSecret, secretKey, secretRef, storeSecret } from './secrets.js';

function readRaw(path) {
  if (!existsSync(path)) return { mcpServers: {} };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`mcp.json is not valid JSON, so nothing was changed: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('mcp.json is not an object, so nothing was changed.');
  return { ...parsed, mcpServers: parsed.mcpServers || {} };
}

function writeRaw(path, raw) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

/**
 * A header's token goes to the store with the scheme left in the file, so the
 * Keychain holds a plain token and `Bearer ${secret:…}` reads as what it is.
 */
function sealHeaders(name, headers, values) {
  const out = {};
  for (const [key, pasted] of Object.entries(headers)) {
    const value = headerValue(pasted, values[key]);
    const scheme = value.match(/^bearer\s+/i)?.[0] ?? '';
    const token = value.slice(scheme.length);
    if (!isSecretName(key) || token.startsWith('${')) { out[key] = value; continue; }
    const variable = key.replace(/-/g, '_');
    storeSecret(secretKey(name, variable), token);
    out[key] = `${scheme}${secretRef(name, variable)}`;
  }
  return out;
}

/**
 * @param {string} name
 * @param {object} entry - as parsed
 * @param {Object<string, string>} values - what was typed
 * @param {{path?: string}} [opts]
 */
export function saveServer(name, entry, values = {}, { path = mcpConfigPath() } = {}) {
  const raw = readRaw(path);
  if (entry.url) {
    raw.mcpServers[name] = {
      type: 'http',
      url: entry.url,
      ...(entry.headers ? { headers: sealHeaders(name, entry.headers, values) } : {}),
      ...(entry.alwaysAsk === true ? { alwaysAsk: true } : {}),
    };
    writeRaw(path, raw);
    return;
  }
  const env = {};
  for (const [key, value] of Object.entries({ ...entry.env, ...values })) {
    const literal = String(value);
    if (isSecretName(key) && !/^\$\{/.test(literal)) {
      storeSecret(secretKey(name, key), literal);
      env[key] = secretRef(name, key);
    } else {
      env[key] = literal;
    }
  }
  raw.mcpServers[name] = {
    command: entry.command,
    args: entry.args || [],
    ...(Object.keys(env).length ? { env } : {}),
    ...(entry.alwaysAsk === true ? { alwaysAsk: true } : {}),
  };
  writeRaw(path, raw);
}

export function setServerDisabled(name, disabled, { path = mcpConfigPath() } = {}) {
  const raw = readRaw(path);
  if (!raw.mcpServers[name]) throw new Error(`mcp.json has no server called ${name}.`);
  if (disabled) raw.mcpServers[name].disabled = true;
  else delete raw.mcpServers[name].disabled;
  writeRaw(path, raw);
}

export function removeServer(name, { path = mcpConfigPath() } = {}) {
  const raw = readRaw(path);
  const entry = raw.mcpServers[name];
  if (!entry) throw new Error(`mcp.json has no server called ${name}.`);
  delete raw.mcpServers[name];
  writeRaw(path, raw);
  for (const value of [...Object.values(entry.env || {}), ...Object.values(entry.headers || {})]) {
    const key = String(value).match(/\$\{secret:([^}]+)\}/)?.[1];
    if (key) removeSecret(key);
  }
}
