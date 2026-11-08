/**
 * `agent atlassian login [--token] | logout | status` (v8.1; the browser since v9.9).
 *
 * **`login` opens the browser** (v9.9, owner: "work like Cursor's"): Atlassian's
 * own consent page, then its MCP server's Jira and Confluence tools. No site,
 * email or token is typed. Cloud only. **`login --token`** is the v8.1 flow below,
 * kept for Server / Data Center and for a site whose admin blocks the MCP server.
 *
 * In a shell of its own rather than a slash command, because a token typed into
 * the agent's prompt would sit in its input history and its transcript. Here it
 * is read with echo off and goes straight to the Keychain (or a 0600 file).
 * Nothing is stored until Jira has accepted it: a wrong token is reported and
 * forgotten, never saved for the agent to fail with later.
 *
 * Built-ins only, like `agent doctor`: the bin runs it before looking for tsx.
 */
import readline from 'node:readline';
import {
  atlassianSite, guessKind, normalizeSite, readToken, storeToken, saveAtlassianSite, forgetAtlassianSite,
  isStorableToken,
} from './config.js';
import { createJiraClient, detectKind } from './jira-client.js';
import { spawn } from 'node:child_process';
import { makeStore, signIn } from '../mcp/client/oauth.js';
import { ATLASSIAN_NAME, ATLASSIAN_SCOPES, atlassianEntry, atlassianUrl } from '../mcp/client/atlassian-server.js';

/** The person's browser, with no shell between: the URL is not quoted anywhere. */
export function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* the URL is printed too */ }
}

/** Connect once and count the tools: proof the sign-in works, not just that it was stored. */
async function checkMcp({ connect } = {}) {
  const { McpConnection } = await import('../mcp/client/connection.js');
  const c = (connect || ((server) => new McpConnection(server, { timeoutMs: 30_000 })))(atlassianEntry());
  try {
    await c.connect();
    const tools = await c.listTools();
    return { ok: true, count: tools.length };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    await c.close();
  }
}

async function browserLogin(say, { open = openBrowser, signInImpl = signIn, connect } = {}) {
  say('Opening Atlassian in your browser. Choose your site and allow access.');
  const r = await signInImpl({
    server: ATLASSIAN_NAME,
    url: atlassianUrl(),
    scope: ATLASSIAN_SCOPES,
    store: makeStore(ATLASSIAN_NAME),
    open: (url) => {
      open(url);
      say(`If nothing opened, visit:\n  ${url}`);
      say('Waiting for the browser (5 minutes)…');
    },
  });
  if (!r.ok) {
    say(`✗ Not signed in: ${r.error}`);
    say('If your organisation blocks it, an admin can allow it under Atlassian Administration → Rovo MCP server.');
    say('Or sign in with a token instead: agent atlassian login --token');
    return 1;
  }
  const check = await checkMcp({ connect });
  if (check.ok) say(`✔ Signed in to Atlassian · ${check.count} Jira and Confluence tools.`);
  else say(`✔ Signed in, but the server did not answer yet: ${check.error}`);
  say(process.platform === 'darwin' && !process.env.AGENT_MCP_NO_KEYCHAIN
    ? 'The sign-in is in your login Keychain (agent-cli-mcp).' : 'The sign-in is in ~/.agent/mcp-secrets.json (readable only by you).');
  say('In the agent, the model can use it now. Every write asks you first, in every mode.');
  return 0;
}

const CLOUD_TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens';

/**
 * Check the credentials against the site and store them only if Jira accepts them.
 *
 * @returns {Promise<{ok: true, name: string, kind: string} | {ok: false, error: string}>}
 */
export async function loginWith({ site, kind, email = '', token }, { fetchImpl } = {}) {
  const s = normalizeSite(site);
  if (!s) return { ok: false, error: 'That is not a site address. It looks like https://yourcompany.atlassian.net.' };
  if (!isStorableToken(token)) return { ok: false, error: 'That token is empty or has spaces in it; copy it again.' };
  if (kind === 'cloud' && !email) return { ok: false, error: 'Jira Cloud signs in with your email and an API token.' };
  try {
    const me = await createJiraClient({ site: s, kind, email, token, ...(fetchImpl ? { fetchImpl } : {}) }).myself();
    storeToken(s, token);
    saveAtlassianSite({ site: s, kind, email });
    return { ok: true, name: me?.displayName || me?.name || email || 'you', kind };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function ask(rl, question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (!hidden) { rl.question(question, (a) => resolve(a.trim())); return; }
    rl.output.write(question);
    const write = rl._writeToOutput;
    // Echo nothing but the newline, so the token is never on screen.
    rl._writeToOutput = (s) => { if (/[\r\n]/.test(s)) rl.output.write('\n'); };
    rl.question('', (a) => { rl._writeToOutput = write; resolve(a.trim()); });
  });
}

