/**
 * Everything that is set, on one page.
 *
 * `/help` answers "what can I type?" — a list of verbs. This answers "how is
 * this thing configured right now?", which is a list of nouns and their
 * values, and there was no way to ask it: the answer was spread across
 * `/config`, `/effort`, `/memory`, `/allowlist` and the status bar, one
 * command per fact.
 *
 * Each row knows what to run when you pick it, so the page is navigable rather
 * than a printout — and the running is delegated to the commands that already
 * own each setting, so there is no second way to change anything.
 *
 * @typedef {object} SettingRow
 * @property {string} label   what it is
 * @property {string} value   what it is set to, right now
 * @property {string} [hint]  the consequence, when the value alone is cryptic
 * @property {string} [run]   slash command to run when picked; absent = read-only
 * @property {{kind: 'switch'|'ladder', options: string[]}} [control]
 *           how ←/→ change it in place (v5.27, the C′ redesign); `restore(value)` is
 *           the command that sets it, so there is still one way to change anything
 */

import { MODES, nextMode } from '../policy/modes.js';
import fs from 'fs';
import { resolveEffort, EFFORT_LEVELS } from '../models/effort.js';
import { loadUserSettings } from './user-settings.js';
import { PROMPT_VERSIONS, PROMPT_VERSION_IDS, DEFAULT_PROMPT_VERSION } from '../prompt/prompt-versions.js';
import { browserModelPin } from '../models/model-match.js';
import { MISMATCH_POLICIES, mismatchPolicy } from '../models/model-fallback.js';
import { expectedExtensionVersion } from '../install/extension-version.js';
import * as paths from './paths.js';
import { countToday } from '../logs/command-log.js';
import { describeInstructionSources } from '../prompt/instruction-sources.js';
import { changed } from '../turn/slash-commands.js';
import { countTurns } from '../turn/compaction.js';

/**
 * The tabs, in the order they are shown.
 *
 * Three, because there are three questions people actually open this to ask:
 * how is the agent set up, is it connected to anything, and what is in the
 * window right now. A fourth tab with two rows in it is a worse answer than a
 * third tab with six.
 */
export const SETTING_GROUPS = ['Settings', 'Status', 'Context'];

/**
 * A hint is a few plain words beside the value, never a sentence: it sits on
 * one row and was cut off mid-clause (owner, 2026-10-30). The keys line already
 * says what enter does, so no hint repeats it. `settings.test.js` holds every
 * hint to `HINT_MAX`.
 */
export const HINT_MAX = 32;

/** `describeMode` is a sentence for the transcript; the row needs the short form. */
const MODE_HINTS = {
  plan: 'every edit asks, except .md',
  auto: 'safe edits apply on their own',
  strict: 'every edit asks first',
};

/**
 * Build the page.
 *
 * Takes the loop rather than reading config off disk: these are the values in
 * force this second, which is the entire question being asked. Every field is
 * read defensively — a settings page that throws is worse than one with a gap.
 *
 * @returns {SettingRow[]}
 */
/** Read something that may not be there, without taking the screen down. */
function safeRead(fn, fallback) {
  try { return fn() ?? fallback; } catch { return fallback; }
}

