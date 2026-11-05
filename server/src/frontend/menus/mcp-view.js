/**
 * `/mcp` (v9.0): every integration in one list, enter opens its tools.
 *
 * Pure, like `logs-view.js`: the menu draws what this returns. Since v9.1 a
 * server's page is also where each tool is set to ask, auto or block.
 */
import { homedir } from 'node:os';
import { statusLine } from '../../backend/mcp/client/integrations.js';

export const shortPath = (p) => (p?.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p || '');

/**
 * The line under the title, which a short terminal sheds. So it only ever
 * explains: a fault or a missing file is a row of the list, which is not shed.
 */
export function homeLine(list, { needsPrompt = false } = {}) {
  if (list.error) return 'Fix the file, then choose Reload.';
  if (!list.exists) return 'The same format as Claude Code and Cursor.';
  return needsPrompt
    ? 'Enter shows what a server offers. The model calls these on prompt v5.'
    : 'Enter opens a server, to set what each of its tools may do.';
}

export const serverLine = (row) => statusLine(row);

const tone = (row, T) => {
  if (row.state === 'failed' || row.state === 'invalid') return { colour: T.danger };
  if (row.state === 'connecting') return { colour: T.attention };
  return {};
};

export function mcpHomeItems(list, { T = {}, needsPrompt = false } = {}) {
  const items = list.rows.map((row) => ({
    label: row.name,
    detail: statusLine(row),
    value: row.name,
    ...tone(row, T),
  }));
  if (list.error) items.unshift({ label: 'mcp.json', detail: list.error, value: '', colour: T.danger });
  else if (!list.exists) items.unshift({ label: 'No servers yet', detail: `add them to ${shortPath(list.path)}`, value: '' });
  // Nothing moves on its own: the row offers it, and enter is the yes.
  if (needsPrompt && list.rows.some((r) => !r.builtin && r.state !== 'invalid' && r.state !== 'disabled')) {
    items.push({ label: 'Use prompt v5', detail: 'lets the model call these, and teaches the chat again', value: 'prompt' });
  }
  if (list.exists) items.push({ label: 'Reload', detail: 'read mcp.json again and restart every server', value: 'reload' });
  return items;
}

/** A description's first line: a server may write paragraphs. */
const firstLine = (text) => String(text || '').trim().split('\n')[0];

/**
 * `said`: the line above already gives the status, when it had room to.
 * `switchOf`: a custom server's switches. Jira has none: its writes always ask.
 */
export function serverToolItems(row, { said = false, switchOf = null } = {}) {
  if (!row.tools.length) return [{ label: 'No tools', detail: said ? '' : statusLine(row), value: '' }];
  if (!switchOf || row.builtin) {
    return row.tools.map((t) => ({ label: t.name, detail: firstLine(t.description), value: '' }));
  }
  return [
    { label: 'New tools', detail: `${switchOf('')} · what a tool here starts on`, value: '*' },
    ...row.tools.map((t) => ({ label: t.name, detail: `${switchOf(t.name)} · ${firstLine(t.description)}`, value: t.name })),
  ];
}
