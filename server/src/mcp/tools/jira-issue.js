/**
 * `jira_issue` (v8.1): read, search, create, update, comment on, move and
 * attach to Jira issues, Cloud or Server/Data Center.
 *
 * Reads run as any tool does. A write runs in two steps, and the second only
 * with the person's yes:
 *
 * 1. `planJiraWrite(args)` — called by `core/external-approval.js` — checks the
 *    arguments, reads what it needs (the issue as it is, the transitions that
 *    exist, who "me" is), and returns the lines the approval box shows plus a
 *    `perform` that does exactly that write.
 * 2. The handler runs `perform` only when the call's context carries a token
 *    from `approval-token.js`, and each token works once. Without one it
 *    refuses: a write cannot happen by reaching this handler some other way.
 *
 * Text goes in and out as Markdown; `atlassian/adf.js` (Cloud) and
 * `atlassian/wiki.js` (DC) convert it. What the model is told after a write is
 * one line and the link. When Jira will not let this account do something, the
 * result hands it to the person instead of failing, so the model says so
 * rather than retrying or claiming it happened.
 */
import fs from 'node:fs';
import path from 'node:path';
import { diffLines } from 'diff';
import { atlassianCredentials } from '../../atlassian/config.js';
import { createJiraClient, JiraError } from '../../atlassian/jira-client.js';
import { consumeApproval } from '../../core/approval-token.js';

export const JIRA_READS = new Set(['get', 'search']);
export const JIRA_WRITES = new Set(['create', 'update', 'comment', 'transition', 'attach']);

/** An unknown or missing action is treated as a write: fail closed. */
export function isJiraWrite(action) {
  return !JIRA_READS.has(String(action || '').toLowerCase());
}

const ISSUE_FIELDS = 'summary,status,issuetype,assignee,reporter,priority,labels,parent,description,comment,created,updated';
const MAX_DESCRIPTION = 8_000;
const MAX_COMMENT = 1_500;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** For the tests: a client against a fake server. */
let clientFactory = (creds) => createJiraClient(creds);
export function _setJiraClientFactory(fn) {
  clientFactory = fn || ((creds) => createJiraClient(creds));
}

function client() {
  const creds = atlassianCredentials();
  if (creds.error) throw new Error(creds.error);
  return clientFactory(creds);
}

const need = (args, ...keys) => {
  const missing = keys.filter((k) => args[k] === undefined || args[k] === null || String(args[k]).trim() === '');
  if (missing.length) throw new Error(`jira_issue ${args.action} needs ${missing.join(' and ')}.`);
};

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
function issueKey(k) {
  const key = String(k || '').trim().toUpperCase();
  if (!ISSUE_KEY.test(key)) throw new Error(`"${k}" is not an issue key; keys look like PROJ-123.`);
  return key;
}

const nameOf = (u) => u?.displayName || u?.name || '';
const day = (t) => (t ? String(t).slice(0, 10) : '');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… ${(s.length - n).toLocaleString()} more characters` : s);

/* ------------------------------------------------------------------ reads */

async function getIssue(args) {
  need(args, 'key');
  const jira = client();
  const key = issueKey(args.key);
  const issue = await jira.getIssue(key, ISSUE_FIELDS);
  const f = issue.fields || {};
  const desc = jira.fromText(f.description);
  const lines = [
    `${issue.key} · ${f.summary || ''}`,
    [f.status?.name && `Status: ${f.status.name}`, f.issuetype?.name && `Type: ${f.issuetype.name}`,
      f.priority?.name && `Priority: ${f.priority.name}`].filter(Boolean).join(' · '),
    [`Assignee: ${nameOf(f.assignee) || 'unassigned'}`, f.reporter && `Reporter: ${nameOf(f.reporter)}`,
      f.labels?.length && `Labels: ${f.labels.join(', ')}`, f.parent?.key && `Parent: ${f.parent.key}`].filter(Boolean).join(' · '),
    [f.created && `Created ${day(f.created)}`, f.updated && `Updated ${day(f.updated)}`].filter(Boolean).join(' · '),
    jira.issueUrl(issue.key),
    '',
    '## Description',
    desc.markdown ? clip(desc.markdown, MAX_DESCRIPTION) : '(none)',
  ];
  if (desc.lost.length) {
    lines.push('', `(The description also has ${desc.lost.join(', ')}, shown above as plain text; an update to it replaces them.)`);
  }
  const comments = f.comment?.comments || [];
  if (comments.length) {
    const shown = comments.slice(-5);
    const total = f.comment.total ?? comments.length;
    lines.push('', `## Comments (${shown.length} of ${total}, newest last)`);
    for (const c of shown) {
      lines.push('', `**${nameOf(c.author) || 'someone'}** · ${day(c.created)}`, clip(jira.fromText(c.body).markdown, MAX_COMMENT));
    }
  }
  return lines.join('\n');
}

