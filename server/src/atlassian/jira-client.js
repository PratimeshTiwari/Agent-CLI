/**
 * Jira's REST API, Cloud and Server/Data Center behind one surface (v8.1).
 *
 * | | Cloud | Server / Data Center |
 * | --- | --- | --- |
 * | API | `/rest/api/3` | `/rest/api/2` |
 * | auth | Basic, email + API token | Bearer, personal access token |
 * | text | ADF (`adf.js`) | wiki markup (`wiki.js`) |
 * | users | `accountId` | `name` |
 * | search | `GET /search/jql` (the old `/search` was removed on Cloud) | `GET /search` |
 *
 * The client never retries a request on its own except after a 429, which
 * Jira sends *instead of* doing the work — so a retry cannot post a comment
 * twice. A timeout or a dropped connection on a write is reported as unknown,
 * not retried: the request may have landed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { markdownToAdf, adfToMarkdown } from './adf.js';
import { markdownToWiki, wikiToMarkdown } from './wiki.js';

export class JiraError extends Error {
  constructor(message, { status = 0, kind = 'error' } = {}) {
    super(message);
    this.status = status;
    // `auth` · `forbidden` · `not_found` · `bad_request` · `network` · `error`
    this.kind = kind;
  }
}

/** Jira's own error text: `errorMessages` and the per-field `errors`, in one line. */
export function jiraErrorText(data, status) {
  const parts = [];
  if (Array.isArray(data?.errorMessages)) parts.push(...data.errorMessages.filter(Boolean));
  if (data?.errors && typeof data.errors === 'object') {
    for (const [field, msg] of Object.entries(data.errors)) parts.push(`${field}: ${msg}`);
  }
  if (!parts.length && typeof data?.message === 'string') parts.push(data.message);
  if (!parts.length && typeof data === 'string' && data.trim() && !/^\s*</.test(data)) parts.push(data.trim().slice(0, 300));
  return parts.join('; ') || `HTTP ${status}`;
}

const KIND_BY_STATUS = { 400: 'bad_request', 401: 'auth', 403: 'forbidden', 404: 'not_found' };

/**
 * @param {{site: string, kind: 'cloud'|'dc', email?: string, token: string,
 *   fetchImpl?: Function, timeoutMs?: number, sleep?: Function}} opts
 */
export function createJiraClient({ site, kind, email = '', token, fetchImpl = globalThis.fetch, timeoutMs = 20_000, sleep }) {
  const cloud = kind === 'cloud';
  const api = `${site}/rest/api/${cloud ? 3 : 2}`;
  const auth = cloud
    ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
    : `Bearer ${token}`;
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  async function request(method, p, { body, query, form, write = method !== 'GET' } = {}) {
    const url = new URL(api + p);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const headers = { Authorization: auth, Accept: 'application/json' };
    let payload;
    if (form) {
      payload = form;
      // Jira refuses an attachment upload without this (XSRF check).
      headers['X-Atlassian-Token'] = 'no-check';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        const why = err?.name === 'TimeoutError' ? `no answer in ${Math.round(timeoutMs / 1000)}s` : (err?.cause?.code || err?.message || 'network error');
        const proxy = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|UND_ERR|no answer/.test(why)
          ? ' If this machine reaches the internet through a proxy, start the agent with NODE_USE_ENV_PROXY=1 and HTTPS_PROXY set.'
          : '';
        const unsure = write ? ' It may or may not have been done: check in Jira before trying again.' : '';
        throw new JiraError(`Could not reach ${site} (${why}).${unsure}${proxy}`, { kind: 'network' });
      }
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      if (res.status === 429 && attempt === 0) {
        const after = Number(res.headers.get('retry-after'));
        await wait(Math.min(10, Number.isFinite(after) && after > 0 ? after : 2) * 1000);
        continue;
      }
      if (res.ok) return data;
      const kindOf = KIND_BY_STATUS[res.status] || 'error';
      const msg = jiraErrorText(data, res.status);
      if (kindOf === 'auth') {
        throw new JiraError(`Jira refused the token for ${site} (401). Ask the user to run \`agent atlassian login\` again.`, { status: 401, kind: 'auth' });
      }
      throw new JiraError(msg, { status: res.status, kind: kindOf });
    }
  }

  const toText = (md) => (cloud ? markdownToAdf(md) : markdownToWiki(md));
  const fromText = (v) => (cloud ? adfToMarkdown(v) : wikiToMarkdown(v));

  return {
    site,
    kind,
    cloud,
    request,
    toText,
    fromText,
    issueUrl: (key) => `${site}/browse/${key}`,

    myself: () => request('GET', '/myself'),

    getIssue: (key, fields) => request('GET', `/issue/${encodeURIComponent(key)}`, { query: { fields } }),

    search: (jql, { fields, limit }) => (cloud
      ? request('GET', '/search/jql', { query: { jql, fields, maxResults: limit } })
      : request('GET', '/search', { query: { jql, fields, maxResults: limit } })),

    createIssue: (fields) => request('POST', '/issue', { body: { fields } }),
    updateIssue: (key, fields) => request('PUT', `/issue/${encodeURIComponent(key)}`, { body: { fields } }),
    addComment: (key, markdown) => request('POST', `/issue/${encodeURIComponent(key)}/comment`, { body: { body: toText(markdown) } }),
    transitions: (key) => request('GET', `/issue/${encodeURIComponent(key)}/transitions`),
    transition: (key, id) => request('POST', `/issue/${encodeURIComponent(key)}/transitions`, { body: { transition: { id: String(id) } } }),

    /** Users matching a name or email, as `{id, name, email}`. */
    async findUsers(q) {
      const list = cloud
        ? await request('GET', '/user/search', { query: { query: q, maxResults: 20 } })
        : await request('GET', '/user/search', { query: { username: q, maxResults: 20 } });
      return (Array.isArray(list) ? list : []).map((u) => ({
        id: cloud ? u.accountId : u.name,
        name: u.displayName || u.name || '',
        email: u.emailAddress || '',
        active: u.active !== false,
      }));
    },

    /** A user reference for `assignee`: `{accountId}` on Cloud, `{name}` on DC. */
    userRef: (id) => (cloud ? { accountId: id } : { name: id }),

    async attach(key, files) {
      const form = new FormData();
      for (const f of files) {
        form.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
      }
      return request('POST', `/issue/${encodeURIComponent(key)}/attachments`, { form });
    },
  };
}

/**
 * Cloud or Server/DC, asked of the site itself. `serverInfo` answers without
 * a login on both; when it does not, the host name decides.
 */
export async function detectKind(site, { fetchImpl = globalThis.fetch, guess } = {}) {
  try {
    const res = await fetchImpl(new URL(`${site}/rest/api/2/serverInfo`), {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const info = await res.json();
      if (/cloud/i.test(info?.deploymentType || '')) return { kind: 'cloud', version: info.version || '' };
      if (info?.deploymentType || info?.version) return { kind: 'dc', version: info.version || '' };
    }
  } catch { /* fall back to the host name */ }
  return { kind: guess, version: '' };
}
