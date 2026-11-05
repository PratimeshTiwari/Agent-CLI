/**
 * A server's secrets, kept out of `mcp.json` (v9.2).
 *
 * The same rule as Jira's token (`atlassian/config.js`): the login Keychain on
 * macOS, written through `security -i` on stdin so a value never appears in a
 * process list, and elsewhere a 0600 file. `mcp.json` holds `${secret:<server>/<VAR>}`,
 * so it can be read, pasted into a chat or backed up.
 *
 * A value the Keychain's quoting cannot carry (spaces, quotes) goes to the file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isStorableToken } from '../../atlassian/config.js';
import { homeDir } from '../../core/workspace/paths.js';

export const KEYCHAIN_SERVICE = 'agent-cli-mcp';
const KEY_SHAPE = /^[A-Za-z0-9_-]{1,40}\/[A-Za-z_][A-Za-z0-9_]*$/;

const secretsFile = () => path.join(homeDir(), 'mcp-secrets.json');
const useKeychain = () => process.platform === 'darwin' && !process.env.AGENT_MCP_NO_KEYCHAIN;

export const secretKey = (server, variable) => `${server}/${variable}`;
export const secretRef = (server, variable) => `\${secret:${secretKey(server, variable)}}`;

/** Where a saved value goes, in the words the add screen uses. */
export const secretPlace = () => (useKeychain() ? 'your Keychain' : '~/.agent/mcp-secrets.json');

function readFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(secretsFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeFile(map) {
  const file = secretsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function storeSecret(key, value) {
  // The key is written into a `security -i` line: the shape is the quoting.
  if (!KEY_SHAPE.test(key)) throw new Error(`${key} is not a name a secret can be saved under.`);
  if (useKeychain() && isStorableToken(value)) {
    const r = spawnSync('/usr/bin/security', ['-i'], {
      input: `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a "${key}" -w "${value}"\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (r.status !== 0 || /error/i.test(r.stderr || '')) {
      throw new Error(`The Keychain refused it: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
    }
    dropFromFile(key); // reads look there first, so an older value must not win
    return;
  }
  writeFile({ ...readFile(), [key]: value });
}

export function readSecret(key) {
  const inFile = readFile()[key];
  if (inFile) return inFile;
  if (!useKeychain()) return '';
  const r = spawnSync('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', key, '-w'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

function dropFromFile(key) {
  const map = readFile();
  if (map[key] === undefined) return;
  delete map[key];
  writeFile(map);
}

export function removeSecret(key) {
  if (useKeychain()) {
    spawnSync('/usr/bin/security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', key], { stdio: 'ignore' });
  }
  dropFromFile(key);
}
