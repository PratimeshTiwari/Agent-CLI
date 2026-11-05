/**
 * Every integration, in one list (v9.0). Owner: "all mcp thing should be listed
 * under one menu, custom and these like confluence/jira".
 *
 * What is underneath differs: a custom server is a process, Jira is `jira_issue`,
 * which plans a write against the live issue and asks every time. What a person
 * looks at does not. `/mcp` and the panels both read this.
 */
import { atlassianSite } from '../../atlassian/config.js';

const stateWords = {
  ready: 'connected', connecting: 'starting', failed: 'failed', disabled: 'off', invalid: 'not usable', idle: 'not started',
};

/** One line for a row or the report: what it is doing, and why not if it is not. */
export function statusLine(row) {
  if (row.builtin) return row.detail;
  const count = row.tools.length;
  const tools = `${count} tool${count === 1 ? '' : 's'}`;
  if (row.state === 'ready') return `connected · ${tools}`;
  if (row.error) return `${stateWords[row.state]} · ${row.error}`;
  if (row.toolsStale && count) return `${stateWords[row.state]} · ${tools} last seen`;
  return stateWords[row.state] || row.state;
}

function jiraRow() {
  const site = atlassianSite();
  return {
    name: 'jira',
    builtin: true,
    state: site ? 'ready' : 'idle',
    tools: [
      { name: 'get, search', description: 'read issues, in Markdown' },
      { name: 'create, update, comment, transition, attach', description: 'always asks, in every mode' },
    ],
    detail: site
      ? `built in · ${site.site.replace(/^https?:\/\//, '')} · writes always ask`
      : 'built in · not set up · run `agent atlassian login` in a terminal',
  };
}

/** @param {import('./servers.js').McpServers} mcp */
export function listIntegrations(mcp) {
  const snapshot = mcp.snapshot();
  return { ...snapshot, rows: [...snapshot.servers, jiraRow()] };
}

/** The panels' answer to `/mcp`, and the terminal's to `/mcp reload`. */
export function mcpReport(list) {
  const lines = ['**MCP**'];
  if (list.error) lines.push(`✗ ${list.path}: ${list.error}`);
  else if (!list.exists) lines.push(`No servers yet · add them to ${list.path}`);
  for (const row of list.rows) lines.push(`- ${row.name} · ${statusLine(row)}`);
  return lines.join('\n');
}