async function search(args) {
  need(args, 'jql');
  const jira = client();
  const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
  const r = await jira.search(String(args.jql), { fields: 'summary,status,assignee,issuetype,updated', limit });
  const issues = r?.issues || [];
  if (!issues.length) return `No issues match: ${args.jql}`;
  const more = typeof r.total === 'number' && r.total > issues.length ? ` of ${r.total}` : (r.isLast === false || r.nextPageToken ? '+' : '');
  return [
    `${issues.length}${more} issue${issues.length === 1 ? '' : 's'} · ${args.jql}`,
    ...issues.map((i) => {
      const f = i.fields || {};
      return `${i.key} · ${f.status?.name || '?'} · ${nameOf(f.assignee) || 'unassigned'} · ${f.summary || ''}`;
    }),
  ].join('\n');
}

/* ---------------------------------------------------------------- planning */

/** "me", "none", a name or an email → a user reference, or an error naming the candidates. */
async function resolveAssignee(jira, who) {
  const q = String(who).trim();
  if (/^(none|unassigned|nobody)$/i.test(q)) return { ref: null, label: 'unassigned' };
  if (/^(me|myself)$/i.test(q)) {
    const me = await jira.myself();
    return { ref: jira.userRef(jira.cloud ? me.accountId : me.name), label: `${me.displayName || me.name} (you)` };
  }
  const users = (await jira.findUsers(q)).filter((u) => u.active);
  const exact = users.filter((u) => u.email.toLowerCase() === q.toLowerCase() || u.name.toLowerCase() === q.toLowerCase());
  const pick = exact.length === 1 ? exact[0] : users.length === 1 ? users[0] : null;
  if (pick) return { ref: jira.userRef(pick.id), label: pick.name };
  if (!users.length) throw new Error(`No Jira user matches "${q}".`);
  throw new Error(`"${q}" matches ${users.length} people: ${users.slice(0, 5).map((u) => u.email ? `${u.name} <${u.email}>` : u.name).join(', ')}. Use the full name or email.`);
}

const labelsOf = (v) => (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);

/** The description lines that change, as `+`/`-` rows (at most 30). */
function descriptionDiff(before, after) {
  const rows = [];
  for (const part of diffLines(before ? `${before}\n` : '', after ? `${after}\n` : '')) {
    if (!part.added && !part.removed) continue;
    for (const l of part.value.replace(/\n$/, '').split('\n')) rows.push(`${part.added ? '+' : '-'} ${l}`);
  }
  return rows.length > 30 ? [...rows.slice(0, 30), `… ${rows.length - 30} more changed lines`] : rows;
}

const countLines = (s) => (s ? s.split('\n').length : 0);

async function headerOf(jira, key) {
  const issue = await jira.getIssue(key, 'summary,status,description,labels,assignee,priority,parent');
  return { issue, head: `${issue.key} · ${issue.fields?.summary || ''}` };
}

function existingFiles(files) {
  const list = (Array.isArray(files) ? files : [files]).map((f) => String(f || '').trim()).filter(Boolean);
  if (!list.length) throw new Error('jira_issue attach needs files: one or more local paths.');
  return list.map((f) => {
    const p = path.resolve(f.replace(/^~(?=\/|$)/, process.env.HOME || '~'));
    let st;
    try { st = fs.statSync(p); } catch { throw new Error(`${f} does not exist.`); }
    if (!st.isFile()) throw new Error(`${f} is not a file.`);
    if (st.size > MAX_FILE_BYTES) throw new Error(`${f} is ${(st.size / 1048576).toFixed(1)} MB; attach files under 10 MB, or hand this one to the user.`);
    return { path: p, name: path.basename(p), size: st.size };
  });
}