export function describeSettings(agentLoop) {
  const mc = agentLoop?.modelConfig || {};
  // The on-disk config, for keys that live there rather than on the loop.
  // `agentName` is one: the banner reads it from the file, so the screen has
  // to read it from the same place or the two disagree.
  const cfg = safeRead(() => JSON.parse(
    fs.readFileSync(paths.configPath(agentLoop.workspace), 'utf8'),
  ), {});
  const effort = resolveEffort(mc.effort);
  const subagents = mc.subagents !== false;
  const rules = agentLoop?.commandRules || { enabled: true, allow: [], block: [] };
  const memoryOn = agentLoop?.memoryManager?.isMemoryEnabled?.() !== false;
  const facts = memoryOn ? (agentLoop?.memoryManager?.getAllMemories?.() || []).length : 0;
  const scope = safe(() => paths.getActiveScope(agentLoop.workspace), '');
  const commandsToday = safe(() => countToday(agentLoop.workspace), 0);

  // Turns, not watcher rows (v6.15): `countTurns`.
  const turnCount = countTurns(agentLoop?.conversationHistory);
  // Everything the tab holds, not just the turns kept locally — see
  // AgentLoop.contextTokens.
  const tokens = agentLoop?.contextTokens ?? 0;
  const limit = agentLoop?.contextLimit || 50000;
  const pending = safe(() => agentLoop.diffEngine.getPendingDiffs().length, 0);
  const applied = safe(() => agentLoop.diffEngine.appliedDiffs.length, 0);

  return [
    {
      group: 'Settings',
      label: 'Effort',
      value: effort.id,
      // The pin wins the hint when there is one: `effort.browser` is what the
      // rung is written for, and the pin is what this install actually asks
      // the picker for. Showing the first while the second is in force is how
      // a settings page starts lying about itself.
      hint: browserModelPin(mc, effort.id)
        ? `browser tab: ${browserModelPin(mc, effort.id)} (pinned)`
        : `browser tab: ${effort.browser}`,
      run: '/effort',
      restore: (value) => `/effort ${value}`,
      control: { kind: 'ladder', options: EFFORT_LEVELS.map((e) => e.id) },
    },
    {
      group: 'Settings',
      label: 'Browser differs',
      // v5.28: what a message does when the tab is not on the effort's model.
      value: mismatchPolicy(mc),
      hint: {
        ask: 'ask what to do',
        follow: 'use the browser\'s model',
        switch: 'switch the browser first',
      }[mismatchPolicy(mc)],
      run: '/effort mismatch',
      restore: (value) => `/effort mismatch ${value}`,
      control: { kind: 'ladder', options: MISMATCH_POLICIES },
    },
    {
      group: 'Settings',
      label: 'Subagents',
      value: subagents ? 'on' : 'off',
      hint: subagents
        ? 'research and review in parallel'
        : 'one tab does everything',
      run: '/subagents',
      restore: (value) => `/subagents ${value}`,
      control: { kind: 'switch', options: ['on', 'off'] },
    },
    {
      group: 'Settings',
      label: 'Large files',
      // v6.16: a file over 1,200 lines or 80 KB, read without a range.
      value: mc.largeFiles === 'direct' ? 'direct' : 'subagent',
      hint: mc.largeFiles === 'direct' ? 'paged into this chat'
        : subagents ? 'a subagent sends a digest' : 'direct while subagents are off',
      run: mc.largeFiles === 'direct' ? '/subagents large-files subagent' : '/subagents large-files direct',
      restore: (value) => `/subagents large-files ${value}`,
      control: { kind: 'switch', options: ['subagent', 'direct'] },
    },
    {
      group: 'Settings',
      label: 'Prompt',
      // v5.32: which prompt version is sent; `/prompt` shows how they compare.
      value: agentLoop?.promptVersion || DEFAULT_PROMPT_VERSION,
      hint: (PROMPT_VERSIONS[agentLoop?.promptVersion] || PROMPT_VERSIONS[DEFAULT_PROMPT_VERSION]).hint,
      run: '/prompt',
      restore: (value) => `/prompt ${value}`,
      control: { kind: 'ladder', options: PROMPT_VERSION_IDS },
    },
    {
      group: 'Settings',
      label: 'Startup',
      value: agentLoop?.startupMode === 'warm' ? 'warm' : 'cold',
      hint: agentLoop?.startupMode === 'warm'
        ? 'setup sent when Chrome connects'
        : 'setup sent with first message',
      // The chooser, not a toggle: each choice needs its cost said next to it.
      run: '/startup',
      restore: (value) => `/startup ${value}`,
      control: { kind: 'switch', options: ['warm', 'cold'] },
    },
    {
      group: 'Settings',
      label: 'Edit approval',
      value: MODES.includes(agentLoop?.mode) ? agentLoop.mode : 'plan',
      hint: MODE_HINTS[agentLoop?.mode] || MODE_HINTS.plan,
      run: `/${nextMode(agentLoop?.mode)}`,
      restore: (value) => `/${value}`,
      control: { kind: 'ladder', options: MODES },
    },
    {
      group: 'Settings',
      label: 'Memory',
      value: memoryOn ? 'on' : 'off',
      hint: memoryOn ? `${facts} fact${facts === 1 ? '' : 's'} remembered` : 'nothing remembered',
      // The direction, not the bare command: `/memory` on its own prints the
      // list of facts, which is not what pressing Enter on a switch should do.
      run: memoryOn ? '/memory off' : '/memory on',
      restore: (value) => `/memory ${value}`,
      control: { kind: 'switch', options: ['on', 'off'] },
    },
    {
      group: 'Settings',
      label: 'Command rules',
      value: rules.enabled === false ? 'off' : 'on',
      hint: `${rules.allow?.length || 0} allowed · ${rules.block?.length || 0} blocked`,
      run: '/allowlist',
      restore: (value) => `/allowlist ${value === 'on' ? 'enable' : 'disable'}`,
      control: { kind: 'switch', options: ['on', 'off'] },
    },
    {
      group: 'Settings',
      label: 'Theme',
      // The saved choice, which is what `/theme` previews from. Per person.
      value: safeRead(() => loadUserSettings().theme, null) || 'terminal',
      hint: 'colour palette',
      run: '/theme',
    },
    {
      group: 'Settings',
      label: 'Skill folders',
      value: String((agentLoop?.skillFolders || []).length + 2),
      hint: 'project, personal and extra',
      run: '/skills',
    },
    {
      group: 'Status',
      label: 'Workspace',
      value: agentLoop?.workspace || '',
      hint: scope ? `scope: ${scope}` : 'the files the agent works on',
      run: '/workspace',
    },
    {
      group: 'Settings',
      label: 'Agent name',
      // `config.agentName`, which is where the banner reads it. This used to
      // read `modelConfig.agentName` — a key nothing has ever written — so the
      // screen reported "Agent CLI" while the banner said something else.
      value: cfg?.agentName || 'Agent CLI',
      hint: 'shown in the banner',
      // `/name` with no argument only *prints* the current name, so this row
      // promised a change and delivered a paragraph. It opens an editor now;
      // `Menus.jsx` runs `/name <text>` with what you type.
      run: '/name',
      edits: 'name',
    },
    {
      group: 'Status',
      label: 'Commands run',
      value: `${commandsToday} today`,
      hint: 'shell commands, kept per day',
      run: '/commands',
    },
    {
      group: 'Status',
      label: 'Extension',
      value: (() => {
        const ms = agentLoop?.extensionConnectMs;
        if (ms === undefined) return 'not connected yet';
        return ms < 1000 ? `connected in ${ms}ms` : `connected in ${(ms / 1000).toFixed(1)}s`;
      })(),
      hint: 'time to reach this server',
    },
    {
      /*
       * Which build is in Chrome, askable rather than only announced.
       *
       * The connect-time row scrolls away, and "have I reloaded it?" is asked
       * long after. The number comes from `chrome.runtime.getManifest()` in
       * the loaded bundle, so unlike the badge on `chrome://extensions` it
       * cannot be a version somebody typed and forgot — which is exactly how a
       * build from before 2026-09-19 ran for days calling itself 1.25.0.
       */
      group: 'Status',
      label: 'Extension build',
      value: agentLoop?.extensionVersion
        || (agentLoop?.extensionConnectMs === undefined ? 'not connected yet' : 'older than 1.26.0'),
      hint: expectedExtensionVersion()
        ? `this checkout ships ${expectedExtensionVersion()}`
        : 'as the extension reports it',
    },
    {
      // Which Chrome tab this session types into (v7.9, extension 1.55.0).
      group: 'Status',
      label: 'Gemini tab',
      value: describeBrowserTab(agentLoop?.browserTab, agentLoop?.subagentTabIds),
      // cmd+click opens the chat (v7.9). It opens it, it does not find the tab:
      // a link cannot address one, which is what ctrl+b is for.
      link: browserTabUrl(agentLoop?.browserTab),
      hint: agentLoop?.browserTab ? 'cmd+click opens the chat · ctrl+b the tab' : 'as the extension reports it',
    },
    {
      group: 'Status',
      label: 'State directory',
      value: safe(() => paths.agentDir(agentLoop.workspace), ''),
      hint: 'config, sessions, memory, logs',
      run: '/agent-dir',
    },
    {
      group: 'Context',
      label: 'Turns',
      value: String(turnCount),
      hint: 'messages this session',
    },
    {
      group: 'Context',
      label: 'Tokens',
      value: `~${tokens.toLocaleString()} / ${limit.toLocaleString()}`,
      hint: `${Math.min(100, Math.round((tokens / limit) * 100))}% of the window`,
      run: '/compact',
    },
    {
      group: 'Context',
      label: 'Diffs',
      value: `${pending} pending`,
      hint: `${applied} applied`,
      run: applied > 0 ? '/undo' : undefined,
    },
    // What the prompt is actually being told about this project.
    //
    // The Context tab reported how *much* was in the window — turns, tokens,
    // diffs — and never *what*. `CLAUDE.md` already defines bare `/context` as
    // "a report of what is in the window"; this is the half that was missing,
    // rather than a new surface. Each row is a real file, so Enter opens it.
    ...describeInstructionSources(agentLoop).map((source) => ({
      group: 'Context',
      label: source.group === 'AGENT.md' ? 'Instructions' : source.group === 'memory' ? 'Memory file' : 'Skills',
      value: source.label,
      hint: source.state === 'loaded' ? source.detail : `${source.state} — ${source.detail}`,
      run: source.path ? `/open ${source.path}` : undefined,
    })),
    {
      group: 'Context',
      label: 'Session',
      value: `${turnCount} turn${turnCount === 1 ? '' : 's'} kept`,
      hint: 'saved here and in ~/.agent',
      run: '/clear',
    },
  ].filter((row) => row.value !== '');
}

