import React from 'react';
import { exec, execFile } from 'child_process';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { QuestionPrompt } from './QuestionPrompt.jsx';
import { diffBoxLayout, patchCounts } from '../transcript/diff-preview.js';
import ThemePreview from './ThemePreview.jsx';
import { previewSize, PREVIEW_ROWS } from '../menus/theme-preview.js';
import { DiffRows } from './DiffRows.jsx';
import { oneLine } from '../text.js';
import { helpPage, nextTab, commandRows, HELP_TABS, HELP_CHROME_ROWS } from '../menus/help.js';
import { panelRoom, wrapLines, cutStart } from '../menus/panel.js';
import { filterUnderline, settingsKeys, stepValue } from '../menus/settings-view.js';
import { sliderLayout, stopModel, tabDiffers, onlyModel, onlyModelLine, stepThinking, thinkingLine } from '../menus/effort-slider.js';
import { thinkingStops, normaliseThinkingSetting } from '../../backend/core/models/thinking.js';
import { Panel, Choices } from './Panel.jsx';
import { ChromeProfiles } from './ChromeProfiles.jsx';
import { UpdateMenu } from './UpdateMenu.jsx';
import { SettingsList } from './SettingsList.jsx';
import { logsHomeItems, failureItems } from '../menus/logs-view.js';
import { fileRows, rowDetail, rowLink, revealCommand, fileBrowserName, revealedLine } from '../menus/files-view.js';
import { mcpHomeItems, serverToolItems, serverLine, homeLine, shortPath, ALLOW_ITEMS, serverOrigin } from '../menus/mcp-view.js';
import { fitCommand } from '../menus/mcp-add.js';
import { openBrowser } from '../../backend/atlassian/cli.js';
import { changeMcp, listIntegrations } from '../../backend/mcp/client/integrations.js';
import { removeServer, setServerDisabled } from '../../backend/mcp/client/edit-config.js';
import { McpAdd } from './McpAdd.jsx';
import { nextSwitch, setSwitch, switchFor } from '../../backend/mcp/client/switches.js';
import { canPickFolder, pickFolder } from '../../backend/core/workspace/folder-picker.js';
import { readCommands, listCommandDays } from '../../backend/core/logs/command-log.js';
import { EFFORT_LEVELS, resolveEffort } from '../../backend/core/models/effort.js';
import { mismatchPolicy } from '../../backend/core/models/model-fallback.js';
import { describeSettings, filterSettings, stagedChanges, changedLines, SETTING_GROUPS } from '../../backend/core/workspace/settings.js';
import { listWorkspaceCandidates } from '../../backend/core/workspace/workspaces.js';
import { skillsDir, agentDir } from '../../backend/core/workspace/paths.js';
import { skillSearchPath, listSkills } from '../../backend/core/prompt/skills.js';
import { FOCUS_INPUT } from '../constants.js';
import { MAX_AGENT_NAME, changed, promptVersionRows } from '../../backend/core/turn/slash-commands.js';
import { PROMPT_VERSIONS, versionChanges, versionAdds } from '../../backend/core/prompt/prompt-versions.js';
import { promptPanelPlan, changesPage, roundsBar, roundsLabel } from '../menus/prompt-view.js';
import { T, PALETTES, PALETTE_INFO, setTheme, themeName } from '../theme.js';
import { saveUserSettings } from '../../backend/core/workspace/user-settings.js';
import {
  REPO_ROOT, checkInstalled, checkTools, applyLatest, installPackage, installTool, listVersions, findImporters,
  errorOutput, uninstallPackage, updatePackages,
} from '../../backend/core/install/doctor.js';
import { installRoot, installDependencies } from '../../backend/core/install/dep-recovery.js';
import { exclusive, INSTALL_SLOT } from '../../backend/core/install/local-jobs.js';
import { snapshotBeforeChange } from '../../backend/core/install/doctor-guard.js';
import {
  homeItems, homeCursor, homeStatus, findEntry, HEALTH_TABS, nextHealthTab, tabCounts, packageLines, packageActions, versionItems,
  versionCursor, jobLine, titleJobLine, errorLines, updateAllItems, UPDATE_ALL_NOTE,
} from '../menus/doctor-view.js';

/**
 * Every modal the agent can raise: questions, command approval, plan review,
 * and the /mode, /model, /config and /github pickers.
 *
 * All of them answer through `Choices` (`Panel.jsx`) rather than raw keypresses — an
 * approval that could be triggered by a stray 'y' in typed text is how edits
 * used to get applied without anyone agreeing to them.
 */
/**
 * Settings rows whose Enter opens a chooser rather than stepping the value:
 * each choice there needs its cost said beside it (Effort, Startup), or the
 * value is a list (Command rules). ←/→ still change them in place.
 */
const OPENS_CHOOSER = new Set(['/effort', '/effort mismatch', '/startup', '/allowlist']);

/** A session's own timestamp, formatted, or '' when it has none. */
function stampOf(session) {
  const ms = session?.updated ?? session?.started;
  if (!ms) return '';
  const when = new Date(ms);
  return Number.isNaN(when.getTime()) ? '' : localStamp(when);
}

