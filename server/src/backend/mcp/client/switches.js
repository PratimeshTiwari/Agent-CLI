/**
 * Ask, auto or block, per person (v9.1). Owner, 2026-11-05: a tool's switch wins
 * over plan and auto, strict still asks, and a new tool starts on ask.
 *
 * | switch | plan    | auto    | strict  |
 * | ask    | asks    | asks    | asks    |
 * | auto   | runs    | runs    | asks    |
 * | block  | refused | refused | refused |
 *
 * In `~/.agent/settings.json`, because trusting a tool is about the person and
 * not the repo: a checkout must not arrive with a tool already on auto. A
 * server's own hints (`readOnlyHint`) are never read: the server wrote them.
 */
import { loadUserSettings, saveUserSettings } from '../../core/workspace/user-settings.js';

export const SWITCHES = ['ask', 'auto', 'block'];

const known = (value) => (SWITCHES.includes(value) ? value : null);

/** A hand-edited or unknown value reads as ask: fail closed. */
export function switchFor(server, tool, settings = loadUserSettings()) {
  const entry = settings?.mcpSwitches?.[server];
  return known(entry?.tools?.[tool]) ?? known(entry?.default) ?? 'ask';
}

/**
 * The table above, and `alwaysAsk` from `mcp.json`, which no switch overrides:
 * it is how a server that writes to a shared service keeps "every write asks".
 *
 * @returns {'run'|'ask'|'refuse'}
 */
export function mcpDecision(value, mode, { alwaysAsk = false } = {}) {
  if (value === 'block') return 'refuse';
  if (value === 'auto' && !alwaysAsk && (mode === 'plan' || mode === 'auto')) return 'run';
  return 'ask';
}

/** `tool` null sets what a server's tools start on. */
export function setSwitch(server, tool, value) {
  if (!known(value)) return false;
  const all = loadUserSettings().mcpSwitches || {};
  const entry = all[server] || {};
  const next = tool
    ? { ...entry, tools: { ...entry.tools, [tool]: value } }
    : { ...entry, default: value };
  return saveUserSettings({ mcpSwitches: { ...all, [server]: next } });
}

/** What enter moves to in `/mcp`. A server that always asks has no auto to offer. */
export function nextSwitch(value, { alwaysAsk = false } = {}) {
  const order = alwaysAsk ? ['ask', 'block'] : SWITCHES;
  return order[(order.indexOf(value) + 1) % order.length];
}