/**
 * Rows matching what has been typed.
 *
 * Matches the label, the value and the hint, because people look for a setting
 * by any of the three — "review" is not in any label but it is exactly what
 * someone types when they want to know whether subagents are on.
 */
/**
 * What changed between two readings of the page.
 *
 * Settings here apply the moment you pick one — there is no staged copy to
 * save, so a "save or discard" prompt would be describing something that had
 * already happened. What is actually useful on the way out is a list of what
 * you just did, and a way to put it back.
 *
 * Only rows that know how to restore themselves are offered; the rest are
 * reported and left alone, which is honest about what an undo can reach.
 *
 * **Only the Settings group is compared.** Reported from use: opening the page,
 * changing nothing and closing it announced "2 settings changed — Turns 18 → 19,
 * Session 18 turns kept → 19 turns kept". Those are in the Context group, and
 * everything there is a *readout* — turns, tokens, diffs — which moves on its
 * own while the page is open. So the screen fired on every exit during an active
 * session, reporting things the person had not done and could not undo, which is
 * the fastest way to teach someone to ignore a screen that will one day have
 * something real on it.
 *
 * The group is the honest test rather than `restore`: `Skill folders` and
 * `Agent name` are genuine settings with no undo, and they should still be
 * reported when they change.
 *
 * @returns {Array<{label: string, from: string, to: string, restore?: string}>}
 */
