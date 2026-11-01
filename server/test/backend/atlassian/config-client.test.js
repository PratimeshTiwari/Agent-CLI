/**
 * Where the site and token live, how the client talks to Jira, and
 * `agent atlassian login` (v8.1). The Keychain is skipped
 * (`AGENT_ATLASSIAN_NO_KEYCHAIN`), so the 0600 file path is what is tested
 * here; the Keychain path is the same three calls to `/usr/bin/security`.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  normalizeSite, guessKind, atlassianSite, atlassianCredentials, storeToken, readToken, isStorableToken,
  forgetAtlassianSite, saveAtlassianSite, _resetTokenCache,
} from '../../../src/backend/atlassian/config.js';
import { createJiraClient, detectKind, jiraErrorText } from '../../../src/backend/atlassian/jira-client.js';
import { loginWith, runAtlassianCli } from '../../../src/backend/atlassian/cli.js';
import { loadUserSettings } from '../../../src/backend/core/user-settings.js';
import { homeDir } from '../../../src/backend/core/paths.js';
import { startFakeJira, TOKEN, EMAIL } from './fake-jira.js';

const ENV = ['ATLASSIAN_SITE', 'ATLASSIAN_KIND', 'ATLASSIAN_EMAIL', 'ATLASSIAN_TOKEN', 'ATLASSIAN_API_TOKEN', 'AGENT_ATLASSIAN_NO_KEYCHAIN'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.AGENT_ATLASSIAN_NO_KEYCHAIN = '1';
  forgetAtlassianSite();
  _resetTokenCache();
});
afterEach(() => {
  forgetAtlassianSite();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetTokenCache();
});

describe('the site', () => {
  it('normalises what people paste', () => {
    assert.equal(normalizeSite('acme.atlassian.net'), 'https://acme.atlassian.net');
    assert.equal(normalizeSite('https://acme.atlassian.net/browse/PROJ-1'), 'https://acme.atlassian.net');
    assert.equal(normalizeSite('https://acme.atlassian.net/wiki/spaces/ENG'), 'https://acme.atlassian.net');
    assert.equal(normalizeSite('https://tools.corp.com/jira/browse/X-1'), 'https://tools.corp.com/jira');
    assert.equal(normalizeSite('https://jira.corp.com/'), 'https://jira.corp.com');
    assert.equal(normalizeSite(''), '');
  });

  it('guesses Cloud from the host, and DC otherwise', () => {
    assert.equal(guessKind('https://acme.atlassian.net'), 'cloud');
    assert.equal(guessKind('https://jira.corp.com'), 'dc');
  });

  it('environment wins over settings', () => {
    process.env.ATLASSIAN_SITE = 'acme.atlassian.net';
    process.env.ATLASSIAN_EMAIL = 'a@b.c';
    assert.deepEqual(atlassianSite(), { site: 'https://acme.atlassian.net', kind: 'cloud', email: 'a@b.c', from: 'env' });
  });

  it('says what is missing, in a sentence the model can pass on', () => {
    assert.match(atlassianCredentials().error, /not set up.*agent atlassian login/);
    process.env.ATLASSIAN_SITE = 'acme.atlassian.net';
    assert.match(atlassianCredentials().error, /No token is stored/);
    process.env.ATLASSIAN_TOKEN = 'x';
    assert.match(atlassianCredentials().error, /needs the account's email/);
  });
});

describe('the token', () => {
  it('is stored readable only by its owner, and never in settings.json', () => {
    storeToken('https://acme.atlassian.net', 'secret-1');
    const file = join(homeDir(), 'atlassian-token.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    _resetTokenCache();
    assert.equal(readToken('https://acme.atlassian.net'), 'secret-1');
    assert.ok(!JSON.stringify(loadUserSettings()).includes('secret-1'));
  });

  it('refuses a token that would be stored mangled', () => {
    assert.equal(isStorableToken('ab"c'), false);
    assert.equal(isStorableToken('a b'), false);
    assert.equal(isStorableToken(''), false);
    assert.throws(() => storeToken('https://x.io', 'a b'), /spaces, quotes/);
  });

  it('logout deletes it', () => {
    saveAtlassianSite({ site: 'https://acme.atlassian.net', kind: 'cloud', email: 'a@b.c' });
    storeToken('https://acme.atlassian.net', 'secret-2');
    forgetAtlassianSite();
    assert.equal(atlassianSite(), null);
    _resetTokenCache();
    assert.equal(readToken('https://acme.atlassian.net'), '');
  });
});

describe('the client', () => {
  it('Cloud: Basic auth on /rest/api/3; DC: Bearer on /rest/api/2', async () => {
    for (const kind of ['cloud', 'dc']) {
      const fake = await startFakeJira({ kind });
      const me = await createJiraClient({ site: fake.site, kind, email: EMAIL, token: TOKEN }).myself();
      assert.equal(me.displayName, 'Me Person');
      assert.equal(fake.requests.at(-1).path, `/rest/api/${kind === 'cloud' ? 3 : 2}/myself`);
      assert.match(fake.requests.at(-1).headers.authorization, kind === 'cloud' ? /^Basic / : /^Bearer tok-123$/);
      await fake.close();
    }
  });

  it('a wrong token says to log in again', async () => {
    const fake = await startFakeJira({ kind: 'dc' });
    await assert.rejects(createJiraClient({ site: fake.site, kind: 'dc', token: 'wrong' }).myself(), /refused the token.*agent atlassian login/);
    await fake.close();
  });

  it('a 429 is retried once — Jira did not do the work — and a second one is reported', async () => {
    const fake = await startFakeJira({ kind: 'cloud' });
    const c = createJiraClient({ site: fake.site, kind: 'cloud', email: EMAIL, token: TOKEN, sleep: async () => {} });
    fake.fail['POST /rest/api/3/issue/PROJ-1/comment'] = { status: 429, once: true };
    await c.addComment('PROJ-1', 'hi');
    assert.equal(fake.writes().length, 2, 'the refused one and the retry');

    fake.fail['POST /rest/api/3/issue/PROJ-2/comment'] = { status: 429, message: 'slow down' };
    await assert.rejects(c.addComment('PROJ-2', 'hi'), /slow down/);
    assert.equal(fake.writes().length, 4, 'once more, then it stops');
    await fake.close();
  });

  it('a write that never answered is not retried, and says it may have landed', async () => {
    let calls = 0;
    const hang = async (url, { signal }) => {
      calls++;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    };
    const c = createJiraClient({ site: 'https://acme.atlassian.net', kind: 'cloud', email: EMAIL, token: TOKEN, fetchImpl: hang, timeoutMs: 30 });
    // AbortSignal.timeout's timer does not hold the process open; a real
    // request's socket does. This stands in for the socket.
    const alive = setInterval(() => {}, 1000);
    try {
      await assert.rejects(c.addComment('PROJ-1', 'hi'), /no answer in 0s\)\. It may or may not have been done: check in Jira/);
      assert.equal(calls, 1);
      await assert.rejects(c.getIssue('PROJ-1'), (e) => !/may or may not/.test(e.message));
    } finally {
      clearInterval(alive);
    }
  });

  it("Jira's error text, field by field", () => {
    assert.equal(jiraErrorText({ errorMessages: ['Bad'], errors: { summary: 'required' } }, 400), 'Bad; summary: required');
    assert.equal(jiraErrorText('<html>', 502), 'HTTP 502');
  });

  it('detects the kind from serverInfo, or falls back to the guess', async () => {
    const fake = await startFakeJira({ kind: 'dc' });
    assert.deepEqual(await detectKind(fake.site, { guess: 'cloud' }), { kind: 'dc', version: '9.12.0' });
    await fake.close();
    assert.deepEqual(await detectKind('http://127.0.0.1:9', { guess: 'cloud' }), { kind: 'cloud', version: '' });
  });
});

describe('agent atlassian login', () => {
  it('stores nothing until Jira accepts the token', async () => {
    const fake = await startFakeJira({ kind: 'cloud' });
    const bad = await loginWith({ site: fake.site, kind: 'cloud', email: EMAIL, token: 'wrong' });
    assert.equal(bad.ok, false);
    assert.equal(atlassianSite(), null);
    assert.equal(existsSync(join(homeDir(), 'atlassian-token.json')) && readFileSync(join(homeDir(), 'atlassian-token.json'), 'utf8').includes('wrong'), false);

    const good = await loginWith({ site: fake.site, kind: 'cloud', email: EMAIL, token: TOKEN });
    assert.deepEqual(good, { ok: true, name: 'Me Person', kind: 'cloud' });
    assert.equal(atlassianSite().site, fake.site);
    _resetTokenCache();
    assert.equal(readToken(fake.site), TOKEN);
    await fake.close();
  });

  it('the interactive flow: site, kind detected, token not echoed', async () => {
    const fake = await startFakeJira({ kind: 'dc' });
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = '';
    output.on('data', (d) => { shown += d; });
    const done = runAtlassianCli(['login'], { input, output });
    input.write(`${fake.site}\n`);
    await new Promise((r) => setTimeout(r, 100));
    input.write(`${TOKEN}\n`);
    assert.equal(await done, 0);
    assert.match(shown, /Jira Server \/ Data Center 9\.12\.0/);
    assert.match(shown, /✔ Signed in to http:\/\/127\.0\.0\.1:\d+ as Me Person/);
    assert.match(shown, /\/prompt v4/);
    assert.ok(!shown.includes(TOKEN), 'the token is never written to the terminal');
    await fake.close();
  });

  it('status and logout', async () => {
    const out = new PassThrough();
    let shown = '';
    out.on('data', (d) => { shown += d; });
    assert.equal(await runAtlassianCli(['status'], { output: out }), 1);
    assert.match(shown, /Not signed in/);
    assert.equal(await runAtlassianCli(['logout'], { output: out }), 0);
    assert.equal(await runAtlassianCli(['nope'], { output: out }), 1);
    assert.match(shown, /Usage: agent atlassian login \| logout \| status/);
  });
});
