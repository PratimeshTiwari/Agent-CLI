/**
 * A Jira that answers the calls `jira_issue` makes, Cloud-shaped or DC-shaped,
 * and records every request — so a test can say "nothing was sent" by
 * counting, not by trusting the code that decided not to send.
 */
import http from 'node:http';

export const TOKEN = 'tok-123';
export const EMAIL = 'me@example.com';

const adfDesc = {
  type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Login times out after ' }, { type: 'text', text: '30s', marks: [{ type: 'code' }] }, { type: 'text', text: '.' }] },
    { type: 'panel', attrs: { panelType: 'warning' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prod only' }] }] },
  ],
};
const wikiDesc = 'Login times out after {{30s}}.\n\n{panel}\nProd only\n{panel}';

export async function startFakeJira({ kind = 'cloud', fail = {} } = {}) {
  const requests = [];
  const cloud = kind === 'cloud';
  const v = cloud ? 3 : 2;
  const text = (s) => (cloud ? { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] } : s);

  const issue = (key) => ({
    key,
    fields: {
      summary: 'Fix login timeout',
      status: { name: 'In Progress' },
      issuetype: { name: 'Bug' },
      priority: { name: 'High' },
      assignee: { displayName: 'Ana Silva' },
      reporter: { displayName: 'Raj Rao' },
      labels: ['auth'],
      description: cloud ? adfDesc : wikiDesc,
      created: '2026-10-01T10:00:00.000+0000',
      updated: '2026-10-30T10:00:00.000+0000',
      comment: { total: 1, comments: [{ author: { displayName: 'Raj Rao' }, created: '2026-10-29T10:00:00.000+0000', body: text('Seen on Safari too.') }] },
    },
  });

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const route = `${req.method} ${url.pathname}`;
      const isJson = /json/.test(req.headers['content-type'] || '');
      requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: isJson && raw ? JSON.parse(raw) : raw });
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json', ...(status === 429 ? { 'retry-after': '0' } : {}) });
        res.end(body === undefined ? '' : JSON.stringify(body));
      };

      if (route === `GET /rest/api/2/serverInfo`) return send(200, { deploymentType: cloud ? 'Cloud' : 'DataCenter', version: cloud ? '1001.0.0' : '9.12.0' });

      const auth = req.headers.authorization || '';
      const good = cloud ? auth === `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}` : auth === `Bearer ${TOKEN}`;
      if (!good) return send(401, { errorMessages: ['Unauthorized'] });

      const f = fail[route];
      if (f) {
        if (f.once) delete fail[route];
        return send(f.status, f.body || { errorMessages: [f.message || 'refused'] });
      }

      const base = `/rest/api/${v}`;
      const p = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : null;
      if (p === null) return send(404, { errorMessages: [`not ${base}`] });
      let m;
      if (req.method === 'GET' && p === '/myself') return send(200, { accountId: 'acc-me', name: 'me', displayName: 'Me Person' });
      if (req.method === 'GET' && (m = p.match(/^\/issue\/([A-Z]+-\d+)$/))) {
        if (m[1] === 'NOPE-1') return send(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
        return send(200, issue(m[1]));
      }
      if (req.method === 'GET' && p === (cloud ? '/search/jql' : '/search')) {
        const issues = [issue('PROJ-12'), { ...issue('PROJ-13'), fields: { ...issue('PROJ-13').fields, summary: 'Second', assignee: null } }];
        return send(200, cloud ? { issues, isLast: true } : { issues, total: 2 });
      }
      if (req.method === 'GET' && p === '/user/search') {
        return send(200, [
          { accountId: 'acc-ana', name: 'ana', displayName: 'Ana Silva', emailAddress: 'ana@example.com', active: true },
          { accountId: 'acc-anb', name: 'anb', displayName: 'Ana Bell', emailAddress: 'anb@example.com', active: true },
        ].filter((u) => JSON.stringify(u).toLowerCase().includes(String(url.searchParams.get('query') || url.searchParams.get('username') || '').toLowerCase())));
      }
      if (req.method === 'POST' && p === '/issue') return send(201, { key: 'PROJ-46', id: '10046' });
      if (req.method === 'PUT' && /^\/issue\/[A-Z]+-\d+$/.test(p)) return send(204);
      if (req.method === 'POST' && /^\/issue\/[A-Z]+-\d+\/comment$/.test(p)) return send(201, { id: '1001' });
      if (req.method === 'GET' && /^\/issue\/[A-Z]+-\d+\/transitions$/.test(p)) {
        return send(200, { transitions: [{ id: '31', name: 'Done', to: { name: 'Done' } }, { id: '11', name: 'Back to To Do', to: { name: 'To Do' } }] });
      }
      if (req.method === 'POST' && /^\/issue\/[A-Z]+-\d+\/transitions$/.test(p)) return send(204);
      if (req.method === 'POST' && /^\/issue\/[A-Z]+-\d+\/attachments$/.test(p)) return send(200, [{ id: 'a1' }]);
      return send(404, { errorMessages: [`no route ${route}`] });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const site = `http://127.0.0.1:${server.address().port}`;
  return {
    site,
    kind,
    requests,
    fail,
    /** Requests that would change something in Jira. */
    writes: () => requests.filter((r) => r.method !== 'GET'),
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Point the agent at a fake: env wins over settings, and never the Keychain. */
export function useFakeJira(fake) {
  const prev = {
    ATLASSIAN_SITE: process.env.ATLASSIAN_SITE, ATLASSIAN_KIND: process.env.ATLASSIAN_KIND,
    ATLASSIAN_EMAIL: process.env.ATLASSIAN_EMAIL, ATLASSIAN_TOKEN: process.env.ATLASSIAN_TOKEN,
    AGENT_ATLASSIAN_NO_KEYCHAIN: process.env.AGENT_ATLASSIAN_NO_KEYCHAIN,
  };
  process.env.ATLASSIAN_SITE = fake.site;
  process.env.ATLASSIAN_KIND = fake.kind;
  process.env.ATLASSIAN_EMAIL = EMAIL;
  process.env.ATLASSIAN_TOKEN = TOKEN;
  process.env.AGENT_ATLASSIAN_NO_KEYCHAIN = '1';
  return () => {
    for (const [k, val] of Object.entries(prev)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  };
}
