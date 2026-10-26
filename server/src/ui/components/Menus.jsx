import React from 'react';
import { exec } from 'child_process';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { QuestionPrompt } from './QuestionPrompt.jsx';
import { rowsFromPatch } from '../diff-preview.js';
import { DiffRows } from './DiffRows.jsx';
import { oneLine } from '../format.js';
import { helpPage, nextTab, commandRows, HELP_TABS, HELP_CHROME_ROWS } from '../help.js';
import { panelRoom, wrapLines, cutStart, settingTone } from '../panel.js';
import { sliderLayout, stopModel } from '../effort-slider.js';
import { Panel, Choices } from './Panel.jsx';
import { canPickFolder, pickFolder } from '../../core/folder-picker.js';
import { readCommands, listCommandDays } from '../../core/command-log.js';
import { EFFORT_LEVELS, resolveEffort } from '../../core/effort.js';
import { describeSettings, filterSettings, settingsChanged, SETTING_GROUPS, VALUE_MAX } from '../../core/settings.js';
import { listWorkspaceCandidates } from '../../core/workspaces.js';
import { skillsDir, agentDir } from '../../core/paths.js';
import { skillSearchPath, listSkills } from '../../core/skills.js';
import { FOCUS_INPUT } from '../constants.js';
import { MAX_AGENT_NAME } from '../../core/slash-commands.js';
import { T, PALETTES, PALETTE_INFO, setTheme } from '../theme.js';
import { saveUserSettings } from '../../core/user-settings.js';

/**
 * Every modal the agent can raise: questions, command approval, plan review,
 * and the /mode, /model, /config and /github pickers.
 *
 * All of them answer through `Choices` (`Panel.jsx`) rather than raw keypresses — an
 * approval that could be triggered by a stray 'y' in typed text is how edits
 * used to get applied without anyone agreeing to them.
 */