/** `2026-09-10 14:32`, in the reader's own timezone. */
function localStamp(when) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} `
    + `${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/**
 * A switch's state for a `Panel` title row (v6.3): `● on` in the success
 * colour, `○ off` muted, then anything else worth knowing at a glance.
 */
function onOff(on, more = '') {
  return {
    status: `${on ? '● on' : '○ off'}${more ? ` · ${more}` : ''}`,
    statusTone: on ? 'success' : 'muted',
  };
}

export function Menus({
  activeMenu,
  setActiveMenu,
  agentLoop,
  terminalWidth = 80,
  menuRows = 20,
  approval = null,
  handleSubmit,
  mode,
  setActiveTab,
  setFocus,
  setHistory,
  setInput,
  setInputAtEnd,
  resetScreen,
}) {
  /**
   * Change a setting, and put the answer where it can actually be read.
   *
   * Every one of these used to set `activeMenu` back to `returnTo` and then push
   * the command's reply into the transcript — and when a menu was opened *from
   * `/settings`*, `returnTo` is the settings page, so the page reopened on top
   * of the message. The setting changed and the confirmation was invisible,
   * which is indistinguishable from nothing having happened. `/effort`,
   * `/config` and the whole allowlist screen had it.
   *
   * So: when there is a page to go back to, go back to it and say nothing — the
   * row you are looking at is the confirmation, and it re-reads live state. When
   * there is not, close and let the transcript answer, which is where a reply
   * belongs when nothing is covering it.
   */
  const applyAndReturn = React.useCallback(async (menu, command, args, typed = null) => {
    // From the settings page, a chooser's pick waits for Apply like a ←/→ on
    // the row does (v6.1) — found by the command the row would run for it.
    if (menu?.returnTo?.type === 'settings') {
      const wanted = `/${[command, ...args].join(' ')}`;
      // The value is the last word: `/startup warm`, `/effort mismatch ask`.
      const value = args[args.length - 1];
      const row = describeSettings(agentLoop).find((r) => r.restore && r.restore(value) === wanted);
      if (row) {
        const { [row.label]: _old, ...rest } = menu.returnTo.pending || {};
        const pending = String(value) === String(row.value) ? rest : { ...rest, [row.label]: value };
        setActiveMenu({ ...menu.returnTo, pending });
        return;
      }
    }
    const result = await agentLoop.handleSlashCommand(command, args);
    if (menu?.returnTo) {
      setActiveMenu(menu.returnTo);
      return;
    }
    setActiveMenu(null);
    setFocus(FOCUS_INPUT);
    if (result?.message) {
      // The command you typed, then its answer — the way every other local
      // command is drawn. Picking from the menu pushed only the answer, so
      // `⚙ effort High → Low` appeared with nothing above saying where it came
      // from (reported: "i changed effort but effort did not show up").
      setHistory((prev) => [...prev,
        // As typed: the chooser's own words, not the value picked in it.
        { role: 'user', content: typed || `/${[command, ...args.slice(0, -1)].join(' ')}`, isLocal: true },
        { role: 'assistant', content: result.message, isLocal: true }]);
    }
  }, [agentLoop, setActiveMenu, setFocus, setHistory]);

  /*
   * `/doctor`'s actions (v5.30). Every install holds the one install slot, so
   * a second press — or `/update pull` meanwhile — is told what is running
   * instead of starting another npm on the same node_modules. The result lands
   * on the package page while the menu is open, and in the transcript if it
   * was closed before npm finished.
   */
  // `/mcp`: a fresh object when a server changes, so the open menu redraws.
  const mcpOpen = activeMenu?.type === 'mcp';
  React.useEffect(() => {
    if (!mcpOpen) return undefined;
    return agentLoop.mcp.onChange(() => {
      setActiveMenu((cur) => (cur?.type === 'mcp' ? { ...cur } : cur));
    });
  }, [mcpOpen, agentLoop, setActiveMenu]);

  const doctorOpen = React.useRef(false);
  const promptPage = React.useRef({ offset: 0, max: 0 }); // `/prompt`'s → page, as drawn
  doctorOpen.current = activeMenu?.type === 'doctor';
  const updateDoctor = React.useCallback((fn) => {
    setActiveMenu((cur) => (cur?.type === 'doctor' ? fn(cur) : cur));
  }, [setActiveMenu]);

  const runDoctorInstall = React.useCallback(async (entry, version = null, { remove = false } = {}) => {
    const isTool = entry?.kind === 'tool';
    // An array is "Remove unused": several packages, one npm run.
    const name = Array.isArray(entry?.name) ? entry.name.join(', ') : entry?.name || 'npm install';
    const cmd = isTool ? entry.install?.[0] : null;
    updateDoctor((cur) => ({
      ...cur, view: entry && !Array.isArray(entry.name) ? 'package' : cur.view,
      job: { state: 'running', name, cmd, removing: remove, version: version || entry?.range || '' },
    }));
    const label = isTool ? `install ${name}` : remove ? `remove ${name}` : version ? `install ${name}@${version}` : 'npm install';
    const result = await exclusive(INSTALL_SLOT, label, async () => {
      if (isTool) return installTool(entry);
      // A change to package.json is tried on the next start; the bin puts it
      // back if that start breaks (`backend/core/install/doctor-guard.js`).
      if (version || remove) {
        snapshotBeforeChange({
          root: REPO_ROOT,
          change: remove ? `remove ${name}` : `${name} ${entry.installed || 'missing'} → ${version}`,
        });
      }
      if (remove) return uninstallPackage({ name: entry.name, workspace: entry.workspace });
      if (version) return installPackage({ name, version, workspace: entry.workspace, range: entry.range });
      const root = installRoot(REPO_ROOT);
      return root ? installDependencies(root, { stdio: 'pipe' }) : { ok: false, error: 'no package.json to install from' };
    });
    const groups = checkInstalled();
    const tools = isTool ? await checkTools() : null;
    const left = groups.flatMap((g) => g.packages).filter((p) => p.status !== 'ok' && p.tier !== 'dev' && p.tier !== 'unused');
    // What the installer printed rides on a failure, shown only when asked for.
    const output = Array.isArray(result.output) ? result.output : errorOutput({ stdout: result.output || result.error || '' });
    const failed = (error) => ({ state: 'failed', name, cmd, version, error, output });
    const job = result.busy ? { state: 'busy', name, holder: result.busy }
      : isTool ? (result.ok ? { state: 'done', name, text: `✔ ${name} ${result.version} installed` } : failed(result.error))
        : remove ? (result.ok ? { state: 'removed', name } : failed(result.error))
        : version ? (result.ok ? { state: 'done', name, installed: result.installed } : failed(result.error))
          : result.ok && left.length === 0
            ? { state: 'done', name, text: '✔ npm install finished · /restart to load what changed' }
            : failed(result.error || `npm install ran, and ${left.map((p) => p.name).join(', ')} still ${left.length === 1 ? 'is' : 'are'} not right`);
    updateDoctor((cur) => ({
      ...cur, job, report: applyLatest({ ...cur.report, groups, ...(tools ? { tools } : {}) }, cur.report.registry),
      // A removed package has no page left to stand on.
      ...(job.state === 'removed' ? { view: 'home', target: null, at: undefined } : {}),
    }));
    if (!doctorOpen.current) {
      setHistory((prev) => [...prev, { role: 'assistant', isLocal: true, content: jobLine(job) }]);
    }
  }, [updateDoctor, setHistory]);

  // Update all (v9.5). The same slot and the same guard as one package.
  const runDoctorUpdates = React.useCallback(async (list) => {
    const name = `${list.length} package${list.length === 1 ? '' : 's'}`;
    updateDoctor((cur) => ({ ...cur, view: 'home', job: { state: 'running', name, bulk: true } }));
    const result = await exclusive(INSTALL_SLOT, `update ${name}`, async () => {
      snapshotBeforeChange({
        root: REPO_ROOT,
        change: `update all: ${list.map((p) => `${p.name} ${p.installed} → ${p.latest}`).join(', ')}`,
      });
      return updatePackages(list);
    });
    const job = result.busy ? { state: 'busy', name, holder: result.busy }
      : result.ok ? { state: 'done', name, text: `✔ ${name} updated · /restart to load them` }
        : {
          state: 'failed', name, error: result.error, output: result.output || [],
          text: `✗ ${result.updated.length} of ${list.length} updated · ${result.failed.join(', ')} did not · ${result.error}`,
        };
    const groups = checkInstalled();
    updateDoctor((cur) => ({ ...cur, job, report: applyLatest({ ...cur.report, groups }, cur.report.registry) }));
    if (!doctorOpen.current) {
      setHistory((prev) => [...prev, { role: 'assistant', isLocal: true, content: jobLine(job) }]);
    }
  }, [updateDoctor, setHistory]);

  const doctorPick = React.useCallback((menu, value, at) => {
    const entry = findEntry(menu.report, menu.target);
    if (value.kind === 'update-all') { setActiveMenu({ ...menu, view: 'update-all', at }); return; }
    if (value.kind === 'update-run') { runDoctorUpdates(value.list); return; }
    if (value.kind === 'package' || value.kind === 'tool') {
      setActiveMenu({
        ...menu, view: 'package', target: value, at,
        importers: value.kind === 'package' && value.workspace === 'server' ? findImporters(value.name) : [],
      });
      return;
    }
    if (value.kind === 'fix') { runDoctorInstall(menu.view === 'home' ? null : entry); return; }
    if (value.kind === 'versions' && entry) {
      setActiveMenu({ ...menu, view: 'versions', versions: null, versionsError: null });
      listVersions(entry.name, { installed: entry.installed }).then((r) => updateDoctor((cur) => ({
        ...cur, versions: r.ok ? r.versions : [], versionsError: r.ok ? null : r.reason,
      })));
      return;
    }
    if (value.kind === 'install' && entry) runDoctorInstall(entry, value.version);
    if (value.kind === 'tool-install' && entry) runDoctorInstall(entry);
    if (value.kind === 'remove' && entry) runDoctorInstall(entry, null, { remove: true });
    if (value.kind === 'remove-unused') {
      runDoctorInstall({ name: value.names, workspace: value.workspace }, null, { remove: true });
    }
    if (value.kind === 'error') setActiveMenu({ ...menu, view: 'error', from: menu.view || 'home' });
  }, [setActiveMenu, runDoctorInstall, runDoctorUpdates, updateDoctor]);

  // Every menu is a `Panel` (`frontend/menus/panel.js`): what it can afford at this height.
  const W = terminalWidth;
  const fit = (subtitle, extra = 0) => panelRoom({ rows: menuRows, width: W, subtitle, extra });

  // Every menu's footer promised `esc cancel` and nothing listened: the agent's
  // own key bindings go inert while a modal is up, and `Choices` knows only
  // the arrows and Enter. So escape lands here, and only here — one step back
  // where a menu has steps, closed otherwise.
  useInput((_char, key) => {
    if (activeMenu?.type === 'chrome') return; // its own steps: ChromeProfiles
    if (activeMenu?.type === 'update') return; // and UpdateMenu's
    // Tab cycles the settings tabs. Not ←/→, which the filter field needs for
    // its cursor, and not shift+tab alone, which is the global mode toggle
    // everywhere else — inside a menu the agent's own bindings are inert, so
    // tab is free here and nowhere else.
    // ←/→ were tabs too until v5.27; they change the selected value now
    // (`SettingsList`), so tab and shift+tab are the only way across.
    if (key.tab && activeMenu?.type === 'settings' && activeMenu.view !== 'leaving') {
      const step = key.shift ? -1 : 1;
      const at = Math.max(0, SETTING_GROUPS.indexOf(activeMenu.group || SETTING_GROUPS[0]));
      const next = (at + step + SETTING_GROUPS.length) % SETTING_GROUPS.length;
      setActiveMenu({ ...activeMenu, group: SETTING_GROUPS[next], query: '', at: 0, notes: {} });
      return;
    }

    // `/help`: ←/→ or tab between the tabs, ↑/↓ over the commands, enter puts
    // the selected one in the prompt. Esc closes, below, like every menu.
    if (activeMenu?.type === 'help') {
      if (key.tab || key.leftArrow || key.rightArrow) {
        const step = key.leftArrow || (key.tab && key.shift) ? -1 : 1;
        setActiveMenu({ ...activeMenu, tab: nextTab(activeMenu.tab, step), cursor: 0 });
        return;
      }
      // ↑/↓ select on Commands and scroll the other two, over the positions
      // the page itself says it has at this size.
      if (key.upArrow || key.downArrow) {
        const { count } = helpPage({
          tab: activeMenu.tab, cursor: activeMenu.cursor, width: terminalWidth,
          rows: Math.max(1, menuRows - HELP_CHROME_ROWS),
        });
        const cursor = Math.max(0, Math.min(count - 1, (activeMenu.cursor || 0) + (key.upArrow ? -1 : 1)));
        setActiveMenu({ ...activeMenu, cursor });
        return;
      }
      if (key.return && activeMenu.tab === 'commands') {
        const name = commandRows().filter((r) => r.kind === 'command')[activeMenu.cursor || 0]?.name;
        setActiveMenu(null);
        setFocus(FOCUS_INPUT);
        if (name) setInputAtEnd(`/${name} `);
        return;
      }
    }

    // `/effort` is a slider: ←/→ move the marker and stop at the ends, enter
    // or a digit applies. Nothing applies on a move, so esc changes nothing.
    if (activeMenu?.type === 'effort') {
      const current = resolveEffort(agentLoop.modelConfig?.effort).id;
      const at = Math.max(0, EFFORT_LEVELS.findIndex((e) => e.id === (activeMenu.at || current)));
      // The Thinking row (v9.9.3), only on an account whose picker has levels.
      const tStops = thinkingStops(agentLoop.modelOptions || []);
      const tSetting = normaliseThinkingSetting(agentLoop.modelConfig?.thinking);
      const tAt = activeMenu.thinking || tSetting;
      if (tStops.length && (key.upArrow || key.downArrow)) {
        setActiveMenu({ ...activeMenu, row: key.downArrow ? 'thinking' : 'effort' });
        return;
      }
      if (tStops.length && activeMenu.row === 'thinking' && (key.leftArrow || key.rightArrow)) {
        const next = stepThinking(tStops, tAt, key.leftArrow ? -1 : 1);
        if (next !== tAt) setActiveMenu({ ...activeMenu, thinking: next });
        return;
      }
      const digitPick = /^[1-9]$/.test(_char) ? Number(_char) - 1 : -1;
      if (tStops.length && tAt !== tSetting && (key.return || (digitPick >= 0 && digitPick < EFFORT_LEVELS.length))) {
        const effortId = EFFORT_LEVELS[key.return ? at : digitPick].id;
        // Only thinking moved: its answer is the reply. Both: thinking is set
        // first, quietly, and the effort row answers (the status bar says the level).
        if (effortId === current) {
          // Echoed as `/effort`, what was typed, not `/effort thinking`.
          applyAndReturn(activeMenu, 'effort', ['thinking', tAt], '/effort');
          return;
        }
        agentLoop.setThinking(tAt);
        applyAndReturn(activeMenu, 'effort', [effortId]);
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        const next = Math.max(0, Math.min(EFFORT_LEVELS.length - 1, at + (key.leftArrow ? -1 : 1)));
        if (next !== at) setActiveMenu({ ...activeMenu, at: EFFORT_LEVELS[next].id });
        return;
      }
      const digit = /^[1-9]$/.test(_char) ? Number(_char) - 1 : -1;
      if (key.return || (digit >= 0 && digit < EFFORT_LEVELS.length)) {
        applyAndReturn(activeMenu, 'effort', [EFFORT_LEVELS[key.return ? at : digit].id]);
        return;
      }
    }

    // `/prompt`: → lists everything the highlighted version changes from v1,
    // ← (or esc, below) goes back to what it adds to the one before it.
    if (activeMenu?.type === 'prompt' && (key.leftArrow || key.rightArrow)) {
      if (!!activeMenu.all !== key.rightArrow) setActiveMenu({ ...activeMenu, all: key.rightArrow, scroll: 0 });
      return;
    }
    if (activeMenu?.type === 'prompt' && activeMenu.all && (key.upArrow || key.downArrow)) {
      // The ref, not the menu state: a held key delivers several presses
      // before the next render, and each would read the same stale offset.
      // Clamped, so ↓ past the end is not undone by as many ↑.
      const page = promptPage.current;
      page.offset = Math.max(0, Math.min(page.max, page.offset + (key.upArrow ? -1 : 1)));
      setActiveMenu((m) => ({ ...m, scroll: page.offset }));
      return;
    }

    // `/doctor`'s tabs: tab, shift+tab or ←/→, on the list only.
    if (activeMenu?.type === 'doctor' && (activeMenu.view || 'home') === 'home'
      && (key.tab || key.leftArrow || key.rightArrow)) {
      const step = key.leftArrow || (key.tab && key.shift) ? -1 : 1;
      setActiveMenu({ ...activeMenu, tab: nextHealthTab(activeMenu.tab || 'all', step), at: undefined });
      return;
    }

    if (!key.escape) return;
    if (activeMenu?.type === 'prompt' && activeMenu.all) {
      setActiveMenu({ ...activeMenu, all: false });
      return;
    }
    // `/mcp` (v9.0): from a server's tools back to the list.
    if (activeMenu?.type === 'mcp' && activeMenu.view === 'add') return; // its own steps: McpAdd
    if (activeMenu?.type === 'mcp' && activeMenu.view === 'remove') {
      setActiveMenu({ ...activeMenu, view: 'server' });
      return;
    }
    if (activeMenu?.type === 'mcp' && activeMenu.view === 'server') {
      setActiveMenu({ ...activeMenu, view: 'home', server: null });
      return;
    }
    // `/logs` (v5.35): from a flow list back to the picker.
    if (activeMenu?.type === 'logs' && activeMenu.view === 'failures') {
      setActiveMenu({ ...activeMenu, view: 'home' });
      return;
    }
    // `/doctor` (v5.30): back one view — versions → package → health — and
    // only the health list closes. Asked for: "back should take to the health
    // home instead of main home". An install keeps running behind it.
    if (activeMenu?.type === 'doctor' && activeMenu.view && activeMenu.view !== 'home') {
      const back = activeMenu.view === 'versions' ? 'package' : activeMenu.view === 'error' ? activeMenu.from || 'home' : 'home';
      setActiveMenu({ ...activeMenu, view: back });
      return;
    }
    // The picker previews by applying each palette as you move; leaving
    // without choosing puts back the one you came in with.
    // The mismatch ask (v5.28): cancelling must not lose what was typed.
    if (activeMenu?.type === 'effort_mismatch' || activeMenu?.type === 'compaction_ask') {
      setActiveMenu(null);
      setFocus(FOCUS_INPUT);
      setInputAtEnd(activeMenu.query);
      return;
    }
    if (activeMenu?.type === 'theme') {
      setTheme(activeMenu.original);
      if (activeMenu.returnTo) { setActiveMenu(activeMenu.returnTo); return; }
      setActiveMenu(null);
      setFocus(FOCUS_INPUT);
      return;
    }
    // Escape clears a filter before it closes the page: having typed three
    // letters, "get me out of this filter" is the more likely of the two.
    if (activeMenu?.type === 'settings' && activeMenu.query) {
      setActiveMenu({ ...activeMenu, query: '' });
      return;
    }
    // On the way out, Apply or Revert — and only when something is waiting
    // (v6.1: nothing on the page runs until Apply). No dialog when nothing
    // changed: a confirmation you always dismiss teaches people to dismiss
    // confirmations. Esc on the dialog goes back to the page, changes kept.
    if (activeMenu?.type === 'settings' && activeMenu.view === 'leaving') {
      setActiveMenu({ ...activeMenu, view: undefined, changes: undefined });
      return;
    }
    if (activeMenu?.type === 'settings') {
      const changes = stagedChanges(describeSettings(agentLoop), activeMenu.pending);
      if (changes.length > 0) {
        setActiveMenu({ ...activeMenu, view: 'leaving', changes });
        return;
      }
    }
    if (activeMenu?.returnTo && !(activeMenu.type === 'allowlist' && activeMenu.view)) {
      setActiveMenu(activeMenu.returnTo);
      return;
    }
    if (activeMenu?.type === 'allowlist' && activeMenu.view) {
      setActiveMenu({ ...activeMenu, view: activeMenu.view === 'confirm' ? 'list' : null, pending: null });
      return;
    }
    setActiveMenu(null);
    setFocus(FOCUS_INPUT);
  }, { isActive: !!activeMenu });

  return (
    <>
        {activeMenu?.type === 'ask_question' && (
          <QuestionPrompt
            payload={activeMenu.payload}
            width={W}
            rows={menuRows}
            onAnswer={(entries) => {
              setActiveMenu(null);
              // The answer is drawn by the `ask_question` row, from the result
              // turn (`questionRows`). A row added here as well was the same
              // answer twice, and the only copy a reprint or resume lost.
              agentLoop.answerQuestion(entries);
              setFocus(FOCUS_INPUT);
            }}
            onCancel={() => {
              setActiveMenu(null);
              agentLoop.cancelQuestion();
              setFocus(FOCUS_INPUT);
            }}
          />
        )}

        {/*
          `/help`: box-less, like Claude Code's — a rule, the tabs, the page and
          one line of keys. Fitted to `menuRows` by `helpPage`, every row
          truncated, so it is exactly the height it was given.
        */}
        {activeMenu?.type === 'help' && (() => {
          const page = helpPage({
            tab: activeMenu.tab,
            cursor: activeMenu.cursor,
            width: terminalWidth,
            rows: Math.max(1, menuRows - HELP_CHROME_ROWS),
          });
          return (
            <Box flexDirection="column">
              <Text color={T.muted} wrap="truncate">{'─'.repeat(Math.max(1, terminalWidth))}</Text>
              <Text wrap="truncate">
                {HELP_TABS.map(([id, label], i) => (
                  <React.Fragment key={id}>
                    {i > 0 ? '   ' : ' '}
                    {id === activeMenu.tab
                      ? <Text bold inverse color={T.menu}>{` ${label} `}</Text>
                      : <Text dimColor>{` ${label} `}</Text>}
                  </React.Fragment>
                ))}
              </Text>
              <Text> </Text>
              {page.lines.map((line, i) => {
                // Headings in the accent, names plain, what they do dimmed —
                // three weights, so the two columns read apart at a glance.
                if (line.kind === 'heading') return <Text key={i} bold color={T.accent} wrap="truncate">{` ${line.text}`}</Text>;
                if (line.kind === 'more') return <Text key={i} color={T.muted} wrap="truncate">{`   ${line.text}`}</Text>;
                if (line.kind === 'blank') return <Text key={i}> </Text>;
                if (line.name) {
                  const rest = line.text.slice(line.name.length);
                  const lead = line.kind === 'command' ? (line.selected ? ' ❯  ' : '    ') : ' ';
                  return (
                    <Text key={i} wrap="truncate">
                      <Text color={line.selected ? T.accent : undefined} bold={line.selected}>{lead}{line.name}</Text>
                      {line.selected
                        ? <Text color={T.accent}>{rest}</Text>
                        : <Text dimColor>{rest}</Text>}
                    </Text>
                  );
                }
                return <Text key={i} wrap="truncate">{` ${line.text}`}</Text>;
              })}
              <Text> </Text>
              <Text dimColor wrap="truncate">
                {activeMenu.tab === 'commands'
                  ? ' ←/→ tabs · ↑↓ move · enter puts it in the prompt · esc close'
                  : ' ←/→ or tab to switch · ↑↓ scroll · esc close'}
              </Text>
            </Box>
          );
        })()}

        {activeMenu?.type === 'command_approval' && activeMenu.payload?.kind === 'external' && (() => {
          /*
            A write to Jira (v8.1). Send or Don't send, nothing else: no
            "always", because the owner asked for every write to be asked about,
            and a remembered yes is a write nobody looked at. Rows are decided
            by `approvalLayout`, as for a command.
          */
          const p = activeMenu.payload;
          // An MCP call (v9.1) brings its own: Run, Always for this tool, Don't run.
          const choices = p.choices || [{ label: 'Send', value: 'send' }, { label: "Don't send", value: 'reject' }];
          return (
            <Panel tight ruled={approval?.ruled !== false} tone="attention" width={W}
              title={p.title || 'Send this?'}
              status={`${p.cwd ? String(p.cwd).replace(/^https?:\/\//, '') : ''}${approval?.hidden > 0
                ? ` · ${approval.hidden} more line${approval.hidden === 1 ? '' : 's'} not shown`
                : ''}`}>
              {(approval?.command ?? p.lines ?? []).map((line, i) => (
                <Text key={i} wrap="truncate">{' '}{i === 0 ? <Text bold>{line}</Text> : line}</Text>
              ))}
              {approval?.reason !== false && <Text wrap="truncate" dimColor> {p.riskReason}</Text>}
              {approval?.padded !== false && <Text> </Text>}
              {/* The cursor starts on Don't send: an Enter typed ahead, meant for
                  the prompt, must not post to Jira. Sending is ↑ then enter. */}
              <Choices
                limit={choices.length}
                initialIndex={choices.length - 1}
                items={choices}
                onSelect={(item) => {
                  setActiveMenu(null);
                  agentLoop.answerCommandApproval(item.value, null);
                  setHistory(prev => [...prev, { role: 'system', content: `[System: ${item.value === 'reject' ? `You did not ${p.choices ? 'run' : 'send'} it` : `You ${p.choices ? 'ran' : 'sent'} it`}]` }]);
                  setFocus(FOCUS_INPUT);
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'command_approval' && activeMenu.payload?.kind !== 'external' && (() => {
          /*
            Every row here is decided by `approvalLayout` (live-layout.js) and drawn
            truncated, so the panel is exactly the height App charged for it. A
            row that wraps is a row nobody paid for. No digits: an approval that
            a stray keypress could answer is how things used to run without
            anyone agreeing to them.
          */
          const p = activeMenu.payload;
          const critical = p.riskLevel === 'critical';
          return (
            <Panel tight ruled={approval?.ruled !== false} tone={critical ? 'danger' : 'attention'} width={W}
              title="Run this command?"
              status={`${p.riskLevel} risk${approval?.hidden > 0
                ? ` · ${approval.hidden} more line${approval.hidden === 1 ? '' : 's'} of the command not shown`
                : ''}`}>
              {(approval?.command ?? [`Command: ${p.command}`]).map((line, i) => (
                <Text key={i} wrap="truncate">
                  {' '}{i === 0
                    ? <><Text dimColor>{'Command: '}</Text><Text bold>{line.slice('Command: '.length)}</Text></>
                    : <Text bold>{line}</Text>}
                </Text>
              ))}
              {approval?.cwd !== false && <Text wrap="truncate"> <Text dimColor>Directory: </Text>{p.cwd}</Text>}
              {approval?.reason !== false && <Text wrap="truncate"> <Text dimColor>Reason:    </Text>{p.riskReason}</Text>}
              {approval?.padded !== false && <Text> </Text>}
              <Choices
                limit={4}
                items={[
                  { label: 'Allow once', value: 'allow_once' },
                  { label: 'Allow always', detail: 'add it to the allowlist', value: 'allow_always' },
                  { label: 'Reject', value: 'reject' },
                  { label: 'Reject always', detail: 'add it to the blocklist', value: 'reject_always' },
                ]}
                onSelect={(item) => {
                  setActiveMenu(null);
                  agentLoop.answerCommandApproval(item.value, p.command);

                  /*
                   * The decision, not the command. It used to repeat the whole
                   * command, and a system row wraps: a one-line `for` loop drew
                   * four rows, charged as one, in the live frame — the overflow
                   * that cleared the screen on every render at 10 rows while the
                   * command ran. The command is on the running row under this
                   * (and on the tool row once it finishes), so saying it here
                   * too was the only part that cost anything.
                   */
                  const decision = {
                    allow_once: 'You allowed the command once',
                    allow_always: 'You allowed the command always (added to the allowlist)',
                    reject: 'You rejected the command',
                    reject_always: 'You rejected the command always (added to the blocklist)',
                  }[item.value];
                  if (decision) setHistory(prev => [...prev, { role: 'system', content: `[System: ${decision}]` }]);
                  setFocus(FOCUS_INPUT);
                }}
              />
            </Panel>
          );
        })()}

        {/*
          Destroying more than you named.

          The app already stops before deleting *one* allowlist rule and spells
          the rule out first. Then `/allowlist clear` took seven of them on one
          keypress and reported it in the past tense, and `/clear` is a single
          Enter on the settings screen's Session row. Which of those needs asking
          is decided in `frontend/menus/destructive.js`, so the typed path and the settings
          path cannot disagree about it.
        */}
        {activeMenu?.type === 'confirm_destructive' && (() => {
          const { sub, tight } = fit(activeMenu.payload.detail);
          return (
            <Panel tone="attention" width={W} title={activeMenu.payload.title} sub={sub} tight={tight}
              keys="↑↓ move · enter choose · esc cancel">
              <Choices
                items={[
                  { label: 'Cancel', detail: 'change nothing', value: 'no' },
                  { label: activeMenu.payload.confirmLabel, value: 'yes', colour: T.danger },
                ]}
                onSelect={(item) => {
                  const pending = activeMenu.payload;
                  setActiveMenu(null);
                  setFocus(FOCUS_INPUT);
                  // Cancel says nothing (v7.10, owner: "there is no need"): the
                  // menu closing is the answer, as esc's always was.
                  if (item.value === 'yes') pending.onConfirm?.();
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'plan_review' && (() => {
          const { sub, tight } = fit(activeMenu.path
            ? `Shown above, and saved at ${activeMenu.path}.`
            : 'The agent has written a plan.');
          return (
            <Panel tone="review" width={W} title="Plan ready for review" sub={sub} tight={tight}
              keys="↑↓ move · enter choose">
              <Choices
                items={[
                  { label: 'Proceed', detail: 'carry out the plan', value: 'accept' },
                  { label: 'Reject', detail: 'and wait for my feedback', value: 'reject' },
                  { label: 'Give feedback', detail: 'type it in the prompt', value: 'custom' },
                ]}
                onSelect={(item) => {
                  setActiveMenu(null);
                  if (item.value === 'accept') {
                    handleSubmit('I have reviewed the implementation plan and approve it. Please proceed with the execution phase.');
                  } else if (item.value === 'reject') {
                    handleSubmit('I reject the implementation plan. Please wait for my feedback.');
                  } else {
                    setFocus(FOCUS_INPUT);
                  }
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'effort' && (() => {
          /*
           * A slider, the way Claude Code draws its effort control (asked for
           * 2026-10-26): Faster ← → Smarter, a marker on the bar, the levels
           * under it, and what the marked one is on two lines below. Laid out by
           * `sliderLayout` at an exact width; keys are in the `useInput` above.
           */
          const current = resolveEffort(agentLoop.modelConfig?.effort).id;
          const at = Math.max(0, EFFORT_LEVELS.findIndex((e) => e.id === (activeMenu.at || current)));
          const marked = EFFORT_LEVELS[at];
          const s = sliderLayout({ levels: EFFORT_LEVELS, at, width: W });
          const pad = ' '.repeat(s.indent);
          // The spaces that centre `text` under the bar.
          const lead = (text) => ' '.repeat(Math.max(1, s.indent + Math.floor((s.span - text.length) / 2)));
          // Each stop names the model it maps to on this account (C2).
          const stops = EFFORT_LEVELS.map((e) => stopModel(e, agentLoop.modelOptions, agentLoop.modelConfig));
          const model = stops[at];
          // One model on the account (v9.9.1): say so, rather than "Auto" under every stop.
          const only = onlyModel(agentLoop.modelOptions);
          const modelText = only ? onlyModelLine(only) : model.text;
          const tick = marked.id === current ? '  ✔ current' : '';
          const differs = tabDiffers(model, agentLoop.modelOptions);
          const warn = differs ? `  ⚠ browser ${differs}` : '';
          // The Thinking row (v9.9.3): absent on an account with no levels.
          const tStops = thinkingStops(agentLoop.modelOptions || []);
          const thinking = tStops.length ? thinkingLine({
            stops: tStops,
            at: activeMenu.thinking || normaliseThinkingSetting(agentLoop.modelConfig?.thinking),
            rung: marked.id,
            options: agentLoop.modelOptions || [],
          }) : null;
          const onThinking = Boolean(thinking) && activeMenu.row === 'thinking';
          const { tight } = fit('', thinking ? 6 : 5);
          // A blank row each side of the model line (owner, 2026-10-26: "fix
          // spacing between effort, model name and description, just a bit"),
          // when the panel has the two rows; rule + title + gap + gap + keys
          // + the five slider rows + these two is 12, and the Thinking row
          // with its gap two more.
          const airy = !tight && menuRows >= (thinking ? 14 : 12);
          let used = 0;
          return (
            <Panel width={W} title="Effort" tight={tight}
              keys={thinking
                ? `↑↓ effort or thinking · ←/→ adjust · enter confirm · esc cancel`
                : `←/→ adjust · 1–${EFFORT_LEVELS.length} or enter confirm · esc cancel`}>
              {tight ? null : <Text dimColor wrap="truncate">{pad}{s.ends}</Text>}
              <Text wrap="truncate">
                {pad}<Text color={T.muted}>{s.bar.before}</Text>
                <Text color={T.accent} bold>{s.bar.marker}</Text>
                <Text color={T.muted}>{s.bar.after}</Text>
              </Text>
              <Text wrap="truncate">
                {pad}
                {s.labels.map((label, i) => {
                  const gap = ' '.repeat(Math.max(0, label.col - used));
                  used = label.col + label.text.length;
                  return (
                    <React.Fragment key={label.text}>
                      {gap}
                      {i === at
                        ? <Text bold color={T.accent}>{label.text}</Text>
                        : <Text dimColor={EFFORT_LEVELS[i].id !== current || !stops[i].available}>{label.text}</Text>}
                    </React.Fragment>
                  );
                })}
              </Text>
              {airy ? <Text> </Text> : null}
              <Text wrap="truncate" dimColor={!model.available}>
                {lead(modelText + tick + warn)}{modelText}
                {tick ? <Text color={T.success}>{tick}</Text> : null}
                {warn ? <Text color={T.attention}>{warn}</Text> : null}
              </Text>
              {airy ? <Text> </Text> : null}
              <Text dimColor wrap="truncate">{lead(marked.blurb)}{marked.blurb}</Text>
              {thinking && airy ? <Text> </Text> : null}
              {thinking ? (
                <Text wrap="truncate">
                  {pad}<Text color={onThinking ? T.accent : undefined} bold={onThinking}>{thinking.name}</Text>
                  <Text color={onThinking ? T.accent : undefined}>{thinking.value}</Text>
                  <Text dimColor>{thinking.detail}</Text>
                </Text>
              ) : null}
            </Panel>
          );
        })()}

        {activeMenu?.type === 'theme' && (() => {
          /*
           * Live preview, Claude Code style: moving the highlight applies that
           * palette, so this panel and the live frame show it at once. Only the
           * committed transcript keeps the old colours until enter reprints it.
           */
          const names = Object.keys(PALETTES);
          // a gap, then the biggest preview that keeps all six visible
          const size = previewSize((extra) => fit('', extra), names.length, 1);
          const { sub, tight, room } = fit('', 1 + PREVIEW_ROWS[size]);
          return (
            <Panel width={W} title="Theme" sub={sub} tight={tight}
              keys={`↑↓ preview · enter keep · esc ${activeMenu.returnTo ? 'back' : 'put it back'}`}>
              <Choices
                numbered
                limit={room}
                initialIndex={Math.max(0, names.indexOf(activeMenu.original))}
                items={names.map((n) => ({
                  label: PALETTE_INFO[n].label, detail: PALETTE_INFO[n].blurb, value: n, current: n === activeMenu.original,
                }))}
                onHighlight={(item) => {
                  setTheme(item.value);
                  setActiveMenu((m) => ({ ...m, at: item.value }));
                }}
                onSelect={(item) => {
                  setTheme(item.value);
                  const saved = saveUserSettings({ theme: item.value });
                  agentLoop.notifyPanelChange?.();
                  if (item.value !== activeMenu.original) resetScreen?.();
                  // From settings, the row is the confirmation (`applyAndReturn`'s rule).
                  if (activeMenu.returnTo && saved) { setActiveMenu(activeMenu.returnTo); return; }
                  setActiveMenu(null);
                  setFocus(FOCUS_INPUT);
                  setHistory((prev) => [...prev, {
                    role: 'assistant', isLocal: true,
                    content: changed('theme', PALETTE_INFO[activeMenu.original]?.label || activeMenu.original,
                      PALETTE_INFO[item.value].label, saved ? '' : 'this session only; ~/.agent/settings.json could not be written'),
                  }]);
                }}
              />
              <ThemePreview size={size} marginTop={1} marginLeft={size === 'rows' ? 3 : 2} />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'name' && (() => {
          /*
           * Renaming the agent, where the row that names it is.
           *
           * The row ran `/name`, and `/name` with no argument prints. So the
           * one row on the settings page that reads as directly editable was
           * the one that could not be edited — the plan-mode-markdown shape in
           * miniature: an interface that says one thing and does another.
           *
           * The length is checked *here* as well as in the handler, and that
           * is not belt and braces. `applyAndReturn` drops the handler's
           * message whenever there is a `returnTo`, which there always is from
           * this page — so a name that is too long would return to the settings
           * screen with nothing changed and nothing said, which is the failure
           * this whole row is being fixed for. `MAX_AGENT_NAME` is imported so
           * the two cannot drift apart.
           *
           * Empty clears the name, because that is what the field being empty
           * means; the handler spells it `default`.
           */
          const draft = activeMenu.draft ?? '';
          const wanted = draft.trim();
          const over = wanted.length - MAX_AGENT_NAME;
          const { tight } = fit('', 2);

          return (
            <Panel width={W} title="Agent name" tight={tight}
              keys={`enter ${over > 0 ? '· fix the length first' : 'save'} · esc cancel`}>
              <Box>
                <Text color={T.accent}>{' ❯ '}</Text>
                <TextInput
                  value={draft}
                  placeholder="Agent CLI"
                  onChange={(value) => setActiveMenu((m) => ({ ...m, draft: value }))}
                  onSubmit={async () => {
                    if (over > 0) return;
                    await applyAndReturn(activeMenu, 'name', [wanted || 'default']);
                  }}
                />
              </Box>
              <Text color={over > 0 ? T.attention : undefined} dimColor={over <= 0} wrap="truncate">
                {'   ↳ '}
                {over > 0
                  ? `${wanted.length}/${MAX_AGENT_NAME} — too long for the banner, drop ${over}`
                  : (wanted
                    ? 'drawn as the banner wordmark · restart to see it'
                    : 'empty clears it — the banner reads “Agent CLI”')}
              </Text>
            </Panel>
          );
        })()}

        {/*
          One screen, and now one question. It used to be a role picker, then a
          model picker, then Solo-or-Duo — a chain that existed because there
          were two models to arrange. With one, the only thing left to decide is
          whether this session can fan work out to parallel tabs of itself.
        */}
        {activeMenu?.type === 'config' && (() => {
          const on = agentLoop.subagentsEnabled;
          const run = async (args) => { await applyAndReturn(activeMenu, 'subagents', args); };
          // v6.3, owner: "this seems very cluttered". The state is on the title
          // row in colour, one short line says what it is, options lead with
          // what they are.
          const { sub, tight, room } = fit('Extra tabs that research or review in parallel.');

          return (
            <Panel width={W} title="Subagents" {...onOff(on)} sub={sub} tight={tight}
              keys={`↑↓ move · 1–2 or enter choose · esc ${activeMenu.returnTo ? 'back' : 'cancel'}`}>
              <Choices
                numbered
                limit={room}
                initialIndex={on ? 0 : 1}
                items={[
                  { glyph: '●', glyphTone: 'success', label: 'On', detail: 'research, review, errands', value: 'subagents on', current: on },
                  { glyph: '○', glyphTone: 'muted', label: 'Off', detail: 'one tab does everything', value: 'subagents off', current: !on },
                ]}
                onSelect={(item) => run(item.value.split(' '))}
              />
            </Panel>
          );
        })()}

        {/*
          Warm or cold start (v5.27). Both choices explained where they are
          chosen: "setup prompt" means nothing until it says what it is and
          what each choice costs.
        */}
        {/*
          The effort says one model and the browser is on another (v5.28,
          `backend/core/models/model-fallback.js`). Asked before the message is typed, once per
          disagreement; the message waits here and comes back to the box on esc.
        */}
        {/*
          Past the compaction threshold (v7.5): compact now or carry on. Asked
          once per chat, before the message is sent; esc puts it back in the box.
        */}
        {activeMenu?.type === 'compaction_ask' && (() => {
          const { ask, query, opts } = activeMenu;
          const k = (n) => (n < 1000 ? `${n}` : `${Math.round(n / 1000)}k`);
          const { sub, tight, room } = fit(
            `~${k(ask.tokens)} of ${k(ask.limit)} tokens. Compacting summarises this chat and carries on in a fresh one.`,
          );
          const items = [
            { label: 'Compact now', detail: 'then send · about 15 s', value: 'now' },
            { label: 'Continue in this chat', detail: 'not asked again here · /compact any time', value: 'continue' },
          ];
          return (
            <Panel width={W} title={`Context is ${ask.pct}% full`} tone="attention" sub={sub} tight={tight}
              keys="enter choose · esc cancel — your message goes back in the box">
              <Choices
                numbered
                limit={room}
                items={items}
                onSelect={(item) => {
                  setActiveMenu(null);
                  setFocus(FOCUS_INPUT);
                  if (item.value === 'continue') agentLoop.declineCompaction();
                  handleSubmit(query, { ...opts, compaction: item.value });
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'effort_mismatch' && (() => {
          const { ask, query } = activeMenu;
          const setting = resolveEffort(ask.setting);
          const browserRung = ask.browserRung ? resolveEffort(ask.browserRung) : null;
          const { sub, tight, room } = fit(
            `Browser ${ask.current} ≠ agent ${ask.wanted} (effort ${setting.name}).`,
          );
          /*
           * Two answers (v7.9): one side moves to the other. There were three,
           * and "Send on 3.8 Flash" (this once, effort unchanged) sat between
           * the two real choices; asked "what is this third option, is it
           * needed?". Matching the browser sets the effort to the rung that
           * maps to the tab's model; with no such rung (a model no rung answers
           * to) it can only mean sending on it, not asked again.
           */
          const matchBrowser = browserRung && browserRung.id !== setting.id
            ? { detail: `set effort to ${browserRung.name} (${ask.current}), then send`, value: 'set' }
            : { detail: `send on ${ask.current} · not asked again for this`, value: 'follow' };
          const items = [
            { label: 'Match the agent', detail: `switch the tab to ${ask.wanted}, then send`, value: 'switch' },
            { label: 'Match the browser', ...matchBrowser },
          ];
          return (
            <Panel width={W} title="Model mismatch" tone="attention" sub={sub} tight={tight}
              keys="enter choose · esc cancel — your message goes back in the box">
              <Choices
                numbered
                limit={room}
                items={items}
                onSelect={async (item) => {
                  setActiveMenu(null);
                  setFocus(FOCUS_INPUT);
                  if (item.value === 'set') {
                    const result = await agentLoop.handleSlashCommand('effort', [browserRung.id]);
                    if (result?.message) {
                      setHistory((prev) => [...prev, { role: 'assistant', content: result.message, isLocal: true }]);
                    }
                  }
                  if (item.value === 'follow') agentLoop.ackMismatch(ask.key);
                  handleSubmit(query, { mismatch: item.value, switchTo: item.value === 'switch' ? ask.setting : null });
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'startup' && (() => {
          const warm = agentLoop.startupMode === 'warm';
          const { sub, tight, room } = fit('When a new chat gets the setup (about 20k characters).');
          return (
            <Panel width={W} title="Startup" status={warm ? 'warm' : 'cold'} statusTone="accent" sub={sub} tight={tight}
              keys={`↑↓ move · 1–2 or enter choose · esc ${activeMenu.returnTo ? 'back' : 'cancel'}`}>
              <Choices
                numbered
                limit={room}
                initialIndex={warm ? 1 : 0}
                items={[
                  { label: 'Cold', detail: 'with your first message', value: 'cold', current: !warm },
                  { label: 'Warm', detail: 'when Chrome connects · one extra message', value: 'warm', current: warm },
                ]}
                onSelect={(item) => applyAndReturn(activeMenu, 'startup', [item.value])}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'mismatch-policy' && (() => {
          /*
           * "Browser differs" as a chooser (v7.9). It was a ←/→ ladder of three
           * bare words, `ask · follow · switch`, and the owner found it
           * "confusing even for me": the words name a reaction without saying
           * to what. The sub-line says the situation; each row, what happens.
           */
          const policy = mismatchPolicy(agentLoop.modelConfig);
          const order = ['ask', 'follow', 'switch'];
          const { sub, tight, room } = fit('What a message does when the tab is on another model.');
          return (
            <Panel width={W} title="When the browser differs" status={policy} statusTone="accent" sub={sub} tight={tight}
              keys={`↑↓ move · 1–3 or enter choose · esc ${activeMenu.returnTo ? 'back' : 'cancel'}`}>
              <Choices
                numbered
                limit={room}
                initialIndex={Math.max(0, order.indexOf(policy))}
                items={[
                  { label: 'Ask', detail: 'stop first: match the agent or match the browser', value: 'ask', current: policy === 'ask' },
                  { label: 'Follow', detail: "send on the tab's model and never ask", value: 'follow', current: policy === 'follow' },
                  { label: 'Switch', detail: "move the tab to the effort's model before sending", value: 'switch', current: policy === 'switch' },
                ]}
                onSelect={(item) => applyAndReturn(activeMenu, 'effort', ['mismatch', item.value])}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'prompt' && (() => {
          /*
           * A comparison as well as a choice (v6.11, "this looks a bit dull"):
           * rounds per turn as a bar per version, then what the highlighted
           * one changes from v1. Laid out by `frontend/menus/prompt-view.js`; both blocks
           * give way on a short terminal, the list never does.
           */
          const rows = promptVersionRows(agentLoop);
          const current = rows.find((r) => r.current) || rows[0];
          const at = rows.find((r) => r.id === activeMenu.at) || current;
          const { sub, tight, room } = fit('Jira, MCP and memory work on both.');
          // What it adds to the version before it (v8.1: v4's one new line was
          // behind "… +6 more"). → opens a page of everything it changes from
          // v1, which hides the list and scrolls with ↑↓.
          const adds = versionAdds(at.id);
          const everything = versionChanges(at.id);
          const back = activeMenu.returnTo ? 'back' : 'cancel';
          if (activeMenu.all) {
            const page = changesPage({ changes: everything, rows: room - 1, offset: activeMenu.scroll || 0 });
            promptPage.current = { offset: page.offset, max: page.max };
            return (
              <Panel width={W} title="Prompt" status={current.id} statusTone="accent" sub={sub} tight={tight}
                keys={`${everything.length > room - 1 ? '↑↓ scroll · ' : ''}← or esc back`}>
                <Text wrap="truncate">{'   '}<Text bold>{everything.length ? `Everything ${at.label} changes from original` : `${at.label} is the baseline`}</Text></Text>
                {page.lines.map((line) => (
                  line.startsWith('… ')
                    ? <Text key={line} dimColor wrap="truncate">{'     '}{line}</Text>
                    : <Text key={line} wrap="truncate">{'   '}<Text color={T.accent}>▸ </Text>{line}</Text>
                ))}
              </Panel>
            );
          }
          const changes = adds.lines;
          // v9.9.5: two versions, so "adds to the one before" is "changes from original".
          const heading = changes.length ? `What ${at.label} changes from ${PROMPT_VERSIONS[adds.from]?.label || adds.from}`
            : 'The baseline, kept to compare against';
          const plan = promptPanelPlan({
            room: room - rows.length, versions: rows.length,
            changes: changes.length ? changes : [at.summary],
          });
          const canExpand = plan.changes.filter((l) => !l.startsWith('… ')).length < everything.length;
          const max = Math.max(0, ...rows.map((r) => r.p90 ?? r.median ?? 0));
          const idW = Math.max(...rows.map((r) => r.label.length));
          const barW = Math.max(6, Math.min(24, W - idW - 40));
          return (
            <Panel width={W} title="Prompt" status={current.id} statusTone="accent" sub={sub} tight={tight}
              keys={`↑↓ move · 1–${rows.length} or enter choose · ${canExpand ? '→ all changes · ' : ''}esc ${back}`}>
              <Choices
                numbered
                limit={rows.length}
                initialIndex={Math.max(0, rows.indexOf(at))}
                items={rows.map((r) => ({
                  label: r.label, detail: `${r.id} · ${r.hint}`, value: r.id, current: r.current,
                }))}
                onHighlight={(item) => setActiveMenu((m) => ({ ...m, at: item.value }))}
                onSelect={(item) => applyAndReturn(activeMenu, 'prompt', [item.value])}
              />
              {plan.stats ? (
                <>
                  <Text> </Text>
                  <Text wrap="truncate">{'   '}<Text bold>Rounds per turn</Text><Text dimColor>  fewer is faster</Text></Text>
                  {rows.map((r) => {
                    const bar = roundsBar({ median: r.median, p90: r.p90, max, width: barW });
                    const sel = r.id === at.id;
                    return (
                      <Text key={r.id} wrap="truncate">
                        {'   '}<Text color={sel ? T.accent : undefined} bold={sel}>{r.label.padEnd(idW)}</Text>{'  '}
                        <Text color={T.accent}>{'━'.repeat(bar.fill)}</Text>
                        <Text color={T.muted}>{'─'.repeat(bar.tail)}</Text>
                        {' '.repeat(Math.max(0, barW - bar.fill - bar.tail))}{'  '}
                        <Text dimColor>{roundsLabel(r)}</Text>
                      </Text>
                    );
                  })}
                </>
              ) : null}
              {plan.changes.length ? (
                <>
                  <Text> </Text>
                  <Text wrap="truncate">{'   '}<Text bold>{heading}</Text></Text>
                  {plan.changes.map((line) => (
                    line.startsWith('… +')
                      ? <Text key={line} dimColor wrap="truncate">{'     '}{line}</Text>
                      : <Text key={line} wrap="truncate">{'   '}<Text color={T.accent}>▸ </Text>{line}</Text>
                  ))}
                </>
              ) : null}
            </Panel>
          );
        })()}

        {/*
          `/help` answers "what can I type?". This answers "how is this set up?",
          which had no answer — it was spread across /config, /effort, /memory,
          /allowlist and the status bar, one command per fact. Picking a row
          runs the command that already owns that setting, so the page is a way
          in rather than a second place to change things.
        */}
        {activeMenu?.type === 'settings' && (() => {
          const rows = describeSettings(agentLoop);
          const query = activeMenu.query || '';
          const group = activeMenu.group || SETTING_GROUPS[0];
          const matches = filterSettings(rows, query, group);

          // ── Leaving, with changes waiting ──────────────────────────
          // Apply runs them; Revert drops them and prints nothing, because
          // nothing changed. Owner, 2026-10-30, with a screenshot of three
          // lines left behind by a change that had been put back.
          if (activeMenu.view === 'leaving') {
            const changes = activeMenu.changes || [];
            const labelCol = Math.max(...changes.map((c) => c.label.length + 1));
            const { sub, tight } = fit('', changes.length + 1);
            return (
              <Panel width={W} title={`${changes.length} change${changes.length === 1 ? '' : 's'} not applied`}
                sub={sub} tight={tight} keys="↑↓ move · enter choose · esc back">
                {/* `Label:` then the values in one column — `Browser differs  ask`
                    read as one phrase (owner, 2026-10-30, with a screenshot). */}
                {changes.map((c) => (
                  <Text key={c.label} wrap="truncate">
                    {'   '}<Text>{`${c.label}:`.padEnd(labelCol)}</Text>
                    <Text dimColor>{'  '}{c.from}{' → '}</Text>
                    <Text color={T.link}>{c.to}</Text>
                  </Text>
                ))}
                <Text> </Text>
                <Choices
                  items={[{ label: 'Apply', value: 'apply' }, { label: 'Revert', value: 'revert' }]}
                  onSelect={async (item) => {
                    setActiveMenu(null);
                    setFocus(FOCUS_INPUT);
                    if (item.value !== 'apply') return;
                    // One at a time and in order: each runs the command that
                    // owns that setting, which is the same path typing it takes.
                    const before = describeSettings(agentLoop);
                    const refused = [];
                    for (const change of changes) {
                      const [command, ...args] = change.restore.slice(1).split(' ');
                      let reply = '';
                      try {
                        reply = (await agentLoop.handleSlashCommand(command, args))?.message || '';
                      } catch (err) {
                        reply = err?.message || String(err);
                      }
                      const now = describeSettings(agentLoop).find((r) => r.label === change.label)?.value;
                      // Refused (`/effort max` with no Argon): its reply says why.
                      if (String(now) !== String(change.to)) refused.push(oneLine(reply, 160));
                    }
                    const lines = [...changedLines(before, describeSettings(agentLoop)), ...refused];
                    if (!lines.length) return;
                    setHistory(prev => [...prev, { role: 'assistant', isLocal: true, content: lines.join('\n') }]);
                  }}
                />
              </Panel>
            );
          }

          // ── The page ───────────────────────────────────────────────
          // Option C′ (`frontend/menus/settings-view.js`): the filter on top, underlined;
          // switches and ladders that ←/→ change in place; the hint on the
          // selected row. Tabs drawn as `/help` draws them.
          const stops = Object.fromEntries(EFFORT_LEVELS.map((e) =>
            [e.id, stopModel(e, agentLoop.modelOptions, agentLoop.modelConfig)]));
          const pending = activeMenu.pending || {};
          const shown = matches.map((row) => {
            const value = pending[row.label] ?? row.value;
            // Waiting for Apply: the label says so in the attention colour.
            const staged = String(value) !== String(row.value);
            if (row.label !== 'Effort') return { ...row, value, staged };
            // Your model, not the rung's generic one — what the slider says.
            return {
              ...row, value, staged,
              hint: `runs on ${stops[value]?.text ?? row.hint}`,
              skip: stops.max?.available === false ? ['max'] : [],
            };
          });
          // The filter row, and its underline where there is room for it: the
          // underline is the first thing a short terminal gives up.
          const showLine = menuRows >= 16;
          const { tight, room } = fit('', showLine ? 2 : 1);
          const line = filterUnderline(query);
          const tabs = (
            <Text wrap="truncate">
              {query ? <Text color={T.accent}>{' all tabs'}</Text> : SETTING_GROUPS.map((name, i) => (
                <React.Fragment key={name}>
                  {i > 0 ? '   ' : ' '}
                  {name === group
                    ? <Text bold inverse color={T.menu}>{` ${name} `}</Text>
                    : <Text dimColor>{` ${name} `}</Text>}
                </React.Fragment>
              ))}
            </Text>
          );

          // Pending until Apply (v6.1): the row shows the new value and
          // nothing runs. Stepping back to the live value is no change.
          const step = (row, value) => {
            setActiveMenu((m) => {
              const { [row.label]: _old, ...rest } = m.pending || {};
              const live = rows.find((r) => r.label === row.label)?.value;
              const pending = String(value) === String(live) ? rest : { ...rest, [row.label]: value };
              return { ...m, pending, notes: {} };
            });
          };
          const staged = stagedChanges(rows, pending).length;

          return (
            <Panel width={W} head={tabs} tight={tight} keys={settingsKeys({ query, staged })}>
              <Text wrap="truncate">
                <Text color={query ? T.accent : T.muted}>{'  ⌕ '}</Text>
                {query ? <Text>{query}<Text color={T.accent}>▏</Text></Text> : <Text dimColor>filter…</Text>}
              </Text>
              {showLine ? (
                <Text color={line.role === 'accent' ? T.accent : T.muted} wrap="truncate">{`  ${line.text}`}</Text>
              ) : null}
              {shown.length === 0 ? (
                <Text dimColor wrap="truncate">{`   nothing matches “${query}”`}</Text>
              ) : (
                <SettingsList
                  rows={shown}
                  at={activeMenu.at || 0}
                  width={W}
                  room={room}
                  query={query}
                  notes={activeMenu.notes || {}}
                  onMove={(at) => setActiveMenu((m) => ({ ...m, at, notes: {} }))}
                  onQuery={(q) => setActiveMenu((m) => ({ ...m, query: q, at: 0, notes: {} }))}
                  onStep={step}
                  onSelect={async (picked) => {
                    if (!picked.run) return;
                    const back = { ...activeMenu, view: undefined, changes: undefined, notes: {} };

                    // A switch or a ladder with nothing more to say changes in
                    // place: enter is the next value, round to the first.
                    // Subagents took a page and a paragraph to flip.
                    if (picked.control && !OPENS_CHOOSER.has(picked.run)) {
                      const next = stepValue(picked, 1, { skip: picked.skip })
                        ?? picked.control.options.find((o) => !(picked.skip || []).includes(o));
                      if (next != null && next !== picked.value) step(picked, next);
                      return;
                    }

                    // A row that needs a choice hands over to that chooser and
                    // gets the page back afterwards. Closing settings to make a
                    // change — and never returning — is why the summary on the
                    // way out could never fire: there was no way out that still
                    // knew what you had come in with.
                    // A row that edits a value in place opens its editor.
                    // `/name` with no argument only prints the current name,
                    // so running it from here promised a change and delivered
                    // a paragraph — in the transcript, behind the page.
                    if (picked.edits === 'name') {
                      setActiveMenu({
                        type: 'name', draft: agentLoop.agentName || '', returnTo: back,
                      });
                      return;
                    }
                    if (picked.run === '/effort') {
                      setActiveMenu({ type: 'effort', at: pending.Effort, returnTo: back });
                      return;
                    }
                    if (picked.run === '/startup') {
                      setActiveMenu({ type: 'startup', returnTo: back });
                      return;
                    }
                    if (picked.run === '/effort mismatch') {
                      setActiveMenu({ type: 'mismatch-policy', returnTo: back });
                      return;
                    }
                    if (picked.run === '/allowlist') {
                      setActiveMenu({ type: 'allowlist', rules: agentLoop.commandRules, returnTo: back });
                      return;
                    }
                    // Opened here rather than through handleSubmit, which is
                    // what `returnTo` needs: a menu raised by a slash command
                    // has no idea it was reached from the settings page, so
                    // escape closed everything instead of stepping back one.
                    if (picked.run === '/skills') {
                      setActiveMenu({
                        type: 'skills',
                        skills: listSkills(agentLoop.workspace, agentLoop.skillFolders || []),
                        workspace: agentLoop.workspace,
                        returnTo: back,
                      });
                      return;
                    }
                    // Theme and Workspace were the two left going through
                    // handleSubmit, so esc in either closed settings with it
                    // (reported 2026-10-27: "esc should head back to settings
                    // first, then the next esc takes back").
                    if (picked.run === '/theme') {
                      setActiveMenu({ type: 'theme', original: themeName(), at: themeName(), returnTo: back });
                      return;
                    }
                    if (picked.run === '/workspace') {
                      setActiveMenu({ type: 'workspace', current: agentLoop.workspace, returnTo: back });
                      return;
                    }
                    if (picked.run === '/commands') {
                      const days = listCommandDays(agentLoop.workspace);
                      if (days.length === 0) { setActiveMenu(null); setFocus(FOCUS_INPUT); handleSubmit(picked.run); return; }
                      setActiveMenu({ type: 'commands', days, workspace: agentLoop.workspace, returnTo: back });
                      return;
                    }

                    // Anything else is a command in its own right — it answers
                    // in the transcript, which is not something to read through
                    // a menu.
                    setActiveMenu(null);
                    setFocus(FOCUS_INPUT);
                    handleSubmit(picked.run);
                  }}
                />
              )}
            </Panel>
          );
        })()}

        {activeMenu?.type === 'commands' && (() => {
          const { sub, tight, room } = fit(
            'Every shell command run or blocked, kept per day.',
          );
          return (
            <Panel width={W} title="Commands run" sub={sub} tight={tight} keys="↑↓ move · enter open · esc cancel">
              <Choices
                limit={room}
                items={activeMenu.days.map((day) => {
                  const entries = readCommands(activeMenu.workspace, day);
                  const blocked = entries.filter((e) => e.outcome !== 'ran').length;
                  return {
                    label: day,
                    detail: `${String(entries.length).padStart(3)} command${entries.length === 1 ? ' ' : 's'}`
                      + (blocked ? `   ${blocked} not run` : ''),
                    value: day,
                  };
                })}
                onSelect={(item) => {
                  setActiveMenu(null);
                  setFocus(FOCUS_INPUT);
                  handleSubmit(`/commands ${item.value}`);
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'history' && (() => {
          /*
            The disposition is said per row, before the choice is made,
            because "continue" and "replay" are different promises and
            collapsing them is how a picker silently does the second while
            looking like the first. `continue` means the tab is still on that
            Gemini thread and the model genuinely remembers; `replay` means it
            is not, so the next message has to carry a recap.
          */
          const n = activeMenu.sessions.length;
          const { sub, tight, room } = fit('↩ continue in the same tab · ↻ replay with a recap');
          return (
            <Panel width={W} title="Past conversations" status={String(n)} sub={sub} tight={tight}
              keys="↑↓ move · enter reopen · esc cancel">
              <Choices
                limit={room}
                items={activeMenu.sessions.map((session) => ({
                  // Date first because that is how you look for one, then what
                  // it was about — a column of timestamps says nothing about
                  // which conversation you actually want back. `localStamp`
                  // takes a Date; a session record carries `updated`/`started`
                  // as millisecond numbers, hence `stampOf`.
                  label: stampOf(session) || '                ',
                  detail: `${session.resume === 'continue' ? '↩' : '↻'}`
                    + `  ${String(session.turns ?? '?').padStart(3)} turns`
                    + `  ${oneLine(session.title || session.id, 60)}`,
                  value: session.id,
                  key: session.id,
                }))}
                onSelect={(item) => {
                  setActiveMenu(null);
                  setFocus(FOCUS_INPUT);
                  // Back through the command, not into the loop from here: the
                  // slash-command path already owns restoring the transcript.
                  handleSubmit(`/history ${item.value}`);
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'files' && (() => {
          const rows = fileRows(activeMenu.workspace);
          const { sub, tight, room } = fit('Where this project keeps things. Cmd+click a path opens it.');
          return (
            <Panel width={W} title="Files" status={activeMenu.opened} sub={sub} tight={tight}
              keys={`↑↓ move · enter show in ${fileBrowserName()} · esc ${activeMenu.returnTo ? 'back' : 'close'}`}>
              <Choices
                numbered
                limit={room}
                items={rows.map((row) => ({
                  label: row.label,
                  detail: rowDetail(row),
                  link: rowLink(row),
                  value: row.label,
                  key: row.label,
                }))}
                onSelect={(item) => {
                  const row = rows.find((r) => r.label === item.value);
                  if (!row) return;
                  const [cmd, argv] = revealCommand(row);
                  // execFile, not a shell string: paths here have spaces. The
                  // menu stays open, so several can be opened in a row.
                  execFile(cmd, argv, (err) => {
                    setActiveMenu((m) => (m?.type === 'files'
                      ? { ...m, opened: err ? `could not run ${cmd}` : revealedLine(row) } : m));
                  });
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'plans' && (() => {
          const n = activeMenu.plans.length;
          const { sub, tight, room } = fit('Archived plans. Enter opens one in your editor.');
          return (
            <Panel width={W} title="Past plans" status={String(n)} sub={sub} tight={tight}
              keys="↑↓ move · enter open · esc cancel">
              <Choices
                limit={room}
                items={activeMenu.plans.map((plan) => ({
                  // Local parts, not toISOString(): the stamp in the filename was
                  // written in local time, so converting it to UTC to display it
                  // moved every plan by the offset — a plan archived at 14:32
                  // listed itself as 09:02.
                  label: plan.when ? localStamp(plan.when) : '                ',
                  detail: oneLine(plan.title || plan.name, 70),
                  value: plan.path,
                  key: plan.name,
                }))}
                onSelect={(item) => {
                  setActiveMenu(null);
                  setFocus(FOCUS_INPUT);
                  try {
                    exec(`"${agentLoop.editor || 'code'}" "${item.value}" || open "${item.value}" || xdg-open "${item.value}"`);
                  } catch { /* no editor on this machine */ }
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'chrome' && (
          <ChromeProfiles
            agentLoop={agentLoop}
            width={W}
            rows={menuRows}
            onDone={(message) => {
              setActiveMenu(null);
              setFocus(FOCUS_INPUT);
              if (message) setHistory((prev) => [...prev, { role: 'assistant', isLocal: true, content: message }]);
            }}
          />
        )}

        {activeMenu?.type === 'update' && (
          <UpdateMenu
            agentLoop={agentLoop}
            width={W}
            rows={menuRows}
            onDone={(message) => {
              setActiveMenu(null);
              setFocus(FOCUS_INPUT);
              if (message) setHistory((prev) => [...prev, { role: 'assistant', isLocal: true, content: message }]);
            }}
            onPull={() => {
              setActiveMenu(null);
              setFocus(FOCUS_INPUT);
              handleSubmit('/update pull');
            }}
          />
        )}

        {activeMenu?.type === 'mcp' && (() => {
          // v9.0 (`frontend/menus/mcp-view.js`): one list for every integration,
          // read at render so a server that answers redraws its own row.
          const m = activeMenu;
          const list = listIntegrations(agentLoop.mcp);
          if (m.view === 'add') {
            return (
              <McpAdd
                agentLoop={agentLoop}
                width={W}
                rows={menuRows}
                text={m.text}
                onSaved={() => setActiveMenu({ type: 'mcp', view: 'home' })}
                onLeave={() => setActiveMenu({ type: 'mcp', view: 'home' })}
              />
            );
          }
          // After a change the file is the truth: back to the list on a failure.
          const edit = async (change, then = null) => {
            try {
              change();
              await changeMcp(agentLoop, () => agentLoop.mcp.configChanged());
              then?.();
              setActiveMenu((cur) => ({ ...cur, problem: null }));
            } catch (err) {
              setActiveMenu((cur) => ({ ...cur, view: 'home', problem: err.message }));
            }
          };
          const chosen = m.view === 'server' || m.view === 'remove' ? list.rows.find((r) => r.name === m.server) : null;
          if (chosen && m.view === 'remove') {
            return (
              <Panel width={W} title={`Remove ${chosen.name}?`} tight tone="attention" keys="enter choose · esc back">
                <Choices
                  limit={2}
                  items={[{ label: 'Keep it', value: 'keep' }, { label: 'Remove', detail: 'and its saved values', value: 'remove' }]}
                  onSelect={(item) => {
                    if (item.value === 'keep') { setActiveMenu({ ...m, view: 'server' }); return; }
                    setActiveMenu({ ...m, view: 'home', server: null });
                    edit(() => removeServer(chosen.name));
                  }}
                />
              </Panel>
            );
          }
          // A repo's server (v9.6): what would run, as written, before anything does.
          // Asked in full: the command is never the part that gives way.
          if (chosen?.state === 'unapproved') {
            const values = chosen.review.values;
            const lines = fitCommand(chosen.review.target, W, Math.max(1, menuRows - (values ? 6 : 5)));
            return (
              <Panel width={W} title={`Allow ${chosen.name}?`} status={chosen.changed ? 'changed since you allowed it' : 'from this repo\'s .mcp.json'}
                tone="attention" tight keys="enter choose · esc back">
                {lines.map((line, i) => <Text key={i} wrap="truncate"> {line}</Text>)}
                {values ? <Text wrap="truncate" dimColor> with {values}</Text> : null}
                <Choices
                  limit={2}
                  items={ALLOW_ITEMS}
                  onSelect={(item) => {
                    setActiveMenu({ ...m, view: 'home', server: null });
                    if (item.value !== 'yes') return;
                    changeMcp(agentLoop, () => agentLoop.mcp.allow(chosen.name))
                      .then(() => agentLoop.mcp.connect(chosen.name))
                      .catch((err) => setActiveMenu((cur) => ({ ...cur, problem: err.message })));
                  }}
                />
              </Panel>
            );
          }
          if (chosen) {
            const { sub, tight, room } = fit(m.signingIn ? 'Waiting for the browser · choose your site and allow access'
              : m.problem || serverLine(chosen));
            const switchKey = agentLoop.mcp.switchKey(chosen.name);
            const switchOf = (tool) => switchFor(switchKey, tool);
            const items = serverToolItems(chosen, { said: sub.length > 0, switchOf });
            return (
              <Panel width={W} title={chosen.name} status={serverOrigin(chosen)}
                sub={sub} tight={tight} keys={`↑↓ move · ${items.some((i) => i.value) ? 'enter change · ' : ''}esc back`}>
                <Choices
                  limit={room}
                  items={items}
                  onSelect={(item) => {
                    // v9.9: the browser sign-in, from here as from a terminal.
                    if (item.action === 'signin' && !m.signingIn) {
                      setActiveMenu({ ...m, signingIn: true, problem: null });
                      let result = null;
                      changeMcp(agentLoop, async () => { result = await agentLoop.mcp.signIn(chosen.name, { open: openBrowser }); })
                        .catch((err) => { result = { ok: false, error: err.message }; })
                        .finally(() => setActiveMenu((cur) => (cur?.type === 'mcp'
                          ? { ...cur, signingIn: false, problem: result?.ok ? null : `✗ ${result?.error || 'not signed in'}` } : cur)));
                      return;
                    }
                    if (item.action === 'signout') {
                      changeMcp(agentLoop, () => agentLoop.mcp.signOut(chosen.name)).catch(() => {});
                      return;
                    }
                    if (item.action === 'remove') { setActiveMenu({ ...m, view: 'remove' }); return; }
                    if (item.action === 'forget') {
                      setActiveMenu({ ...m, view: 'home', server: null });
                      changeMcp(agentLoop, () => agentLoop.mcp.forget(chosen.name)).catch(() => {});
                      return;
                    }
                    if (item.action === 'toggle') {
                      const on = chosen.state === 'disabled';
                      edit(() => setServerDisabled(chosen.name, !on), on ? () => agentLoop.mcp.connect(chosen.name).catch(() => {}) : null);
                      return;
                    }
                    if (!item.value) return;
                    const tool = item.value === '*' ? null : item.value;
                    setSwitch(switchKey, tool, nextSwitch(switchOf(tool ?? ''), { alwaysAsk: chosen.alwaysAsk }));
                    setActiveMenu((cur) => ({ ...cur })); // settings are not state: draw it again
                  }}
                />
              </Panel>
            );
          }
          const { sub, tight, room } = fit(m.problem || homeLine(list));
          return (
            <Panel width={W} title="MCP" status={shortPath(list.path)}
              sub={sub} tight={tight} keys="↑↓ move · enter open · esc cancel">
              <Choices
                limit={room}
                items={mcpHomeItems(list, { T })}
                onSelect={(item) => {
                  if (item.value === 'add') { setActiveMenu({ ...m, view: 'add', text: '' }); return; }
                  if (!item.value) return;
                  if (item.value === 'reload') {
                    setActiveMenu(null);
                    setFocus(FOCUS_INPUT);
                    handleSubmit('/mcp reload');
                    return;
                  }
                  setActiveMenu({ ...m, view: 'server', server: item.value, problem: null, signingIn: false });
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'logs' && (() => {
          // v5.35 (`frontend/menus/logs-view.js`): every question the log answers, each row
          // with its answer; enter opens the full one. Failures is a second view
          // so the nine flow names are never typed.
          const m = activeMenu;
          const open = (word) => {
            setActiveMenu(null);
            setFocus(FOCUS_INPUT);
            handleSubmit(`/logs ${word}`);
          };
          if (m.view === 'failures') {
            const total = m.data.summary.total;
            const { sub, tight, room } = fit('Pick a flow to see what broke in it.');
            return (
              <Panel width={W} title="Failures" status={`${total} logged`}
                sub={sub} tight={tight} keys="↑↓ move · enter open · esc back">
                <Choices limit={room} items={failureItems(m.data.summary, { T })} onSelect={(item) => open(item.value)} />
              </Panel>
            );
          }
          const { sub, tight, room } = fit('What the log can tell you. Enter opens the full answer.');
          return (
            <Panel width={W} title="Logs" status=".agent/logs"
              sub={sub} tight={tight} keys="↑↓ move · enter open · esc cancel">
              <Choices
                limit={room}
                items={logsHomeItems(m.data, { T })}
                onSelect={(item) => {
                  if (item.value === 'failures' && m.data.summary.total > 0) {
                    setActiveMenu({ ...m, view: 'failures' });
                    return;
                  }
                  open(item.value);
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'doctor' && (() => {
          const m = activeMenu;
          const { report } = m;
          const running = m.job?.state === 'running';
          if (!m.view || m.view === 'home') {
            const tab = m.tab || 'all';
            const items = homeItems(report, { T, tab, job: m.job });
            const counts = tabCounts(report);
            const head = (
              <Text wrap="truncate">
                {' '}<Text bold color={T.menu}>Health</Text>
                {HEALTH_TABS.map(({ id, label }) => (
                  <React.Fragment key={id}>
                    {'  '}
                    {id === tab
                      ? <Text bold inverse color={T.menu}>{` ${label} ${counts[id].count} `}</Text>
                      : <Text color={counts[id].bad ? T.danger : undefined} dimColor={!counts[id].bad}>{` ${label} ${counts[id].count} `}</Text>}
                  </React.Fragment>
                ))}
              </Text>
            );
            // The verdict, or the install running behind the list.
            const { sub, tight, room } = fit(jobLine(m.job) || homeStatus(report));
            const short = titleJobLine(m.job, sub);
            return (
              <Panel width={W} head={short ? <Text wrap="truncate">{` ${short}`}</Text> : head} sub={sub} tight={tight}
                keys={W >= 70 ? '↑↓ move · enter open · tab or ←/→ tabs · esc close' : '↑↓ · enter · tab · esc'}>
                <Choices key={tab} limit={room} items={items} initialIndex={m.at ?? homeCursor(items)}
                  onSelect={(item) => doctorPick(m, item.value, items.indexOf(item))} />
              </Panel>
            );
          }
          if (m.view === 'update-all') {
            const items = updateAllItems(report);
            const { sub, tight, room } = fit(UPDATE_ALL_NOTE);
            return (
              <Panel width={W} title="Update all" status={sub.length ? null : 'a crash is undone, misbehaving is not'} sub={sub} tight={tight} keys="↑↓ move · enter update · esc back">
                <Choices limit={room} items={items} onSelect={(item) => doctorPick(m, item.value)} />
              </Panel>
            );
          }
          if (m.view === 'error') {
            const output = m.job?.output || [];
            const { note, lines } = errorLines(output, { width: W, rows: Math.max(2, menuRows - 5) });
            const { tight } = fit('', lines.length);
            return (
              <Panel width={W} title={`${m.job?.name || 'install'} · what ${m.job?.cmd || 'npm'} said`} status={note}
                tone="danger" tight={tight} keys="esc back">
                {lines.map((line, i) => <Text key={i} wrap="truncate">{` ${line}`}</Text>)}
              </Panel>
            );
          }
          const entry = findEntry(report, m.target);
          if (!entry) return null;
          if (m.view === 'versions') {
            const items = m.versions ? versionItems(m.versions, entry) : [];
            const note = m.versionsError ? `✗ npm could not list them: ${m.versionsError}`
              : !m.versions ? 'Asking npm for every release…'
                : `${items.length} releases, newest first · enter installs one, keeping the range's style (${entry.range})`;
            const { sub, tight, room } = fit(note);
            return (
              <Panel width={W} title={`${entry.name} · versions`} status={`installed ${entry.installed || 'no'}`}
                sub={sub} tight={tight} keys={running ? 'installing… · esc back' : '↑↓ move · enter install · esc back'}>
                {items.length ? (
                  <Choices limit={room} items={items} initialIndex={versionCursor(m.versions, entry)} isActive={!running}
                    onSelect={(item) => doctorPick(m, item.value)} />
                ) : null}
              </Panel>
            );
          }
          const actions = packageActions(entry, { job: m.job });
          const job = m.job && m.job.name === entry.name ? jobLine(m.job) : null;
          // Text first, actions under it; the text gives way before an action does.
          const lines = packageLines(entry, {
            width: W, importers: m.importers || [], registry: report.registry,
            rows: Math.max(1, menuRows - 7 - Math.min(actions.length, 3) - (job ? 1 : 0)),
          });
          const { tight, room } = fit('', lines.length + (job ? 1 : 0) + (actions.length ? 1 : 0));
          const jobColour = m.job?.state === 'done' ? T.success : m.job?.state === 'running' ? T.accent : T.danger;
          return (
            <Panel width={W} title={entry.name} status={entry.kind === 'tool' ? 'tool' : entry.workspace}
              tight={tight} keys={actions.length ? (running ? 'installing… · esc back' : '↑↓ move · enter choose · esc back') : 'esc back'}>
              {lines.map((line, i) => <Text key={i} wrap="truncate">{` ${line}`}</Text>)}
              {job ? <Text color={jobColour} wrap="truncate">{` ${job}`}</Text> : null}
              {actions.length ? <Text> </Text> : null}
              {actions.length ? (
                <Choices limit={room} items={actions} isActive={!running}
                  onSelect={(item) => doctorPick(m, item.value)} />
              ) : null}
            </Panel>
          );
        })()}

        {activeMenu?.type === 'allowlist' && (() => {
          const rules = activeMenu.rules;
          const on = rules.enabled !== false;
          const all = [
            ...rules.allow.map((c) => ({ cmd: c, kind: 'allow' })),
            ...rules.block.map((c) => ({ cmd: c, kind: 'block' })),
          ];

          // ── Confirm ────────────────────────────────────────────────
          // A rule can be a paragraph of shell — a compound git command with
          // quoted echoes in it — and one keypress used to delete it outright
          // with nothing shown but a truncated line. So the full text is spelled
          // out here, before anything is removed — wrapped to the rows there are.
          if (activeMenu.view === 'confirm' && activeMenu.pending) {
            const { cmd, kind } = activeMenu.pending;
            const consequence = kind === 'allow'
              ? 'The agent will ask before running this again.'
              : 'The agent will be allowed to propose this again.';
            const { sub, tight, room } = fit(consequence);
            const lines = wrapLines(cmd, W - 5, Math.max(1, room - 3));
            return (
              <Panel tone="attention" width={W} title="Remove this rule?" sub={sub} tight={tight}
                keys="↑↓ move · enter choose · esc back">
                {lines.map((line, i) => (
                  <Text key={i} color={kind === 'allow' ? T.success : T.danger} wrap="truncate">
                    {i === 0 ? (kind === 'allow' ? ' ✓ ' : ' ✗ ') : '   '}{line}
                  </Text>
                ))}
                <Text> </Text>
                <Choices
                  items={[
                    { label: 'Yes, remove it', value: 'yes', colour: T.danger },
                    { label: 'No, keep it', value: 'no' },
                  ]}
                  onSelect={(item) => {
                    if (item.value === 'no') {
                      setActiveMenu({ ...activeMenu, view: 'list', pending: null });
                      return;
                    }
                    /**
                     * Done here, not handed to the transcript.
                     *
                     * This used to `close()` and submit — and `close()` goes
                     * *back to settings* when that is where the menu was opened
                     * from, so the rule was removed, the confirmation went to a
                     * transcript hidden behind the reopened page, and the list
                     * you were looking at never updated. From settings it was
                     * indistinguishable from nothing happening.
                     *
                     * A settings change belongs in the screen that owns it, the
                     * way the plan/auto and memory toggles already work.
                     */
                    agentLoop.handleSlashCommand('allowlist', ['remove', cmd]);
                    setActiveMenu({
                      ...activeMenu,
                      view: 'list',
                      pending: null,
                      rules: agentLoop.commandRules,
                    });
                  }}
                />
              </Panel>
            );
          }

          // ── The list ───────────────────────────────────────────────
          // One row per rule, truncated to one line. Untruncated, a compound
          // command wraps to four or five rows and a dozen rules push the live
          // frame past the viewport — which is what makes Ink clear and repaint
          // the whole terminal on every render. See ui/constants.js.
          if (activeMenu.view === 'list') {
            const { sub, tight, room } = fit('Pick one to remove it. You will be asked to confirm.');
            return (
              <Panel tone="attention" width={W} title="Command rules" status={String(all.length)}
                sub={sub} tight={tight} keys="↑↓ move · enter remove · esc back">
                <Choices
                  limit={room}
                  items={[
                    ...all.map(({ cmd, kind }) => ({
                      label: `${kind === 'allow' ? '✓' : '✗'}  ${oneLine(cmd, Math.max(20, W - 8))}`,
                      value: cmd,
                      key: `${kind}:${cmd}`,
                      colour: kind === 'allow' ? T.success : T.danger,
                    })),
                    { label: '←  Back', value: '\u0000back', key: 'back' },
                  ]}
                  onSelect={(item) => {
                    if (item.value === '\u0000back') {
                      setActiveMenu({ ...activeMenu, view: null, pending: null });
                      return;
                    }
                    const rule = all.find((r) => r.cmd === item.value);
                    setActiveMenu({ ...activeMenu, view: 'confirm', pending: rule });
                  }}
                />
              </Panel>
            );
          }

          // ── The menu ───────────────────────────────────────────────
          // The rules used to be listed right here, so opening /allowlist to
          // toggle it meant reading every rule you had ever added. What belongs
          // on the first screen is the things you can do.
          // v6.3, owner: "these blocks just look very dull". The counts moved
          // up beside the state, and each action leads with a glyph.
          const items = [
            on
              ? { glyph: '○', glyphTone: 'muted', label: 'Turn off', detail: 'ask before every command', value: 'disable' }
              : { glyph: '●', glyphTone: 'success', label: 'Turn on', detail: 'allowed commands run without asking', value: 'enable' },
            { glyph: '+', glyphTone: 'success', label: 'Allow a command…', value: '\u0000add' },
            { glyph: '−', glyphTone: 'danger', label: 'Block a command…', value: '\u0000block' },
            ...(all.length > 0
              ? [
                { glyph: '≡', glyphTone: 'accent', label: `See the ${all.length} rule${all.length === 1 ? '' : 's'}`, value: '\u0000list' },
                { glyph: '✕', glyphTone: 'danger', label: 'Clear every rule', value: 'clear', colour: T.danger },
              ]
              : []),
          ];
          const counts = `${rules.allow.length} allowed · ${rules.block.length} blocked`;
          const { sub, tight, room } = fit('');

          return (
            <Panel width={W} title="Command rules" {...onOff(on, counts)} sub={sub} tight={tight}
              keys={`↑↓ move · 1–${items.length} or enter choose · esc ${activeMenu.returnTo ? 'back' : 'cancel'}`}>
              <Choices
                numbered
                limit={room}
                items={items}
                onSelect={(item) => {
                  if (item.value === '\u0000list') {
                    setActiveMenu({ ...activeMenu, view: 'list' });
                    return;
                  }
                  /**
                   * The two prefill rows have to close the menu *completely*.
                   *
                   * Returning to `/settings` is right for cancelling, wrong
                   * here. The prompt is hidden while any menu is open
                   * (`promptVisible = … && !activeMenu`), so the prefill landed
                   * in a box nobody could see and the row looked dead. That is
                   * what "add/remove does not work" was: the command itself is
                   * fine, and typing `/allowlist add npm test` has always
                   * worked.
                   */
                  if (item.value === '\u0000add' || item.value === '\u0000block') {
                    setActiveMenu(null);
                    setFocus(FOCUS_INPUT);
                    setInputAtEnd(item.value === '\u0000add' ? '/allowlist add ' : '/allowlist block ');
                    return;
                  }
                  // In place, for the same reason as the removal above: from
                  // settings, closing reopens the page and the answer lands
                  // where it cannot be read.
                  agentLoop.handleSlashCommand('allowlist', [item.value]);
                  setActiveMenu({ ...activeMenu, rules: agentLoop.commandRules });
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'skills' && (() => {
          const skills = activeMenu.skills || [];
          const folders = skillSearchPath(activeMenu.workspace, agentLoop.skillFolders || []);
          const back = () => {
            if (activeMenu.returnTo) { setActiveMenu(activeMenu.returnTo); return true; }
            setActiveMenu(null);
            setFocus(FOCUS_INPUT);
            return false;
          };
          const { sub, tight, room } = fit(
            'Markdown files the agent opens when the task matches.',
          );

          return (
            <Panel width={W} title="Skills"
              status={`${skills.length} across ${folders.length} folder${folders.length === 1 ? '' : 's'}`}
              sub={sub} tight={tight} keys={`↑↓ move · enter open · esc ${activeMenu.returnTo ? 'back' : 'cancel'}`}>
              <Choices
                limit={room}
                items={[
                  ...skills.map((sk) => ({
                    label: oneLine(sk.name, 24),
                    detail: oneLine(sk.description || '(no description)', 60),
                    value: `open:${sk.file}`,
                    key: sk.file,
                  })),
                  { label: 'New skill…', value: 'new', key: '_new' },
                  // The settings row is called "Skill folders" and used to open
                  // a list with no way to reach them, which is what made this
                  // screen feel half-finished.
                  { label: 'Folders searched…', detail: String(folders.length), value: 'folders', key: '_folders' },
                  { label: 'Open the skills folder', value: `open:${skillsDir(activeMenu.workspace)}`, key: '_dir' },
                ]}
                onSelect={(item) => {
                  if (item.value === 'new') {
                    back();
                    setFocus(FOCUS_INPUT);
                    // Hand over a half-written command: the skill needs a name
                    // and the prompt is already the place to type one.
                    setInputAtEnd('/skills new ');
                    return;
                  }
                  if (item.value === 'folders') {
                    setActiveMenu(null);
                    setFocus(FOCUS_INPUT);
                    handleSubmit('/skills dir');
                    return;
                  }
                  back();
                  const target = item.value.slice('open:'.length);
                  try {
                    exec(`"${agentLoop.editor || 'code'}" "${target}" || open "${target}" || xdg-open "${target}"`);
                  } catch (e) { /* no editor on this machine */ }
                }}
              />
            </Panel>
          );
        })()}

        {activeMenu?.type === 'workspace' && (() => {
          // Here and State: two rows besides the list.
          const { sub, tight, room } = fit(
            'The agent restarts there, with that project\'s history.',
            2,
          );
          return (
            <Panel width={W} title="Workspace" sub={sub} tight={tight} keys={`↑↓ move · enter choose · esc ${activeMenu.returnTo ? 'back' : 'cancel'}`}>
              {/* Cut from the left by hand: `truncate-start` cut the label too. */}
              <Text wrap="truncate"><Text dimColor>{' Here   '}</Text>{cutStart(activeMenu.current, W - 9)}</Text>
              <Text wrap="truncate"><Text dimColor>{' State  '}</Text>{cutStart(agentDir(activeMenu.current), W - 9)}</Text>
              <Choices
                limit={room}
                items={[
                  ...listWorkspaceCandidates(activeMenu.current).map((c) => ({
                    // The tick says "current"; the label saying it too was twice.
                    label: c.current ? c.label.replace(/ — current$/, '') : c.label,
                    value: c.path,
                    current: c.current,
                  })),
                  ...(canPickFolder()
                    ? [{ label: 'Browse…', value: '\u0000browse' }]
                    : []),
                  { label: 'Type a path instead…', value: '\u0000type' },
                ]}
                onSelect={async (item) => {
                  setActiveMenu(null);
                  setFocus(FOCUS_INPUT);
                  if (item.value === '\u0000browse') {
                    const chosen = await pickFolder('Choose a project to work on');
                    if (chosen && chosen !== activeMenu.current) handleSubmit(`/workspace ${chosen}`);
                    return;
                  }
                  if (item.value === '\u0000type') {
                    // Hand the user a half-written command rather than a second
                    // prompt of our own: the input line already knows how to edit.
                    setInputAtEnd('/workspace ');
                    return;
                  }
                  if (item.value === activeMenu.current) return;
                  handleSubmit(`/workspace ${item.value}`);
                }}
              />
            </Panel>
          );
        })()}

    </>
  );
}

/**
 * Pending edit approval.
 *
 * Its own `Choices` for the same reason as the rest: an approval that a stray
 * 'y' in typed text could trigger is how edits used to get applied without
 * anyone agreeing to them.
 *
 * It shows the actual change, not just a hunk count — approving an edit you
 * cannot see is not approval. The preview is capped so a large edit cannot push
 * the buttons off screen.
 */
/** Collapsed: enough to see the shape of the change without filling the box. */
const DIFF_ROWS_COLLAPSED = 16;

// What the box draws around the diff is counted in `diffBoxLayout` (diff-preview.js).

export function DiffApproval({
  diffRequest,
  handleDiffResponse,
  setFocus,
  mode = 'plan',
  terminalHeight = 24,
  width = process.stdout.columns || 80,
  // App sizes the box (v9.9.6), so the live turn above gives up the rows it
  // takes; expanded lives there too, because the size depends on it.
  layout = null,
  expanded = false,
  setExpanded = () => {},
}) {
  /**
   * `d` opens the rest of the diff.
   *
   * A letter rather than a chord: `ctrl+e` is already transcript verbosity and
   * is pulled off stdin before Ink sees it, so it would toggle the wrong thing
   * from here. And a third `Choices` row was the other option — rejected,
   * because this list is a safety decision and putting a *view* action in it
   * is how someone approves a write while meaning to look at it.
   *
   * Registered before the early return would be a conditional hook, so the
   * guard is inside the handler.
   */
  useInput((input) => {
    if (!diffRequest) return;
    if (input === 'd' || input === 'D') setExpanded((v) => !v);
  });

  if (!diffRequest) return null;

  // Built from the patch, not from `diffRequest.hunks`.
  //
  // Those hunks are the *tool's* return value, and `edit_file` trims them to an
  // id, a start and a ten-line preview string so the copy that could reach the
  // model stays small. `previewRows` and `summarizeDiff` read `lines`,
  // `oldLines` and `newLines`, which trimmed hunks have never had — so this
  // screen has been drawing `@@ -1,undefined +1,undefined @@`, `+0 / -0` and no
  // diff at all, on the one screen whose entire job is showing you the change
  // before you approve it.
  const hunks = diffRequest.hunks ?? [];
  /**
   * Bounded even when expanded — this box is in Ink's live frame.
   *
   * "Show me the whole diff" is the obvious request and the obvious
   * implementation of it (drop the cap) is the single most reliable way to
   * bring back the full-screen repaint: a frame taller than the viewport makes
   * Ink write `ESC[2J ESC[3J` on every render and the scrollback goes with it.
   * So expanding grows into the room the terminal actually has, and the
   * `… N more lines` row keeps saying what is still hidden.
   */
  const choices = [
    { label: `Approve — write ${(diffRequest.hunks ?? []).length === 1 ? 'it' : 'all of it'} to disk`, value: 'accept' },
    /**
     * The mode switch, offered where the evidence is.
     *
     * The model asks for it in prose — "Ready to exit PLAN MODE?" — which the
     * tool catalog already forbids ("do NOT ask for permission to continue;
     * that is what plan mode and the approval prompts are for") and which
     * spends a whole turn on a question the user cannot answer with a
     * keypress. This is the same question, asked by the thing that actually
     * enforces the mode, at the one moment the user is looking at a change
     * and can judge whether they want to keep seeing them.
     *
     * Not a timed prompt. A countdown suits a notice with a safe default;
     * this decides whether later edits apply unreviewed, and expiring it
     * either picks silently or makes the user race a clock while reading the
     * diff it is about. It would also re-render the live frame once a second
     * for as long as it was up.
     */
    { label: 'Reject — discard the change', value: 'reject' },
    /**
     * Last, and that position is the whole of it.
     *
     * Putting it between Approve and Reject moved Reject down one, so
     * `↓ enter` — which every existing habit and the harness both mean as
     * "reject" — approved the write *and* turned approval off for the rest of
     * the session. The harness caught it as `nope.js WAS written`.
     *
     * A choice that widens permissions never sits between the two people
     * press without looking.
     */
    ...(mode === 'plan' || mode === 'strict'
      ? [{ label: 'Approve, and stop asking — switch to auto mode', value: 'accept-auto' }]
      : []),
  ];

  // Fitted to the terminal (v9.9.6): a box as tall as the screen cleared it.
  const fitted = layout || diffBoxLayout({
    patch: diffRequest.patch, choices: choices.length, reason: Boolean(diffRequest.riskReason),
    expanded, terminalHeight, collapsed: DIFF_ROWS_COLLAPSED,
  });
  const { rows } = fitted;
  const { added, removed } = patchCounts(diffRequest.patch);
  const critical = diffRequest.riskLevel === 'critical';


  const tone = critical ? T.danger : T.attention;
  return (
    // The shared menu look (`frontend/menus/panel.js`): a rule in the risk colour where
    // the round box was, which also gives the diff the box's four columns.
    <Box flexDirection="column" width="100%" flexShrink={1}>
      <Text color={tone} wrap="truncate">{'─'.repeat(Math.max(1, width))}</Text>
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-start">
          {' '}<Text bold color={tone}>{diffRequest.isNewFile ? 'Create' : 'Edit'}</Text>
          <Text bold>{' '}{diffRequest.filePath}</Text>
        </Text>
        <Text>
          <Text color={T.success}>+{added}</Text>
          <Text dimColor> / </Text>
          <Text color={T.danger}>-{removed}</Text>
          {' '}
        </Text>
      </Box>

      {diffRequest.riskReason && fitted.reason ? (
        <Text dimColor wrap="truncate">{' '}{diffRequest.riskReason}</Text>
      ) : null}

      {rows.length > 0 && (
        <Box flexDirection="column" marginY={fitted.margins ? 1 : 0} paddingLeft={1}>
          {/* The gutter earns its width here: this is the screen where you are
              deciding whether to let the change happen. */}
          <DiffRows rows={rows} gutter />
        </Box>
      )}

      {/* No digits: this list is a safety decision. */}
      <Choices
        items={choices}
        onSelect={(item) => {
          handleDiffResponse(item.value);
          setFocus(FOCUS_INPUT);
        }}
      />

      {fitted.hint && (
        <Text dimColor wrap="truncate">
          {expanded
            ? '   d — collapse'
            : '   d — show the rest of the diff'}
        </Text>
      )}
    </Box>
  );
}
