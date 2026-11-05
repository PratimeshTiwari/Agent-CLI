/**
 * `/mcp` (v9.0): every integration in one list, enter opens its tools.
 *
 * Pure, like `logs-view.js`: the menu draws what this returns. This release only
 * shows them. The model reaches nothing yet, and the switches arrive with the
 * tools in v9.1.
 */
import { homedir } from 'node:os';
import { statusLine } from '../../backend/mcp/client/integrations.js';

export const shortPath = (p) => (p?.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p || '');

/**
 * The line under the title, which a short terminal sheds. So it only ever
 * explains: a fault or a missing file is a row of the list, which is not shed.
 */
export function homeLine(list) {
  if (list.error) return 'Fix the file, then choose Reload.';
  if (!list.exists) return 'The same format as Claude Code and Cursor.';
  return 'Enter shows what a server offers. The model cannot call these yet.';
}

export const serverLine = (row) => statusLine(row);

const tone = (row, T) => {
  if (row.state === 'failed' || row.state === 'invalid') return { colour: T.danger };
  if (row.state === 'connecting') return { colour: T.attention };
  return {};
};

export function mcpHomeItems(list, { T = {} } = {}) {
  const items = list.rows.map((row) => ({
    label: row.name,
    detail: statusLine(row),
    value: row.name,
    ...tone(row, T),
  }));
  if (list.error) items.unshift({ label: 'mcp.json', detail: list.error, value: '', colour: T.danger });
  else if (!list.exists) items.unshift({ label: 'No servers yet', detail: `add them to ${shortPath(list.path)}`, value: '' });
  if (list.exists) items.push({ label: 'Reload', detail: 'read mcp.json again and restart every server', value: 'reload' });
  return items;
}

/** A description's first line: a server may write paragraphs. */
const firstLine = (text) => String(text || '').trim().split('\n')[0];

/** `said`: the line above already gives the status, when it had room to. */
export function serverToolItems(row, { said = false } = {}) {
  if (!row.tools.length) return [{ label: 'No tools', detail: said ? '' : statusLine(row), value: '' }];
  return row.tools.map((t) => ({ label: t.name, detail: firstLine(t.description), value: t.name }));
}
