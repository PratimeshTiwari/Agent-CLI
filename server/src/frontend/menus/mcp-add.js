/**
 * `/mcp add`'s steps (v9.2), pure, so the order and the back key are tested
 * without a terminal: paste → name → the values it needs → check → test → saved.
 *
 * The check step always shows the command before anything runs: it came from a
 * web page, and testing it starts it.
 */
import { nameProblem, parseServerInput, planEnv, suggestName } from '../../backend/mcp/client/add-server.js';

export const startAdd = () => ({ step: 'paste', text: '', error: null });

export function submitPaste(state, text, { taken = [], env = process.env } = {}) {
  const parsed = parseServerInput(text);
  if (parsed.problem) return { ...state, text, error: parsed.problem };
  return {
    step: 'name',
    text,
    error: null,
    entry: parsed.entry,
    name: parsed.name || suggestName(parsed.entry, taken),
    plan: planEnv(parsed.entry, env),
    values: {},
    at: 0,
  };
}

export function submitName(state, name, { taken = [] } = {}) {
  const wanted = name.trim();
  const problem = nameProblem(wanted, taken);
  if (problem) return { ...state, name, error: problem };
  return { ...state, name: wanted, error: null, step: state.plan.ask.length ? 'value' : 'check', at: 0 };
}

export function submitValue(state, value) {
  const { key } = state.plan.ask[state.at];
  if (!value.trim()) return { ...state, error: `${key} needs a value.` };
  const values = { ...state.values, [key]: value.trim() };
  const at = state.at + 1;
  return { ...state, values, error: null, at, step: at < state.plan.ask.length ? 'value' : 'check' };
}

/** Esc goes back one step; null means leave the screen. */
export function stepBack(state) {
  if (state.step === 'paste') return null;
  if (state.step === 'name') return { step: 'paste', text: state.text, error: null };
  if (state.step === 'value') return state.at > 0 ? { ...state, at: state.at - 1, error: null } : { ...state, step: 'name', error: null };
  if (state.step === 'check') {
    return state.plan.ask.length ? { ...state, step: 'value', at: state.plan.ask.length - 1 } : { ...state, step: 'name' };
  }
  return { ...state, step: 'check', result: null, error: null };
}

/** The command or address as the check step shows it. A value is never drawn, only its name. */
export const commandLine = (entry) => entry.url || [entry.command, ...(entry.args || [])].join(' ');

/**
 * The check step exists to show what will run, so the command wraps instead of
 * being cut. With more than fits, its end is kept: a harmless start can be
 * followed by anything.
 */
export function fitCommand(line, width, room) {
  const size = Math.max(10, width - 2);
  const rows = [];
  for (let at = 0; at < line.length; at += size) rows.push(line.slice(at, at + size));
  if (rows.length <= room) return rows;
  if (room < 2) return [`${line.slice(0, Math.floor(size / 2) - 1)} … ${line.slice(-(Math.ceil(size / 2) - 2))}`];
  return [...rows.slice(0, room - 1), `…${line.slice(-(size - 1))}`];
}

export function testedLine(result) {
  if (!result.ok) return `✗ ${result.error}`;
  const names = result.tools.map((t) => t.name);
  const shown = names.slice(0, 4).join(', ');
  return `✔ ${names.length} tool${names.length === 1 ? '' : 's'}${shown ? `: ${shown}${names.length > 4 ? ', …' : ''}` : ''}`;
}
