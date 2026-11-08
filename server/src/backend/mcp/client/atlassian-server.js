/**
 * Atlassian's own MCP server, built in (v9.9).
 *
 * Read from the server on 2026-11-08: `https://mcp.atlassian.com/v2/mcp`,
 * streamable HTTP, a 401 naming its resource metadata, an authorization server
 * at `auth.atlassian.com` that takes self-registration and PKCE S256. Cloud
 * only: Server / Data Center keeps `jira_issue` and `agent atlassian login --token`.
 *
 * **Every write asks, in every mode** (owner, 2026-10-31, kept on this path).
 * Reads are a list of names; anything not on it, a tool Atlassian adds next
 * month included, is a write. The server's own `readOnlyHint` is not read: the
 * server wrote it. No `/mcp` switch reaches these tools: a write cannot be set to
 * auto, and the box has no "always". The rule follows the address, not the name,
 * so an `atlassian.com` server a person adds to `mcp.json` under any name gets it too.
 */
import { createHash } from 'node:crypto';
import { makeStore } from './oauth.js';

export const ATLASSIAN_NAME = 'atlassian';
export const ATLASSIAN_HOST = 'mcp.atlassian.com';
export const atlassianUrl = () => process.env.AGENT_ATLASSIAN_MCP_URL || `https://${ATLASSIAN_HOST}/v2/mcp`;

/**
 * Jira and Confluence, read, write and search, and a refresh token. Not delete,
 * not the other products the server offers (Bitbucket, Loom, JSM, …): a sign-in
 * asks for what the agent uses.
 */
export const ATLASSIAN_SCOPES = [
  'read:me', 'read:account', 'offline_access',
  'read:jira:agent-interface', 'write:jira:agent-interface', 'search:jira:agent-interface',
  'read:confluence:agent-interface', 'write:confluence:agent-interface', 'search:confluence:agent-interface',
].join(' ');

/** Tools that only read. Everything else asks. */
export const ATLASSIAN_READS = new Set([
  'atlassianUserInfo', 'getAccessibleAtlassianResources',
  'getJiraIssue', 'searchJiraIssuesUsingJql', 'getTransitionsForJiraIssue', 'lookupJiraAccountId',
  'getJiraIssueRemoteIssueLinks', 'getVisibleJiraProjects', 'getJiraProjectIssueTypesMetadata',
  'getJiraIssueTypeMetaWithFields',
  'getConfluenceSpaces', 'getConfluencePage', 'getPagesInConfluenceSpace', 'getConfluencePageAncestors',
  'getConfluencePageDescendants', 'getConfluencePageFooterComments', 'getConfluencePageInlineComments',
  'searchConfluenceUsingCql',
  'search', 'fetch',
]);

/** Is this server Atlassian's? By address: a name is the person's choice. */
export function isAtlassianServer(server) {
  const host = server?.host || (() => { try { return new URL(server?.url).host; } catch { return ''; } })();
  return host === ATLASSIAN_HOST || host.endsWith(`.${ATLASSIAN_HOST}`) || Boolean(server?.atlassian);
}

/** `'read'` or `'write'`. An unknown or missing name is a write: fail closed. */
export const atlassianKind = (tool) => (typeof tool === 'string' && ATLASSIAN_READS.has(tool) ? 'read' : 'write');

/**
 * The built-in entry, shaped like one `config.js` reads. `signedOut` keeps it
 * listed and unusable until `agent atlassian login` has run.
 */
export function atlassianEntry({ store = makeStore(ATLASSIAN_NAME), url = atlassianUrl() } = {}) {
  return {
    name: ATLASSIAN_NAME,
    source: 'builtin',
    builtin: true,
    atlassian: true,
    transport: 'http',
    auth: 'oauth',
    url,
    headers: {},
    host: new URL(url).host,
    fingerprint: `builtin-${createHash('sha256').update(url).digest('hex').slice(0, 12)}`,
    disabled: false,
    alwaysAsk: true,
    signedOut: !store.signedIn(url),
    raw: null,
  };
}
