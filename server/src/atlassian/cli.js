/**
 * `agent atlassian login | logout | status` (v8.1).
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

export async function runAtlassianCli(argv = [], { input = process.stdin, output = process.stdout } = {}) {
  const sub = argv[0] || 'status';
  const say = (line = '') => output.write(`${line}\n`);

  if (sub === 'logout') {
    const cfg = atlassianSite();
    if (!cfg || cfg.from === 'env') {
      say(cfg ? 'Jira is set from ATLASSIAN_* environment variables; unset them to sign out.' : 'Not signed in to Jira.');
      return 0;
    }
    forgetAtlassianSite();
    say(`Signed out of ${cfg.site}; the token is deleted.`);
    return 0;
  }

  if (sub === 'status') {
    const cfg = atlassianSite();
    if (!cfg) { say('Not signed in to Jira. Run: agent atlassian login'); return 1; }
    const token = readToken(cfg.site);
    if (!token) { say(`${cfg.site} is set up but no token is stored. Run: agent atlassian login`); return 1; }
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
    say('Usage: agent atlassian login | logout | status');
    return 1;
  }

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
    say('In the agent, /prompt v4 offers Jira to the model. Every write will ask you first.');
    return 0;
  } finally {
    rl.close();
  }
}