export function settingsChanged(before, after) {
  const was = new Map((before || []).map((row) => [row.label, row.value]));
  const changes = [];
  for (const row of after || []) {
    if (row.group !== 'Settings') continue;
    const from = was.get(row.label);
    if (from === undefined || from === row.value) continue;
    changes.push({
      label: row.label,
      from,
      to: row.value,
      ...(row.restore ? { restore: row.restore(from) } : {}),
    });
  }
  return changes;
}

/**
 * Changes made on the page and not yet applied (v6.1). Owner, 2026-10-30:
 * *"only apply when user clicks on apply"*. Every ←/→ on the page used to run
 * its command there and then — so trying `/effort` medium and back switched the
 * browser twice and left three lines in the transcript for nothing changed.
 * Now the page holds `pending` and nothing runs until Apply.
 *
 * A pending value equal to the live one is not a change: stepping away and back
 * again is the same as not touching it.
 *
 * @param {SettingRow[]} rows the page as it is live
 * @param {Object<string, string>} pending label → the value shown
 * @returns {Array<{label: string, from: string, to: string, restore: string}>}
 */
export function stagedChanges(rows, pending = {}) {
  const out = [];
  for (const row of rows || []) {
    if (!row.restore || !(row.label in (pending || {}))) continue;
    const to = pending[row.label];
    if (to == null || String(to) === String(row.value)) continue;
    out.push({ label: row.label, from: row.value, to, restore: row.restore(to) });
  }
  return out;
}