const kindName = (k) => (k === 'cloud' ? 'Jira Cloud' : 'Jira Server / Data Center');

export async function runAtlassianCli(argv = [], { input = process.stdin, output = process.stdout, browser = {} } = {}) {
  const sub = argv[0] || 'status';
  const say = (line = '') => output.write(`${line}\n`);
  const store = makeStore(ATLASSIAN_NAME);

  if (sub === 'logout') {
    const hadBrowser = store.signedIn();
    if (hadBrowser) {
      store.forget();
      say('Signed out of Atlassian; the browser sign-in is deleted.');
    }
    const cfg = atlassianSite();
    if (!cfg || cfg.from === 'env') {
      if (cfg) say('Jira is set from ATLASSIAN_* environment variables; unset them to sign out.');
      else if (!hadBrowser) say('Not signed in to Atlassian.');
      return 0;
    }
    forgetAtlassianSite();
    say(`Signed out of ${cfg.site}; the token is deleted.`);
    return 0;
  }

  if (sub === 'status') {
    let ok = false;
    if (store.signedIn()) {
      const check = await checkMcp(browser);
      ok = check.ok;
      say(check.ok ? `✔ Atlassian (browser sign-in) · ${check.count} tools` : `✗ Atlassian (browser sign-in): ${check.error}`);
    }
    const cfg = atlassianSite();
    if (!cfg) {
      if (!store.signedIn()) say('Not signed in to Atlassian. Run: agent atlassian login');
      return ok ? 0 : 1;
    }
    const token = readToken(cfg.site);
    if (!token) { say(`${cfg.site} is set up but no token is stored. Run: agent atlassian login --token`); return 1; }
    try {
      const me = await createJiraClient({ ...cfg, token }).myself();
      say(`✔ ${kindName(cfg.kind)} · ${cfg.site} · signed in as ${me?.displayName || me?.name}`);
      return 0;
    } catch (err) {
      say(`✗ ${cfg.site}: ${err.message}`);
      return 1;
    }
  }

  if (sub !== 'login') {
    say('Usage: agent atlassian login [--token] | logout | status');
    return 1;
  }
  if (!argv.includes('--token')) return browserLogin(say, browser);

  const rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
  try {
    const prev = atlassianSite();
    const siteIn = await ask(rl, `Jira site${prev?.site ? ` [${prev.site}]` : ' (e.g. https://yourcompany.atlassian.net)'}: `);
    const site = normalizeSite(siteIn || prev?.site || '');
    if (!site) { say('That is not a site address.'); return 1; }
    const { kind, version } = await detectKind(site, { guess: guessKind(site) });
    say(`${kindName(kind)}${version ? ` ${version}` : ''}`);

    let email = '';
    if (kind === 'cloud') {
      email = await ask(rl, `Email${prev?.email ? ` [${prev.email}]` : ''}: `) || prev?.email || '';
      say(`API token: create one at ${CLOUD_TOKEN_URL}`);
    } else {
      say('Personal access token: your profile picture → Profile → Personal Access Tokens → Create token');
    }
    const token = await ask(rl, 'Token (not shown): ', { hidden: true });
    const r = await loginWith({ site, kind, email, token });
    if (!r.ok) { say(`✗ ${r.error}`); return 1; }
    say(`✔ Signed in to ${site} as ${r.name}.`);
    say(process.platform === 'darwin' ? 'The token is in your login Keychain (agent-cli-atlassian).' : 'The token is in ~/.agent/atlassian-token.json (readable only by you).');
    say('In the agent, the model is offered Jira with your next message. Every write will ask you first.');
    return 0;
  } finally {
    rl.close();
  }
}