const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * Check a write, read what it needs, and say what it would do.
 *
 * @returns {Promise<{title: string, lines: string[], site: string, service: string, perform: Function}
 *   | {answer: {success: boolean, result?: string, error?: string}}>}
 */
export async function planJiraWrite(raw) {
  const args = { ...raw, action: String(raw.action || '').toLowerCase() };
  if (!JIRA_WRITES.has(args.action)) {
    throw new Error(`jira_issue has no action "${raw.action}". Actions: get, search, create, update, comment, transition, attach.`);
  }
  const jira = client();
  const base = { site: jira.site, service: 'Jira' };

  switch (args.action) {
    case 'create': {
      need(args, 'project', 'type', 'summary');
      const project = String(args.project).trim().toUpperCase();
      const fields = { project: { key: project }, issuetype: { name: String(args.type).trim() }, summary: String(args.summary).trim() };
      const lines = [`Project: ${project} · Type: ${fields.issuetype.name}`, `Summary: ${fields.summary}`];
      if (args.labels !== undefined) { fields.labels = labelsOf(args.labels); lines.push(`Labels: ${fields.labels.join(', ') || '(none)'}`); }
      if (args.priority) { fields.priority = { name: String(args.priority).trim() }; lines.push(`Priority: ${fields.priority.name}`); }
      if (args.parent) { fields.parent = { key: issueKey(args.parent) }; lines.push(`Parent: ${fields.parent.key}`); }
      if (args.assignee) {
        const a = await resolveAssignee(jira, args.assignee);
        fields.assignee = a.ref;
        lines.push(`Assignee: ${a.label}`);
      }
      if (args.description) {
        fields.description = jira.toText(String(args.description));
        lines.push(`Description (${countLines(String(args.description).trim())} lines):`, ...String(args.description).trim().split('\n').map((l) => `  ${l}`));
      }
      return {
        ...base,
        title: `Create this issue in Jira (${project})?`,
        lines,
        perform: async () => {
          const r = await jira.createIssue(fields);
          return `Created ${r.key} · ${fields.summary}\n${jira.issueUrl(r.key)}`;
        },
      };
    }

    case 'update': {
      need(args, 'key');
      const key = issueKey(args.key);
      const { issue, head } = await headerOf(jira, key);
      const f = issue.fields || {};
      const fields = {};
      const lines = [head];
      if (args.summary !== undefined && String(args.summary).trim() !== f.summary) {
        fields.summary = String(args.summary).trim();
        lines.push(`Summary: ${f.summary || ''} → ${fields.summary}`);
      }
      if (args.labels !== undefined) {
        fields.labels = labelsOf(args.labels);
        lines.push(`Labels: ${(f.labels || []).join(', ') || '(none)'} → ${fields.labels.join(', ') || '(none)'}`);
      }
      if (args.priority) {
        fields.priority = { name: String(args.priority).trim() };
        lines.push(`Priority: ${f.priority?.name || '(none)'} → ${fields.priority.name}`);
      }
      if (args.parent) {
        fields.parent = { key: issueKey(args.parent) };
        lines.push(`Parent: ${f.parent?.key || '(none)'} → ${fields.parent.key}`);
      }
      if (args.assignee) {
        const a = await resolveAssignee(jira, args.assignee);
        fields.assignee = a.ref;
        lines.push(`Assignee: ${nameOf(f.assignee) || 'unassigned'} → ${a.label}`);
      }
      if (args.description !== undefined) {
        const before = jira.fromText(f.description);
        const after = String(args.description).trim();
        fields.description = jira.toText(after);
        lines.push(`Description: ${countLines(before.markdown)} lines → ${countLines(after)} lines`);
        if (before.lost.length) {
          lines.push(`⚠ The current description has ${before.lost.join(', ')}; this replaces them with plain text.`);
        }
        lines.push(...descriptionDiff(before.markdown, after).map((l) => `  ${l}`));
      }
      if (!Object.keys(fields).length) {
        return { answer: { success: true, result: `${key}: nothing to change; the fields given already have those values.` } };
      }
      return {
        ...base,
        title: `Update ${key} in Jira?`,
        lines,
        perform: async () => {
          await jira.updateIssue(key, fields);
          return `Updated ${key} · ${Object.keys(fields).join(', ')}\n${jira.issueUrl(key)}`;
        },
      };
    }

    case 'comment': {
      need(args, 'key', 'body');
      const key = issueKey(args.key);
      const { head } = await headerOf(jira, key);
      const body = String(args.body).trim();
      return {
        ...base,
        title: `Comment on ${key} in Jira?`,
        lines: [head, ...body.split('\n').map((l) => `  ${l}`)],
        perform: async () => {
          const c = await jira.addComment(key, body);
          return `Commented on ${key}\n${jira.issueUrl(key)}${c?.id ? `?focusedCommentId=${c.id}` : ''}`;
        },
      };
    }

    case 'transition': {
      need(args, 'key', 'to');
      const key = issueKey(args.key);
      const { issue, head } = await headerOf(jira, key);
      const from = issue.fields?.status?.name || '?';
      const want = String(args.to).trim().toLowerCase();
      const list = (await jira.transitions(key))?.transitions || [];
      const match = list.find((t) => String(t.to?.name || '').toLowerCase() === want)
        || list.find((t) => String(t.name || '').toLowerCase() === want);
      if (from.toLowerCase() === want) {
        return { answer: { success: true, result: `${key} is already ${from}.` } };
      }
      if (!match) {
        const options = list.map((t) => (t.to?.name && t.to.name !== t.name ? `${t.name} (→ ${t.to.name})` : t.name)).join(', ');
        return { answer: { success: false, error: `${key} is ${from} and cannot move to "${args.to}" from there. It can move to: ${options || 'nothing (no transitions are open to this account)'}.` } };
      }
      const to = match.to?.name || match.name;
      return {
        ...base,
        title: `Move ${key} to ${to}?`,
        lines: [head, `Status: ${from} → ${to}`],
        perform: async () => {
          await jira.transition(key, match.id);
          return `${key}: ${from} → ${to}\n${jira.issueUrl(key)}`;
        },
      };
    }

    case 'attach': {
      need(args, 'key');
      const key = issueKey(args.key);
      const files = existingFiles(args.files);
      const { head } = await headerOf(jira, key);
      return {
        ...base,
        title: `Attach ${files.length === 1 ? files[0].name : `${files.length} files`} to ${key}?`,
        lines: [head, ...files.map((f) => `  ${f.name} (${kb(f.size)})`)],
        perform: async () => {
          await jira.attach(key, files.map((f) => f.path));
          return `Attached ${files.map((f) => f.name).join(', ')} to ${key}\n${jira.issueUrl(key)}`;
        },
      };
    }
    default:
      throw new Error(`jira_issue has no action "${raw.action}".`);
  }
}

