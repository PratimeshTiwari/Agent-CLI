/**
 * `jira_issue` against a fake Jira, Cloud and Server/DC (v8.1).
 *
 * Reads answer in Markdown; a write is planned (what the approval box shows)
 * and runs only with a one-use approval token. The fake records every
 * request, so "nothing was sent" is a count, not a belief.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeJira, useFakeJira } from '../atlassian/fake-jira.js';
import { jiraIssue, planJiraWrite, isJiraWrite } from '../../src/mcp/tools/jira-issue.js';
import { issueApproval } from '../../src/core/approval-token.js';
import { _resetTokenCache } from '../../src/atlassian/config.js';

/** Plan, then run with a fresh token — what external-approval does after Send. */
async function approved(args) {
  const plan = await planJiraWrite(args);
  if (plan.answer) return { plan, out: plan.answer };
  return { plan, out: await jiraIssue(args, { approval: issueApproval(), plan }) };
}

for (const kind of ['cloud', 'dc']) {
  describe(`jira_issue on ${kind}`, () => {
    let fake;
    let restore;
    before(async () => {
      fake = await startFakeJira({ kind });
      restore = useFakeJira(fake);
      _resetTokenCache();
    });
    after(async () => {
      restore();
      await fake.close();
    });

    it('get: the issue as Markdown, with what a write could not keep named', async () => {
      const out = await jiraIssue({ action: 'get', key: 'proj-12' });
      assert.match(out, /^PROJ-12 · Fix login timeout/);
      assert.match(out, /Status: In Progress · Type: Bug · Priority: High/);
      assert.match(out, /Assignee: Ana Silva · Reporter: Raj Rao · Labels: auth/);
      assert.match(out, /Login times out after `30s`\./);
      assert.match(out, /Prod only/);
      assert.match(out, /has panel/);
      assert.match(out, /\*\*Raj Rao\*\* · 2026-10-29\nSeen on Safari too\./);
      assert.ok(out.includes(`${fake.site}/browse/PROJ-12`));
      const req = fake.requests.at(-1);
      assert.equal(req.path, `/rest/api/${kind === 'cloud' ? 3 : 2}/issue/PROJ-12`);
    });

    it('search: one line per issue, on the endpoint each kind has', async () => {
      const out = await jiraIssue({ action: 'search', jql: 'project = PROJ', limit: 99 });
      assert.match(out, /^2 issues · project = PROJ/);
      assert.match(out, /PROJ-13 · In Progress · unassigned · Second/);
      const req = fake.requests.at(-1);
      assert.equal(req.path, kind === 'cloud' ? '/rest/api/3/search/jql' : '/rest/api/2/search');
      assert.equal(req.query.maxResults, '50', 'limit capped at 50');
    });

    it('a write without an approval token is refused, and nothing is sent', async () => {
      const before = fake.writes().length;
      const plan = await planJiraWrite({ action: 'comment', key: 'PROJ-12', body: 'hi' });
      await assert.rejects(jiraIssue({ action: 'comment', key: 'PROJ-12', body: 'hi' }, { plan }), /only after the user approves/);
      await assert.rejects(jiraIssue({ action: 'comment', key: 'PROJ-12', body: 'hi' }, { plan, approval: { approved: true } }), /only after/);
      assert.equal(fake.writes().length, before);
    });

    it('a token works once', async () => {
      const plan = await planJiraWrite({ action: 'comment', key: 'PROJ-12', body: 'hi' });
      const token = issueApproval();
      await jiraIssue({ action: 'comment', key: 'PROJ-12', body: 'hi' }, { approval: token, plan });
      const n = fake.writes().length;
      await assert.rejects(jiraIssue({ action: 'comment', key: 'PROJ-12', body: 'hi' }, { approval: token, plan }), /only after/);
      assert.equal(fake.writes().length, n);
    });

    it('create: the box shows every field; the request is the converted Markdown', async () => {
      const { plan, out } = await approved({
        action: 'create', project: 'proj', type: 'Story', summary: 'Add SSO', labels: ['auth', 'sso'],
        assignee: 'me', priority: 'High', description: '## Why\n\n- **SAML** first',
      });
      assert.equal(plan.title, 'Create this issue in Jira (PROJ)?');
      assert.deepEqual(plan.lines.slice(0, 6), [
        'Project: PROJ · Type: Story', 'Summary: Add SSO', 'Labels: auth, sso', 'Priority: High',
        'Assignee: Me Person (you)', 'Description (3 lines):',
      ]);
      assert.match(out, /^Created PROJ-46 · Add SSO\n.*\/browse\/PROJ-46$/);
      const body = fake.writes().at(-1).body;
      assert.equal(body.fields.project.key, 'PROJ');
      assert.deepEqual(body.fields.assignee, kind === 'cloud' ? { accountId: 'acc-me' } : { name: 'me' });
      if (kind === 'cloud') {
        assert.equal(body.fields.description.type, 'doc');
        assert.equal(body.fields.description.content[0].type, 'heading');
      } else {
        assert.equal(body.fields.description, 'h2. Why\n\n* *SAML* first');
      }
    });

    it('update: from → to per field, the description diffed, and a warning for what it replaces', async () => {
      const { plan } = await approved({ action: 'update', key: 'PROJ-12', summary: 'Fix login timeout on Safari', description: 'Login times out after `30s`.\n\nOnly on Safari.' });
      assert.equal(plan.title, 'Update PROJ-12 in Jira?');
      assert.ok(plan.lines.includes('Summary: Fix login timeout → Fix login timeout on Safari'));
      assert.ok(plan.lines.some((l) => /^⚠ The current description has panel; this replaces them with plain text\.$/.test(l)), plan.lines.join('\n'));
      assert.ok(plan.lines.includes('  + Only on Safari.'));
      const sent = fake.writes().at(-1);
      assert.equal(sent.method, 'PUT');
      assert.deepEqual(Object.keys(sent.body.fields).sort(), ['description', 'summary']);
    });

    it('update with nothing different sends nothing and asks nothing', async () => {
      const n = fake.writes().length;
      const plan = await planJiraWrite({ action: 'update', key: 'PROJ-12', summary: 'Fix login timeout' });
      assert.match(plan.answer.result, /nothing to change/);
      assert.equal(fake.writes().length, n);
    });

    it('transition: by status name; a miss lists what is open and sends nothing', async () => {
      const { plan, out } = await approved({ action: 'transition', key: 'PROJ-12', to: 'done' });
      assert.equal(plan.title, 'Move PROJ-12 to Done?');
      assert.ok(plan.lines.includes('Status: In Progress → Done'));
      assert.match(out, /PROJ-12: In Progress → Done/);
      assert.deepEqual(fake.writes().at(-1).body, { transition: { id: '31' } });

      const n = fake.writes().length;
      const miss = await planJiraWrite({ action: 'transition', key: 'PROJ-12', to: 'Shipped' });
      assert.equal(miss.answer.success, false);
      assert.match(miss.answer.error, /cannot move to "Shipped".*Done, Back to To Do \(→ To Do\)/);
      assert.equal(fake.writes().length, n);
    });

    it('assignee by a name that matches two people: an error naming them, before anything is asked', async () => {
      await assert.rejects(planJiraWrite({ action: 'update', key: 'PROJ-12', assignee: 'ana' }), /"ana" matches 2 people: Ana Silva <ana@example\.com>, Ana Bell/);
      const { plan } = await approved({ action: 'update', key: 'PROJ-12', assignee: 'ana@example.com' });
      assert.ok(plan.lines.includes('Assignee: Ana Silva → Ana Silva'));
    });

    it('attach: sizes in the box; a missing file is an error before anything is asked', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'jira-att-'));
      const f = join(dir, 'flow.png');
      writeFileSync(f, Buffer.alloc(2048));
      const { plan, out } = await approved({ action: 'attach', key: 'PROJ-12', files: [f] });
      assert.ok(plan.lines.includes('  flow.png (2 KB)'));
      assert.match(out, /Attached flow\.png to PROJ-12/);
      const sent = fake.writes().at(-1);
      assert.equal(sent.headers['x-atlassian-token'], 'no-check');
      assert.match(sent.headers['content-type'], /multipart\/form-data/);
      await assert.rejects(planJiraWrite({ action: 'attach', key: 'PROJ-12', files: [join(dir, 'nope.png')] }), /does not exist/);
    });

    it('forbidden: handed to the person, not retried, not claimed', async () => {
      const base = `/rest/api/${kind === 'cloud' ? 3 : 2}`;
      fake.fail[`POST ${base}/issue/PROJ-12/comment`] = { status: 403, message: 'You do not have permission to comment', once: true };
      const n = fake.writes().length;
      const { out } = await approved({ action: 'comment', key: 'PROJ-12', body: 'hi' });
      assert.match(out, /^HANDED OFF — not done\. Jira does not let this account add the comment to PROJ-12 \(403: You do not have permission to comment\)/);
      assert.match(out, /Do not retry it and do not say it was done\./);
      assert.equal(fake.writes().length, n + 1, 'one attempt');
    });

    it('a bad request says what Jira said, so the model can fix it', async () => {
      fake.fail['POST ' + `/rest/api/${kind === 'cloud' ? 3 : 2}/issue`] = { status: 400, body: { errorMessages: [], errors: { priority: 'Field cannot be set.' } }, once: true };
      await assert.rejects(approved({ action: 'create', project: 'PROJ', type: 'Bug', summary: 'x', priority: 'Blocker' }), /priority: Field cannot be set\./);
    });

    it('a key that is not a key, and an action that does not exist', async () => {
      await assert.rejects(jiraIssue({ action: 'get', key: 'login bug' }), /not an issue key/);
      await assert.rejects(planJiraWrite({ action: 'delete', key: 'PROJ-12' }), /no action "delete"/);
    });
  });
}

describe('which actions write', () => {
  it('only get and search are reads; anything unknown counts as a write', () => {
    assert.deepEqual(['get', 'search', 'GET'].map(isJiraWrite), [false, false, false]);
    assert.deepEqual(['create', 'update', 'comment', 'transition', 'attach', 'delete', '', undefined].map(isJiraWrite), Array(8).fill(true));
  });
});

describe('not set up', () => {
  it('says how to set it up', async () => {
    const restore = useFakeJira({ site: '', kind: 'cloud' });
    delete process.env.ATLASSIAN_SITE;
    try {
      await assert.rejects(jiraIssue({ action: 'get', key: 'PROJ-1' }), /agent atlassian login/);
    } finally {
      restore();
    }
  });
});