/**
 * What Apply says: one `⚙` line per setting that really moved, in the
 * `changed()` style every other setting reply uses, and nothing at all when
 * none did. It used to print `↩️ Put back: …` for every row it tried.
 *
 * @param {SettingRow[]} before the page just before the commands ran
 * @param {SettingRow[]} after the page just after
 * @returns {string[]}
 */
export function changedLines(before, after) {
  return settingsChanged(before, after).map((c) => changed(c.label.toLowerCase(), c.from, c.to));
}

export function filterSettings(rows, query, group = null) {
  const inGroup = group ? rows.filter((row) => row.group === group) : rows;
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return inGroup;

  // Typing searches *everything*, not just the tab you happen to be on. Making
  // someone find the right tab before they can search for a setting is asking
  // them to know the answer first.
  const pool = q ? rows : inGroup;
  return pool.filter((row) =>
    `${row.label} ${row.value} ${row.hint || ''}`.toLowerCase().includes(q));
}

/**
 * The two column widths the settings list pads to.
 *
 * It is given the rows being **drawn**, and that is the whole of the fix: the
 * page computed these over every row it knew about and then padded the
 * filtered ones to them. Filter to two short rows and they were still spaced
 * for the widest label in the entire set, which is where
 * `Effort              deep` came from — a gap wide enough to read as a
 * missing column, on a screen whose whole job is showing what is set to what.
 *
 * `VALUE_MAX` is the same clamp the caller applies with `oneLine`, and the
 * width is measured on the clamped text rather than the raw value, because
 * padding to a length nothing will occupy is the same bug one column over.
 *
 * @param {Array<{label: string, value: string}>} rows - the rows being drawn
 * @returns {{ width: number, vwidth: number }}
 */
export const VALUE_MAX = 30;

export function settingsColumns(rows) {
  const drawn = Array.isArray(rows) ? rows : [];
  const longest = (pick) => drawn.reduce((n, row) => Math.max(n, pick(row).length), 0);
  return {
    width: longest((row) => String(row?.label ?? '')),
    // Collapsed the way `oneLine` collapses it: a value carrying a newline or a
    // run of spaces is drawn shorter than it measures.
    vwidth: Math.min(VALUE_MAX, longest((row) =>
      String(row?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, VALUE_MAX))),
  };
}

/**
 * The main lane's tab in one line: `tab 1234 · chat 17d6b14b8a5d1ff2`.
 *
 * `undefined` is an extension older than 1.55.0, which never says; `null` is
 * a newer one with no tab yet (the first prompt opens one).
 */
export function describeBrowserTab(tab, subagentTabIds = []) {
  if (tab === undefined) return 'not reported (extension older than 1.55.0)';
  if (!tab) return 'none yet';
  const parts = [`tab ${tab.id}`, tab.thread ? `chat ${tab.thread}` : 'new chat'];
  const subs = (subagentTabIds || []).length;
  if (subs) parts.push(`${subs} subagent tab${subs === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** The tab's chat as a URL, or null before the extension has said (v7.9). */
export function browserTabUrl(tab) {
  if (!tab) return null;
  if (tab.url) return tab.url;
  return tab.thread ? `https://gemini.google.com/app/${tab.thread}` : null;
}

function safe(fn, fallback) {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}