/* ----------------------------------------------------------------- handler */

/** What the person is asked to do when Jira will not let this account do it. */
function handOff(args, err, site) {
  const what = {
    create: `create the ${args.type || ''} "${args.summary || ''}" in ${String(args.project || '').toUpperCase()}`,
    update: `update ${args.key}`,
    comment: `add the comment to ${args.key}`,
    transition: `move ${args.key} to ${args.to}`,
    attach: `attach ${(Array.isArray(args.files) ? args.files : [args.files]).filter(Boolean).map((f) => path.basename(String(f))).join(', ')} to ${args.key}`,
  }[args.action] || `do this in Jira (${args.action})`;
  const link = args.key ? `${site}/browse/${String(args.key).toUpperCase()}` : site;
  return `HANDED OFF — not done. Jira does not let this account ${what.replace(/\s+/g, ' ').trim()} (${err.status}: ${err.message}). `
    + `Tell the user this is theirs to do by hand, at ${link}. Do not retry it and do not say it was done.`;
}

/**
 * @param {object} args
 * @param {{approval?: object, plan?: object}} ctx
 */
export async function jiraIssue(args = {}, ctx = {}) {
  const action = String(args.action || '').toLowerCase();
  if (action === 'get') return getIssue(args);
  if (action === 'search') return search(args);
  if (!JIRA_WRITES.has(action)) {
    throw new Error(`jira_issue has no action "${args.action}". Actions: get, search, create, update, comment, transition, attach.`);
  }
  if (!consumeApproval(ctx.approval) || typeof ctx.plan?.perform !== 'function') {
    throw new Error('A Jira write runs only after the user approves it, and this call was not approved. Nothing was sent.');
  }
  try {
    return await ctx.plan.perform();
  } catch (err) {
    if (err instanceof JiraError && err.kind === 'forbidden') return handOff({ ...args, action }, err, ctx.plan.site);
    throw err;
  }
}