/** Settings rows that are a switch, not a choice. Flipped without leaving the page. */
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
const TOGGLES = new Set(['/plan', '/auto', '/memory on', '/memory off', '/allowlist enable', '/allowlist disable']);

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
   * Run a setting change and land somewhere it can be seen. See TOGGLES above.
   *
   * Back to the page it came from, saying nothing, because the row *is* the
   * confirmation and it re-reads live state. Only when there is no page to go
   * back to does the transcript get the reply — there, nothing is covering it.
   */
  const applyAndReturn = React.useCallback(async (menu, command, args) => {
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
        { role: 'user', content: `/${command}`, isLocal: true },
        { role: 'assistant', content: result.message, isLocal: true }]);
    }
  }, [agentLoop, setActiveMenu, setFocus, setHistory]);

  // Every menu is a `Panel` (`ui/panel.js`): what it can afford at this height.
  const W = terminalWidth;
  const fit = (subtitle, extra = 0) => panelRoom({ rows: menuRows, width: W, subtitle, extra });

  // Every menu's footer promised `esc cancel` and nothing listened: the agent's
  // own key bindings go inert while a modal is up, and `Choices` knows only
  // the arrows and Enter. So escape lands here, and only here — one step back
  // where a menu has steps, closed otherwise.
  useInput((_char, key) => {
    // Tab cycles the settings tabs. Not ←/→, which the filter field needs for
    // its cursor, and not shift+tab alone, which is the global mode toggle
    // everywhere else — inside a menu the agent's own bindings are inert, so
    // tab is free here and nowhere else.
    // ←/→ too (asked for 2026-10-26, as on /help), but only while the filter
    // is empty: with text in it they move its cursor, which is what they mean
    // to someone editing a word.
    const arrows = (key.leftArrow || key.rightArrow) && !activeMenu?.query;
    if ((key.tab || arrows) && activeMenu?.type === 'settings' && activeMenu.view !== 'leaving') {
      const step = key.shift || key.leftArrow ? -1 : 1;
      const at = Math.max(0, SETTING_GROUPS.indexOf(activeMenu.group || SETTING_GROUPS[0]));
      const next = (at + step + SETTING_GROUPS.length) % SETTING_GROUPS.length;
      setActiveMenu({ ...activeMenu, group: SETTING_GROUPS[next], query: '', at: 0 });
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

    if (!key.escape) return;
    // The picker previews by applying each palette as you move; leaving
    // without choosing puts back the one you came in with.
    if (activeMenu?.type === 'theme') {
      setTheme(activeMenu.original);
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
    // On the way out, say what changed — and only then. Settings here apply the
    // moment you pick one, so there is nothing to save; what is worth showing
    // is what you just did and a way to put it back. No dialog when nothing
    // changed: a confirmation you always dismiss teaches people to dismiss
    // confirmations.
    if (activeMenu?.type === 'settings' && activeMenu.view !== 'leaving') {
      const changes = settingsChanged(activeMenu.baseline, describeSettings(agentLoop));
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

        {activeMenu?.type === 'command_approval' && (() => {
          /*
            Every row here is decided by `approvalLayout` (format.js) and drawn
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
          is decided in `ui/destructive.js`, so the typed path and the settings
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
                  if (item.value === 'yes') pending.onConfirm?.();
                  else {
                    setHistory((prev) => [...prev, {
                      role: 'assistant', isLocal: true, timestamp: Date.now(),
                      content: `Cancelled — nothing was changed.`,
                    }]);
                  }
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
          const tick = marked.id === current ? '  ✔ current' : '';
          const { tight } = fit('', 5);
          // A blank row each side of the model line (owner, 2026-10-26: "fix
          // spacing between effort, model name and description, just a bit"),
          // when the panel has the two rows; rule + title + gap + gap + keys
          // + the five slider rows + these two is 12.
          const airy = !tight && menuRows >= 12;
          let used = 0;
          return (
            <Panel width={W} title="Effort" tight={tight}
              keys={`←/→ adjust · 1–${EFFORT_LEVELS.length} or enter confirm · esc cancel`}>
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
                {lead(model.text + tick)}{model.text}
                {tick ? <Text color={T.success}>{tick}</Text> : null}
              </Text>
              {airy ? <Text> </Text> : null}
              <Text dimColor wrap="truncate">{lead(marked.blurb)}{marked.blurb}</Text>
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
          // blurb, gap, two preview rows
          const { sub, tight, room } = fit('', 4);
          return (
            <Panel width={W} title="Theme" sub={sub} tight={tight}
              keys="↑↓ preview · enter keep · esc put it back">
              <Choices
                numbered
                limit={room}
                initialIndex={Math.max(0, names.indexOf(activeMenu.original))}
                items={names.map((n) => ({
                  label: PALETTE_INFO[n].label, value: n, current: n === activeMenu.original,
                }))}
                onHighlight={(item) => {
                  setTheme(item.value);
                  setActiveMenu((m) => ({ ...m, at: item.value }));
                }}
                onSelect={(item) => {
                  setTheme(item.value);
                  const saved = saveUserSettings({ theme: item.value });
                  setActiveMenu(null);
                  setFocus(FOCUS_INPUT);
                  setHistory((prev) => [...prev, {
                    role: 'assistant', isLocal: true,
                    content: `🎨 Theme: **${PALETTE_INFO[item.value].label}**`
                      + (saved ? '' : ' — for this session only; ~/.agent/settings.json could not be written'),
                  }]);
                  if (item.value !== activeMenu.original) resetScreen?.();
                }}
              />
              <Text dimColor wrap="truncate">{'   '}{PALETTE_INFO[activeMenu.at || activeMenu.original]?.blurb}</Text>
              <Text> </Text>
              {/* The preview: one row per role a person actually meets. */}
              <Text wrap="truncate">
                {'   '}<Text color={T.success}>⏺ </Text><Text bold>edit_file</Text>
                <Text color={T.muted}> invoice.rb </Text><Text color={T.success}>+2 </Text><Text color={T.danger}>−1</Text>
                {'   '}<Text color={T.danger}>✗ </Text><Text bold>run_command</Text><Text color={T.danger}> exit 1</Text>
              </Text>
              <Text wrap="truncate">
                {'   '}<Text color={T.accent}>⠋ Running rspec…</Text>
                {'   '}<Text color={T.attention}>⏸ 1 queued</Text>
                {'   '}<Text bold color={T.plan}>plan</Text>{' '}<Text bold color={T.auto}>auto</Text>{' '}<Text bold color={T.strict}>strict</Text>
                {'   '}<Text color={T.link}>/history</Text>
              </Text>
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
          const { sub, tight, room } = fit(
            'A subagent is a second tab of this model that has never seen this conversation — '
              + 'the point of the review role, and the cost of the others: it knows only what it is sent.',
          );

          return (
            <Panel width={W} title="Subagents" status={on ? 'on' : 'off'} sub={sub} tight={tight}
              keys="↑↓ move · 1–2 or enter choose · esc cancel">
              <Choices
                numbered
                limit={room}
                initialIndex={on ? 0 : 1}
                items={[
                  { label: 'On', detail: 'ask_subagent can research, review and run errands', value: 'subagents on', current: on },
                  { label: 'Off', detail: 'one tab, start to finish', value: 'subagents off', current: !on },
                ]}
                onSelect={(item) => run(item.value.split(' '))}
              />
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

          // ── Leaving, with something to report ──────────────────────
          if (activeMenu.view === 'leaving') {
            const changes = activeMenu.changes || [];
            const undoable = changes.filter((c) => c.restore);
            const { sub, tight } = fit('These applied as you picked them — nothing is waiting to be saved.', changes.length + 1);
            return (
              <Panel width={W} title={`${changes.length} setting${changes.length === 1 ? '' : 's'} changed`}
                sub={sub} tight={tight} keys="↑↓ move · enter choose">
                {changes.map((c) => (
                  <Text key={c.label} wrap="truncate">
                    {'   '}<Text>{c.label}</Text>
                    <Text dimColor>{'  '}{c.from}{' → '}</Text>
                    <Text color={T.link}>{c.to}</Text>
                    {c.restore ? null : <Text dimColor>{'  (cannot be undone from here)'}</Text>}
                  </Text>
                ))}
                <Text> </Text>
                <Choices
                  items={[
                    { label: 'Keep them', value: 'keep' },
                    ...(undoable.length
                      ? [{ label: `Put ${undoable.length === changes.length ? 'them' : `${undoable.length} of them`} back`, value: 'undo' }]
                      : []),
                  ]}
                  onSelect={async (item) => {
                    setActiveMenu(null);
                    setFocus(FOCUS_INPUT);
                    if (item.value !== 'undo') return;
                    // One at a time and in order: each runs the command that
                    // owns that setting, which is the same path the user took.
                    for (const change of undoable) {
                      await agentLoop.handleSlashCommand(
                        change.restore.slice(1).split(' ')[0],
                        change.restore.slice(1).split(' ').slice(1),
                      );
                    }
                    setHistory(prev => [...prev, {
                      role: 'assistant', isLocal: true,
                      content: `↩️ Put back: ${undoable.map((c) => `${c.label} → ${c.from}`).join(', ')}`,
                    }]);
                  }}
                />
              </Panel>
            );
          }

          // ── The page ───────────────────────────────────────────────
          // Tabs drawn as `/help` draws them. The list lives in Ink's
          // repainted frame, so it gets the rows the panel can spare and says
          // how much it is not showing.
          const selected = matches[Math.min(activeMenu.at || 0, Math.max(0, matches.length - 1))];
          // the filter row and the hint row
          const { tight, room } = fit('', 2);
          const tabs = (
            <Text wrap="truncate">
              {SETTING_GROUPS.map((name, i) => (
                <React.Fragment key={name}>
                  {i > 0 ? '   ' : ' '}
                  {name === group && !query
                    ? <Text bold inverse color={T.menu}>{` ${name} `}</Text>
                    : <Text dimColor>{` ${name} `}</Text>}
                </React.Fragment>
              ))}
              {query ? <Text color={T.accent}>{'   all tabs'}</Text> : null}
            </Text>
          );

          return (
            <Panel width={W} head={tabs} tight={tight}
              keys={`type to filter · ←/→ tabs · ↑↓ move · enter change · esc ${query ? 'clear' : 'close'}`}>
              <Box>
                <Text color={query ? T.accent : T.muted}>{' ⌕ '}</Text>
                <TextInput
                  value={query}
                  placeholder="filter…"
                  onChange={(value) => setActiveMenu((m) => ({ ...m, query: value, at: 0 }))}
                />
              </Box>
              {matches.length === 0 ? (
                <Text dimColor wrap="truncate">{`   nothing matches “${query}”`}</Text>
              ) : (
                <Choices
                  limit={room}
                  initialIndex={activeMenu.at || 0}
                  items={matches.map((row) => ({
                    // Two columns and nothing else. The hint is only ever
                    // wanted for the row you are looking at, so it sits under
                    // the list where it has the whole line.
                    label: row.label,
                    detail: oneLine(row.value, VALUE_MAX),
                    tone: settingTone(row),
                    value: row.run || '',
                    key: row.label,
                  }))}
                  onHighlight={(item) => {
                    const at = matches.findIndex((r) => r.label === item.key);
                    if (at >= 0 && at !== activeMenu.at) setActiveMenu((m) => ({ ...m, at }));
                  }}
                  onSelect={async (item) => {
                    if (!item.value) return;
                    const back = { ...activeMenu, view: undefined, changes: undefined };

                    // A row that needs a choice hands over to that chooser and
                    // gets the page back afterwards. Closing settings to make a
                    // change — and never returning — is why the summary on the
                    // way out could never fire: there was no way out that still
                    // knew what you had come in with.
                    // A row that edits a value in place opens its editor.
                    // `/name` with no argument only prints the current name,
                    // so running it from here promised a change and delivered
                    // a paragraph — in the transcript, behind the page.
                    const picked = matches.find((r) => r.label === item.key);
                    if (picked?.edits === 'name') {
                      setActiveMenu({
                        type: 'name', draft: agentLoop.agentName || '', returnTo: back,
                      });
                      return;
                    }
                    if (item.value === '/effort') {
                      setActiveMenu({ type: 'effort', returnTo: back });
                      return;
                    }
                    if (item.value === '/subagents') {
                      setActiveMenu({ type: 'config', returnTo: back });
                      return;
                    }
                    if (item.value === '/allowlist') {
                      setActiveMenu({ type: 'allowlist', rules: agentLoop.commandRules, returnTo: back });
                      return;
                    }
                    // Opened here rather than through handleSubmit, which is
                    // what `returnTo` needs: a menu raised by a slash command
                    // has no idea it was reached from the settings page, so
                    // escape closed everything instead of stepping back one.
                    if (item.value === '/skills') {
                      setActiveMenu({
                        type: 'skills',
                        skills: listSkills(agentLoop.workspace, agentLoop.skillFolders || []),
                        workspace: agentLoop.workspace,
                        returnTo: back,
                      });
                      return;
                    }
                    if (item.value === '/commands') {
                      const days = listCommandDays(agentLoop.workspace);
                      if (days.length === 0) { setActiveMenu(null); setFocus(FOCUS_INPUT); handleSubmit(item.value); return; }
                      setActiveMenu({ type: 'commands', days, workspace: agentLoop.workspace, returnTo: back });
                      return;
                    }

                    // A row that is simply a switch flips where it stands.
                    if (TOGGLES.has(item.value)) {
                      await agentLoop.handleSlashCommand(item.value.slice(1).split(' ')[0],
                        item.value.slice(1).split(' ').slice(1));
                      setActiveMenu(back);
                      return;
                    }

                    // Anything else is a command in its own right — it answers
                    // in the transcript, which is not something to read through
                    // a menu.
                    setActiveMenu(null);
                    setFocus(FOCUS_INPUT);
                    handleSubmit(item.value);
                  }}
                />
              )}
              {/*
                `↳` and a matching indent, rather than a blank row between: the
                list is drawn inside Ink's repainted frame, where a row spent on
                spacing is a row the viewport does not have.
              */}
              <Text dimColor wrap="truncate">{selected?.hint ? `   ↳ ${selected.hint}` : ' '}</Text>
            </Panel>
          );
        })()}

        {activeMenu?.type === 'commands' && (() => {
          const { sub, tight, room } = fit(
            'Every shell command, and every one that was blocked. Kept per day, and never read back into a prompt — this is for you, not for the model.',
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
          const { sub, tight, room } = fit('↩ continue — the tab still has that thread · ↻ replay — the model gets a recap first');
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

        {activeMenu?.type === 'plans' && (() => {
          const n = activeMenu.plans.length;
          const { sub, tight, room } = fit('Each one was archived when the next replaced it. Enter opens it in your editor.');
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

        {activeMenu?.type === 'logs' && (() => {
          const total = activeMenu.summary.total;
          const { sub, tight, room } = fit('Pick a flow to see what broke in it.');
          return (
            <Panel width={W} title="Failure log" status={`${total} failure${total === 1 ? '' : 's'}`}
              sub={sub} tight={tight} keys="↑↓ move · enter open · esc cancel">
              <Choices
                limit={room}
                items={[
                  ...activeMenu.summary.byFlow.map((f) => ({
                    label: `${String(f.count).padStart(3)}  ${f.flow}`,
                    detail: f.label,
                    value: f.flow,
                    colour: T.danger,
                  })),
                  // Reachable, and below the failures. These are the expected
                  // states that used to be mixed in with them and outnumbered
                  // them three to one; a reader wants them available and never
                  // first.
                  ...(activeMenu.summary.notices?.count
                    ? [{
                      label: `${String(activeMenu.summary.notices.count).padStart(3)}  notices`,
                      detail: 'Expected states — nothing to act on',
                      value: 'notices',
                    }]
                    : []),
                  { label: '     Clear the log', value: 'clear' },
                ]}
                onSelect={(item) => {
                  setActiveMenu(null);
                  setFocus(FOCUS_INPUT);
                  handleSubmit(`/logs ${item.value}`);
                }}
              />
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
          const items = [
            on
              ? { label: 'Turn off', detail: 'ask before every command', value: 'disable' }
              : { label: 'Turn on', detail: 'let allowed commands run without asking', value: 'enable' },
            { label: 'Allow a command…', value: '\u0000add' },
            { label: 'Block a command…', value: '\u0000block' },
            ...(all.length > 0
              ? [
                { label: 'View rules', detail: `${rules.allow.length} allowed · ${rules.block.length} blocked`, value: '\u0000list' },
                { label: 'Clear every rule', value: 'clear', colour: T.danger },
              ]
              : []),
          ];
          const { sub, tight, room } = fit('Allowed commands run without asking. Blocked ones are refused outright.');

          return (
            <Panel width={W} title="Command rules" status={on ? 'on' : 'off'} sub={sub} tight={tight}
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
            'Markdown files the agent opens when their description matches the task. Only the descriptions sit in the prompt, so each one costs a line.',
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
            'The agent restarts into it. This conversation belongs to the project you are leaving, and so do its memory, config and command rules.',
            2,
          );
          return (
            <Panel width={W} title="Workspace" sub={sub} tight={tight} keys="↑↓ move · enter choose · esc cancel">
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

/**
 * Furniture around the diff rows: the box border, the heading, the risk line,
 * the margin, the choices and the hint. Subtracted so an expanded diff grows
 * into the room that is actually there and no further.
 *
 * Counted from the choices rather than fixed at 12, because plan mode has a
 * third one ("Approve, and stop asking"). A row you draw is a row you budget
 * — a constant that silently stopped matching the rows underneath it is how
 * an expanded diff would push the buttons off the screen it exists to show.
 */
const DIFF_BOX_FURNITURE_BASE = 10;
const diffBoxFurniture = (choices) => DIFF_BOX_FURNITURE_BASE + choices;

export function DiffApproval({
  diffRequest,
  handleDiffResponse,
  setFocus,
  mode = 'plan',
  terminalHeight = 24,
  width = process.stdout.columns || 80,
}) {
  const [expanded, setExpanded] = React.useState(false);

  // Collapsed again for the next file, or this one would open expanded
  // because the previous decision left the flag set.
  const requestKey = diffRequest?.diffId ?? null;
  const lastKey = React.useRef(requestKey);
  if (lastKey.current !== requestKey) {
    lastKey.current = requestKey;
    if (expanded) setExpanded(false);
  }

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

  const maxLines = expanded
    ? Math.max(DIFF_ROWS_COLLAPSED, terminalHeight - diffBoxFurniture(choices.length))
    : DIFF_ROWS_COLLAPSED;
  const rows = rowsFromPatch(diffRequest.patch, { maxLines });
  const hidden = rows.some((r) => r.type === 'more');
  const added = rows.filter((r) => r.type === 'add').length;
  const removed = rows.filter((r) => r.type === 'del').length;
  const critical = diffRequest.riskLevel === 'critical';


  const tone = critical ? T.danger : T.attention;
  return (
    // The shared menu look (`ui/panel.js`): a rule in the risk colour where
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

      {diffRequest.riskReason ? (
        <Text dimColor wrap="truncate">{' '}{diffRequest.riskReason}</Text>
      ) : null}

      {rows.length > 0 && (
        <Box flexDirection="column" marginY={1} paddingLeft={1}>
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

      {(hidden || expanded) && (
        <Text dimColor wrap="truncate">
          {expanded
            ? '   d — collapse'
            : '   d — show the rest of the diff'}
        </Text>
      )}
    </Box>
  );
}
