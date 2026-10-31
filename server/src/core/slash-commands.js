/**
 * The slash commands, and what each one does to the loop.
 *
 * Lifted out of `AgentLoop` unchanged. That class was 1,910 lines and did five
 * jobs — dispatching tool calls, driving the bridge, running subagents, holding
 * the config, and this. A switch with sixteen cases is the one of those with no
 * relationship to the others: it reads state, writes state, and returns a string
 * for the transcript.
 *
 * It takes the loop rather than being a method on it, which is the point. The
 * dependency now reads in the signature instead of being seventeen implicit
 * `this.` references, and the file can be understood — and tested — without
 * constructing an agent, a bridge and a browser.
 *
 * `AgentLoop.handleSlashCommand` still exists and still forwards here: this is a
 * move, not a change of interface, and every caller in the UI is untouched.
 */

import fs from 'fs';
import path from 'path';
import * as paths from './paths.js';
import { EFFORT_LEVELS, resolveEffort, foldEffort } from './effort.js';
import { logError } from './error-log.js';
import { saveUserSettings } from './user-settings.js';
import { planModelSwitch, browserModelPin, pickModelFor } from './model-match.js';
import { MISMATCH_POLICIES, mismatchPolicy } from './model-fallback.js';
import { PROMPT_VERSIONS, PROMPT_VERSION_IDS, DEFAULT_PROMPT_VERSION, isPromptVersion } from './prompt-versions.js';
import { summariseToolUsage } from './tool-usage.js';

/**
 * How long a name the banner can take.
 *
 * Exported because the settings screen now edits the name in place and has to
 * refuse the same lengths this does — and `applyAndReturn` drops the handler's
 * message on the way back to the page, so a rejection made here alone would be
 * a keystroke that silently did nothing. One number, both readers.
 */
export const MAX_AGENT_NAME = 20;

/**
 * Run one slash command.
 *
 * @param {import('./agent-loop.js').AgentLoop} loop
 * @param {string} command - the name, without the leading slash
 * @param {string[]} args
 * @returns {Promise<{message: string}>} what to put in the transcript
 */
/**
 * The commands this module handles.
 *
 * Exported because the UI has to know which ones to forward, and it used to
 * know by way of a **hand-written array** — a fourth list in a project that had
 * already been bitten three times by lists that have to agree with something
 * else. `/name` was added to the switch below and not to that array, so it
 * answered "No such command" while being fully implemented, which is the same
 * shape as a tool that runs and is never named in the prompt.
 *
 * `slash-commands.test.js` checks this against the `case` labels in the switch,
 * so adding one and forgetting the other fails the build rather than the user.
 */
export const AGENT_COMMANDS = new Set([
  'plan', 'strict', 'auto', 'diff', 'memory', 'mode', 'config', 'subagents', 'name', 'clear', 'context', 'new',
  'compact', 'undo', 'agent-dir', 'model', 'reasoning', 'effort', 'allowlist',
  'workspace', 'startup', 'prompt',
]);

/**
 * `/prompt`'s answer with no argument: which version, what each one is, and how
 * they compare so far — rounds per turn from `tool-usage.jsonl`, the number
 * that says whether a prompt costs round trips.
 */
/**
 * One row per prompt version with how much it has been used here — what the
 * `/prompt` menu lists and the text report prints, from one place.
 *
 * @returns {Array<{id: string, hint: string, summary: string, use: string, current: boolean}>}
 */
export function promptVersionRows(loop) {
  const current = loop.promptVersion || DEFAULT_PROMPT_VERSION;
  let versions = [];
  try { versions = summariseToolUsage(loop.workspace).versions || []; } catch { /* nothing recorded */ }
  const byId = new Map(versions.map((v) => [v.version, v]));
  return PROMPT_VERSION_IDS.map((id) => {
    const v = byId.get(id);
    const use = !v ? 'not used yet'
      : `${v.turns} turn${v.turns === 1 ? '' : 's'}`
        + (v.rounds ? ` · rounds median ${v.rounds.median}, p90 ${v.rounds.p90}` : '');
    const { hint, summary } = PROMPT_VERSIONS[id];
    return {
      id, hint, summary, use, current: id === current,
      turns: v?.turns || 0, median: v?.rounds?.median ?? null, p90: v?.rounds?.p90 ?? null,
    };
  });
}

export function promptVersionReport(loop) {
  const current = loop.promptVersion || DEFAULT_PROMPT_VERSION;
  const width = Math.max(...PROMPT_VERSION_IDS.map((id) => id.length));
  const rows = promptVersionRows(loop).map((r) =>
    `${r.current ? '❯' : ' '} ${r.id.padEnd(width)}  ${r.summary} · ${r.use}`);
  const other = PROMPT_VERSION_IDS.find((id) => id !== current);
  return `Prompt **${current}**\n\n\`\`\`\n${rows.join('\n')}\n\`\`\`\n`
    + `\`/prompt ${other}\` to switch · the chat is sent the new prompt with your next message`;
}

/**
 * The local commands that are worth a spinner.
 *
 * Every local command used to get one. `handleSubmit` set `isProcessing(true)`
 * and `'Thinking...'` for anything starting with `/`, and each handler ends by
 * setting it false — so an instant command drew a `Thinking…` row and erased it
 * milliseconds later, having in between committed its own output to `<Static>`.
 * The live row is stranded above the static write and becomes permanent
 * scrollback: reported from use as a `Thinking… (0s · ↑ 29.4k tokens · esc to
 * stop)` sitting above `❯ /image` forever, one per command, frozen at 0s.
 * Above, because it was drawn before the rows it now sits on top of.
 *
 * `/compact` asks the model for a summary, so it waits on a browser round trip.
 * `/new` fires `startNewChat` without awaiting it, and the rest are arithmetic
 * on state already in memory.
 *
 * A set beside the commands rather than a literal at the call site, for the
 * same reason `MUTATING_TOOLS` is: the literal is what drifts.
 */
export const SLOW_COMMANDS = new Set(['compact']);

/**
 * Whether *this invocation* is worth a spinner.
 *
 * A set could only answer for a whole command, and `/update` is two commands
 * wearing one name. Bare `/update` runs `checkForUpdate`, which is
 * `git fetch origin` — measured at **1,086 ms** on a warm connection and
 * bounded by `FETCH_TIMEOUT_MS` at **10 s** on a cold one. `/update done` reads
 * a file and answers instantly.
 *
 * Reported from use as *"/update seems glitched out, its loading is a bit late
 * and no loading animation"*, which is exactly what a second to ten seconds of
 * nothing looks like after the input box has already cleared.
 *
 * `use-slash-commands.js` used to say a spinner was "not available, because
 * `SLOW_COMMANDS` is keyed on the first word and `/update` on its own answers
 * instantly". The second half of that was never true — it was measured only
 * after the report — and keying on the first word is the part this fixes. The
 * committed announcement row before `npm install` stays either way: it survives
 * in scrollback, where a spinner cannot.
 *
 * @param {string} command - the word after the slash, lower-cased
 * @param {string[]} [args]
 */
/**
 * What each command accepts after its name, where that is a fixed set (v6.24).
 *
 * `/update ayz` ran the update check, and twelve other commands answered a
 * wrong word exactly as if it were not there — `/subagents zzz` printed the
 * status, which reads like a confirmation. A wrong word now stops the command
 * and lists the forms, each with what it does (owner: "mention the available
 * options with the command written"). `[]` means the command takes nothing.
 * A command absent here takes free text (a path, a name, a search) or checks
 * its own words already (`/effort`, `/logs`, `/theme`, `/prompt`, `/doctor`).
 */
export const COMMAND_OPTIONS = {
  update: [['', 'check for a newer version'], ['pull', 'pull it and install'], ['done', 'clear the reload notice']],
  plan: [['', 'switch to plan mode'], ['show', 'preview the current plan']],
  copy: [['', 'copy the last reply'], ['code', 'copy its last code block']],
  reset: [['', 'move this repo\'s agent state to the trash'], ['--keep-settings', 'keep config.json and memory.md']],
  startup: [['', 'say which it is'], ['warm', 'send the setup prompt when Chrome connects'], ['cold', 'send it with your first message']],
  memory: [['', 'list what is remembered'], ['on', 'remember facts'], ['off', 'stop'], ['forget <n>', 'drop fact n']],
  allowlist: [['', 'open the picker'], ['add <command>', 'auto-approve it'], ['block <command>', 'never run it'],
    ['remove <command>', 'drop a rule'], ['clear', 'drop every rule'], ['enable', 'use the rules'], ['disable', 'ignore them']],
  subagents: [['', 'say whether they are on'], ['on', 'parallel tabs for research and review'], ['off', 'one tab only'],
    ['large-files <subagent|direct>', 'who reads a large file']],
  context: [], auto: [], strict: [], clear: [], settings: [], shell: [], plans: [], undo: [], diff: [],
  new: [], restart: [], exit: [],
};

/** Words a command also takes that its list does not advertise. */
const OPTION_ALIASES = {
  update: ['now'],
  plan: ['preview'],
  allowlist: ['allow'],
  subagents: ['none', 'no', 'false', 'solo', 'yes', 'true', 'gemini', 'duo', 'subagent', 'reviewer', 'large'],
};

/**
 * The reply for a word a command does not take, or null when the args are fine.
 * Keyed on the first word only: `allowlist add <command>` carries free text after it.
 */
export function invalidOption(command, args = []) {
  const spec = COMMAND_OPTIONS[command];
  const word = String(args[0] || '').toLowerCase();
  if (!spec || !word) return null;
  const known = new Set([...spec.map(([form]) => form.split(' ')[0]).filter(Boolean), ...(OPTION_ALIASES[command] || [])]);
  if (command === 'reset' && args.every((a) => a === '--keep-settings')) return null;
  if (known.has(word)) return null;
  const typed = `\`/${command} ${args.join(' ')}\``;
  if (spec.length === 0) return `${typed} — \`/${command}\` takes no options.`;
  const width = Math.max(...spec.map(([form]) => `/${command}${form ? ` ${form}` : ''}`.length));
  const rows = spec.map(([form, what]) => {
    const cmd = `/${command}${form ? ` ${form}` : ''}`;
    return `  \`${cmd}\`${' '.repeat(width - cmd.length)}  ${what}`;
  });
  return [`${typed} — no option \`${args[0]}\`. It takes:`, ...rows].join('\n');
}

export function isSlowCommand(command, args = []) {
  if (SLOW_COMMANDS.has(command)) return true;
  // Every form but `done` reaches the network: bare reports, `pull`/`now` also
  // merge and may `npm install`.
  // A word it does not take is answered at once (`invalidOption`), so only
  // the forms that reach the network wait.
  if (command === 'update') return ['', 'pull', 'now'].includes((args[0] || '').toLowerCase());
  // `fix` runs `npm install` and `report` asks the registry (`npm outdated`,
  // ~1s); the menu opens on what is on disk and fills the registry in behind.
  if (command === 'doctor' || command === 'health') return ['fix', 'report'].includes((args[0] || '').toLowerCase());
  return false;
}

/**
 * A setting changed, said the one way every command says it (owner,
 * 2026-10-26: "just say effort changed to this … subagent on -> off or already
 * off"). `⚙` marks a row this program wrote, the change is the whole message,
 * and anything after `·` is only what the status bar does not already show.
 */
export function changed(setting, from, to, note = '') {
  const what = String(from) === String(to) ? `already **${to}**` : `**${from}** → **${to}**`;
  return `⚙ ${setting}  ${what}${note ? ` · ${note}` : ''}`;
}

export async function handleSlashCommand(loop, command, args) {
  switch (command) {
    case 'plan': {
      const from = loop.mode;
      loop.mode = 'plan';
      return { message: changed('mode', from, 'plan', 'edits and commands ask first; Markdown in the repo does not') };
    }

    /*
     * The last edit's diff, whatever happened to it. An edit row says
     * `invoice.rb · +3 −1`; the change itself had scrolled away with the
     * prompt, and `ctrl+e` expands the whole transcript to find one row.
     */
    case 'diff': {
      const last = loop.diffEngine?.lastDiff;
      if (!last) return { message: 'No edit yet this session.' };
      const lines = String(last.patch || '').split('\n').filter((l) => !/^(Index:|={3,})/.test(l));
      const MAX = 120;
      const shown = lines.length > MAX ? [...lines.slice(0, MAX), `… ${lines.length - MAX} more lines`] : lines;
      const state = { accepted: 'written', rejected: 'rejected — not written', proposed: 'waiting for approval' }[last.status] || last.status;
      return { message: `**${last.filePath}** — ${state}\n\n\`\`\`diff\n${shown.join('\n')}\n\`\`\`` };
    }

    case 'strict': {
      const from = loop.mode;
      loop.mode = 'strict';
      return { message: changed('mode', from, 'strict', 'every edit, Markdown included, asks first') };
    }

    case 'auto': {
      const from = loop.mode;
      loop.mode = 'auto';
      return { message: changed('mode', from, 'auto', 'safe edits apply without asking') };
    }

    // `/memory` used to *toggle* memory, so typing it to look at something
    // switched it off. It shows what is remembered now; on/off is a word you
    // have to say, and it sticks across restarts because it lives in config.
    case 'memory': {
      const action = (args?.[0] || '').toLowerCase();

      if (action === 'on' || action === 'off') {
        const from = loop.memoryManager.isMemoryEnabled() ? 'on' : 'off';
        loop.memoryManager.memoryEnabled = action === 'on';
        loop._saveConfig();
        if (from !== action) loop.promptBuilder?.resetPromptState?.();
        return { message: changed('memory', from, action) };
      }

      if (action === 'forget') {
        const which = args?.[1];
        if (!which) return { message: 'Usage: `/memory forget <number>` — the numbers are the ones `/memory` shows.' };
        const ok = loop.memoryManager.removeMemory(which);
        loop.promptBuilder?.resetPromptState?.();
        return { message: ok ? `Forgot #${which}.` : `Nothing at #${which}.` };
      }

      const facts = loop.memoryManager.getAllMemories();
      const where = paths.memoryPath(loop.workspace);
      if (facts.length === 0) {
        return { message: `Nothing remembered yet · facts land in \`${where}\`` };
      }
      return {
        message: `**Memory**  ${facts.length} fact${facts.length === 1 ? '' : 's'}`
          + `${loop.memoryManager.isMemoryEnabled() ? '' : ' · off, not recalled'}\n\n`
          + facts.map((f, i) => `${i + 1}. ${f}`).join('\n')
          + `\n\n_\`${where}\` · \`/memory forget <n>\` · \`/memory off\`_`,
      };
    }

    /**
     * Topology is derived from whether a reviewer is set, so there is one
     * place to change it and no way for the two to disagree.
     *
     * There is one model now. `main` survives as a concept because everything
     * downstream reads `mainModel`, but it has nothing to switch to, so the
     * command is really an on/off for the reviewer. `reviewer gemini` used to
     * be refused outright — a same-model review was both pointless and unsafe,
     * because the extension raced two requests for one tab. Tab identity fixed
     * the second, and the first was always narrower than it sounded: the
     * reviewer's value is that it has not seen the conversation, not that it
     * has different weights.
     */
    /**
     * One toggle. There is one model, so "who reviews" stopped being a
     * question — what is left is whether this session can fan work out to
     * parallel tabs of itself at all.
     *
     * `reviewer <model>` and the single/duo topology it stood for are gone;
     * `_loadConfig` folds an old config into this.
     */
    /**
     * How a session starts (v5.27). `warm` sends the setup prompt when Chrome
     * connects and after `/new`; `cold` sends it with the first message. Per
     * person, in `~/.agent/settings.json`. Turning it on in a chat that has
     * not been taught yet warms that chat now.
     */
    case 'startup': {
      const asked = String(args?.[0] || '').toLowerCase();
      const was = loop.startupMode === 'warm' ? 'warm' : 'cold';
      if (asked !== 'warm' && asked !== 'cold') {
        return {
          message: `Startup is **${was}** · \`/startup ${was === 'warm' ? 'cold' : 'warm'}\` to change it`
            + ' — warm sends the setup prompt when Chrome connects, so your first message goes alone',
        };
      }
      const saved = saveUserSettings({ startupMode: asked });
      loop.startupMode = asked;
      let note = asked === 'warm' ? 'from the next start and every /new' : 'the setup goes with your first message';
      if (asked === 'warm' && was !== 'warm' && !loop.promptBuilder?.hasSeenSystemPrompt && !loop.isProcessing) {
        loop.warmUp?.();
        note = 'sending the setup prompt now';
      }
      if (!saved) note += ' · this session only, settings.json could not be written';
      return { message: changed('startup', was, asked, note) };
    }

    /**
     * The prompt version (v5.32): v1 is frozen, a newer one is opt-in, and every
     * reply records which it answered so the two can be compared. Per person.
     */
    case 'prompt': {
      const asked = String(args?.[0] || '').toLowerCase();
      if (!asked) return { message: promptVersionReport(loop) };
      if (!isPromptVersion(asked)) {
        return { message: `No prompt version **${asked}** · there is ${PROMPT_VERSION_IDS.join(', ')}` };
      }
      const r = loop.setPromptVersion(asked);
      let note = r.changed ? 'the chat is sent this prompt with your next message' : '';
      if (!r.saved) note = [note, 'this session only, settings.json could not be written'].filter(Boolean).join(' · ');
      return { message: changed('prompt', r.from, r.to, note) };
    }

    case 'mode':
    case 'config':
    case 'subagents': {
      const word = String(args?.[0] || '').toLowerCase();
      const value = String(args?.[1] ?? '').toLowerCase();
      const OFF = ['off', 'none', 'no', 'false', 'solo'];
      const ON = ['on', 'yes', 'true', 'gemini', 'duo'];

      // `/subagents off` as well as `/subagents subagents off` (the old `/config`
      // form): the noun is the only
      // thing this command has, so requiring it is ceremony.
      const asked = ['subagents', 'subagent', 'reviewer'].includes(word) ? value : word;

      // v6.16: who reads a large file. `subagent` sends an unranged read of a
      // file over 1,200 lines or 80 KB to a research tab and hands the main
      // chat a digest; `direct` pages it into the main chat as before.
      if (word === 'large-files' || word === 'large') {
        const was = loop.modelConfig.largeFiles === 'direct' ? 'direct' : 'subagent';
        const to = ['direct', 'read', 'off'].includes(value) ? 'direct'
          : ['subagent', 'sub', 'on'].includes(value) ? 'subagent' : null;
        if (!to) {
          return {
            message: `Large files are read **${was === 'direct' ? 'directly' : 'by a subagent'}** · `
              + `\`/subagents large-files ${was === 'direct' ? 'subagent' : 'direct'}\` to change it`,
          };
        }
        loop.modelConfig.largeFiles = to;
        loop._saveConfig();
        return {
          message: changed('large files', was, to,
            to === 'subagent' && !loop.subagentsEnabled ? 'subagents are off, so files are read directly' : ''),
        };
      }

      const was = loop.subagentsEnabled ? 'on' : 'off';
      if (OFF.includes(asked) || ON.includes(asked)) {
        const to = OFF.includes(asked) ? 'off' : 'on';
        loop.modelConfig.subagents = to === 'on';
        loop._saveConfig();
        // The tool list in the prompt changes only when the setting does.
        if (to !== was) loop.promptBuilder.resetPromptState();
        return { message: changed('subagents', was, to) };
      }

      // Both older names still work, and say once what the command is called now.
      // `/config` only ever toggled subagents, and its description had claimed
      // more since the second provider was removed.
      const renamed = command === 'subagents' ? ''
        : `_(\`/${command}\` is now \`/subagents\` — it is the one thing it sets.)_\n\n`;
      return {
        message: `${renamed}Subagents are **${was}** · \`/subagents ${was === 'on' ? 'off' : 'on'}\` to change it`,
      };
    }

    /**
     * Name the agent, which until now could only be done by editing a file.
     *
     * `config.agentName` has always been read — the banner uses it — and
     * *nothing has ever written it* except a migration from a layout that no
     * longer exists. So on a fresh clone there was no file to edit and no
     * command to run, and the only way to discover the feature was to find the
     * key in someone else's config.
     */
    case 'name': {
      const wanted = args.join(' ').trim();
      const current = loop.agentName;
      if (!wanted) {
        return {
          message: current
            ? `The agent is called **${current}** · \`/name <text>\` to change it`
            : 'No name set — the banner reads "Agent CLI" · `/name <text>` to give it one',
        };
      }

      // Drawn as a figlet wordmark, so a long one is a wall of ASCII.
      if (wanted.length > MAX_AGENT_NAME) {
        return { message: `! "${wanted}" is too long for the banner — ${MAX_AGENT_NAME} characters or fewer.` };
      }

      const clearing = wanted.toLowerCase() === 'default' || wanted.toLowerCase() === 'reset';
      loop.agentName = clearing ? '' : wanted;
      loop._saveConfig();
      return { message: changed('name', current || 'Agent CLI', clearing ? 'Agent CLI' : wanted, 'restart to see it in the banner') };
    }

    /**
     * Start a new conversation — from either front-end.
     *
     * It lived in the CLI's slash-command hook, so the side panel sending
     * `/new` was told "No such command". The same shape as `/name` answering
     * that while fully implemented, and `/workspace <path>` silently ignoring
     * its argument: a command implemented in the UI layer is invisible to every
     * other surface.
     *
     * The substance is here; each front-end still clears its own view, because
     * that is the one part that genuinely differs.
     *
     * It **files** the old conversation rather than destroying it — `/new`
     * means "start another", not "lose that one" — and takes the artifacts
     * with it. Leaving `task.md` behind is what put a finished checklist under
     * the first prompt of the next task.
     */
    case 'new': {
      const filed = loop.sessionStore.rollover();
      loop.sessionStore.clear();
      loop.conversationHistory = [];
      loop.promptBuilder.resetPromptState();
      loop.contextChars = 0;
      // The last chat's warm-up says nothing about this one (v7.9): the screen
      // shows "Ready" until the first message, and that is now this chat's.
      loop.warmState = null;
      // A fresh browser thread too, or the model keeps the old conversation's
      // memory while everything else has moved on. `startNewChat` clears
      // `chatThread` itself and keeps the outgoing id as `previousThread` —
      // clearing it here first threw that away before it could be recorded.
      // Warm start covers /new too: teach the fresh chat once it exists.
      loop.startNewChat?.()?.then?.((ok) => {
        if (ok && loop.startupMode === 'warm') loop.warmUp?.();
      });
      // Name it. "The previous one is kept" is only useful if you can say
      // which one, and the id is the thing `--resume` takes.
      return {
        message: filed
          ? `New chat · \`agent --resume ${filed}\` brings the last one back`
          : 'New chat',
        reset: true,
      };
    }

    /**
     * `/clear` clears the CLI's record. `/new` starts a fresh conversation.
     * Different commands, different jobs, and this one deliberately leaves the
     * browser tab alone — the model still remembers.
     *
     * Which is why it must not zero `contextChars`. That counter is
     * "everything ever typed into the browser tab" (`AgentLoop.contextTokens`),
     * and the tab still holds it, so zeroing it made the status bar, `/context`
     * and the auto-compaction threshold all describe a thread that does not
     * exist. The bar reading 40% straight after a clear is not a glitch: it is
     * the useful half of what just happened.
     */
    case 'clear':
      loop.conversationHistory = [];
      loop.sessionStore.clear();
      loop.promptBuilder.resetPromptState();
      // `reset` so every front-end drops the transcript it is showing. Without
      // it the panel kept displaying a conversation the agent had forgotten.
      /*
       * Say which half went.
       *
       * "Conversation history cleared" reads as *all of it*, and it is not:
       * the browser tab still holds every turn, so the model remembers a
       * conversation the CLI has forgotten. Reported as confusing, and it is
       * also the only thing that explains why the context bar does not drop to
       * zero here — which is correct, and looks like a bug without this line.
       */
      return {
        message: 'Window cleared · the Gemini tab still has the chat — `/new` starts a fresh one',
        reset: true,
      };

    // `/context` reports what is in the window. Registering folders of .md
    // files here was a second way to give the model standing instructions;
    // AGENT.md is the only one now, so only the report is left.
    case 'context':
      return await loop._getContextInfo();

    case 'compact': {
      const focus = args?.join(' ') || '';
      return await loop._compactHistory(focus);
    }

    case 'undo': {
      const result = loop.diffEngine.undo();
      return result;
    }

    // Read-only. The workspace decides where state, sessions, memory and the
    // command allowlist live, and `setWorkspace` rebound four collaborators
    // but not the session store (deliberately), the memory manager, or the
    // config — so after a switch the agent recalled the new project's memory
    // while writing facts into the old one's file, and the old project's
    // allowlist stayed armed. A restart rebinds everything; nothing else does.
    // `/workspace` is handled in the UI layer now: it opens one screen whose
    // heading is this report, and `/workspace <path>` restarts into that path.
    // Only `/agent-dir` still lands here, and only to answer a different
    // question — where the agent's *own source* is.
    case 'agent-dir': {
      return {
        message: `Workspace  \`${loop.workspace}\`\n`
          + `State      \`${paths.agentDir(loop.workspace)}\`\n`
          + `Source     \`${loop.agentSourceDir}\`\n\n`
          + '`/workspace <path>` to work somewhere else',
      };
    }

    // One ladder replaces /model and /reasoning. They were two knobs whose
    // nine combinations had five meanings — see core/effort.js.
    case 'model':
    case 'reasoning':
    case 'effort': {
      const renamed = command !== 'effort'
        ? `_(\`/${command}\` is now \`/effort\` — one setting instead of two.)_\n\n`
        : '';
      const wanted = args?.[0]?.toLowerCase();

      /*
       * `foldEffort`, not `isEffort`: the rungs were renamed on 2026-09-26 and
       * `/effort pro` is in the owner's fingers, in this repo's own docs, and
       * in every transcript before today. Rejecting it as "not an effort
       * level" would be technically correct and useless — and the rejection
       * path prints the ladder, so the old word would look like a typo rather
       * than a rename. Folded words select the rung they always meant.
       */
      /*
       * What happens when the browser is on another model (v5.28,
       * `core/model-fallback.js`): ask before the message, follow the browser
       * (v5.26's behaviour), or switch the browser every time.
       */
      if (wanted === 'mismatch') {
        const policy = args?.[1]?.toLowerCase();
        const was = mismatchPolicy(loop.modelConfig);
        if (!MISMATCH_POLICIES.includes(policy)) {
          return { message: `On a mismatch: **${was}** · \`/effort mismatch ${MISMATCH_POLICIES.join('|')}\`` };
        }
        loop.modelConfig.onMismatch = policy;
        loop._saveConfig();
        return {
          message: changed('on mismatch', was, policy, {
            ask: 'the next message asks first when the browser differs',
            follow: 'the prompt follows the browser, without asking',
            switch: 'the browser is switched before each message',
          }[policy]),
        };
      }

      if (wanted && foldEffort(wanted)) {
        const chosen = resolveEffort(wanted);
        // Choosing a rung ends a step-down: the user is asking for this one again.
        loop.effortFallback = null;
        const before = resolveEffort(loop.modelConfig.effort);

        /*
         * Max is a rung only where there is a model for it. Most accounts have
         * Pro and no Argon, and there `/effort max` says so and changes nothing
         * — the owner's rule is that it never lands on Pro in silence, and a
         * setting of Max on a Pro tab would be exactly that with a different
         * label on the status bar. An unread picker cannot answer either way,
         * so it is asked and the setting waits rather than guessing.
         */
        if (chosen.id === 'max' && before.id !== 'max') {
          const offered = (loop.modelOptions || []).filter((m) => m && m.label);
          if (!pickModelFor('max', offered, browserModelPin(loop.modelConfig, 'max'))) {
            if (!offered.length) loop.requestModelOptions?.(true);
            return {
              message: `${renamed}⚙ effort  stays **${before.name}** · `
                + (offered.length
                  ? 'Argon is not available on this account'
                  : 'the tab has not said which models it has yet — try `/effort max` again in a moment'),
            };
          }
        }
        loop.modelConfig.effort = chosen.id;
        loop._saveConfig();
        // No `resetPromptState()` here any more. The prompt follows the tab
        // (`AgentLoop._promptConfig`), which re-teaches the thread when the
        // tier the tab answers to actually moves — and only then. Resetting
        // here re-sent the full prompt for a High → Medium change on a tab
        // that stayed on Flash, where the model reads the same prompt after.

        // Switch the browser too, rather than asking the user to.
        //
        // Every rung has always named the tab it expects, and the only thing
        // that happened was a hint — so a prompt written for Pro was routinely
        // typed into a Flash tab, which CLAUDE.md names as the worst case: the
        // long prompt goes to the model that handles long prompts worst.
        //
        // `planModelSwitch` matches against what the picker is *actually*
        // offering, because the names move and the list differs by plan. If the
        // browser has not been asked yet, it is asked now and the hint stands
        // for this one time.
        /*
         * One row, because that is what the change is.
         *
         * This used to answer with four lines — the rung's label, its blurb,
         * the browser line, and an italic paragraph explaining that the picker
         * gets read back. Reported as confusing: picking from the menu pushes
         * only the answer, so a four-line blurb appeared in the transcript with
         * nothing above saying where it came from.
         *
         * So the row *is* the record: what it was, what it is, and what the
         * browser is being asked to do. The blurbs still exist — bare `/effort`
         * lists every rung with one — they just are not the confirmation.
         *
         * `⚙` is phase 4.2's marker for "this program said it", scoped to this
         * one call site rather than all 67.
         */
        const plan = planModelSwitch(
          chosen.id, loop.modelOptions || [], browserModelPin(loop.modelConfig, chosen.id),
        );

        // "pinned" is said out loud because a pin and a lucky intent match look
        // identical in the result, and only one of them is something you chose.
        const pinned = plan.pinned ? ' _(pinned)_' : '';

        let browser;
        if (plan.action === 'switch') {
          loop.switchModelTo(plan.model.label);
          browser = `switching to **${plan.model.label}**${pinned}`;
        } else if (plan.action === 'none') {
          browser = `tab already on **${plan.model.label}**${pinned}`;
        } else {
          loop._pendingEffortSwitch = chosen.id;
          loop.requestModelOptions?.(true);
          /*
           * The one branch that cannot confirm anything: there is no model list
           * to match against, so say so and offer the key that shows the tab.
           *
           * Past tense deliberately. This row goes into `<Static>` the moment
           * the command runs and is never repainted, so "asking the browser"
           * read as live status for the rest of the session — reported from use
           * with a screenshot of it sitting above a stale picker. It is a record
           * of an attempt; the follow-up comes from `requestModelOptions`'s
           * watchdog, which now says something when nothing comes back.
           */
          browser = `asked the browser for **${chosen.browser}** · \`ctrl+b\` shows the tab`;
        }

        // A pin naming something this plan does not offer is the single way
        // this feature can fail quietly, so it is the one thing always said.
        if (plan.pinMissed) browser += ` · ⚠ ${plan.pinMissed}`;

        /*
         * No second line about the cost. It said the next message resends the
         * full prompt into this chat, which is true, and the owner asked for
         * the reply to be the change and nothing else (2026-10-26, with a
         * screenshot: "we don't have to make it so verbose, just say effort
         * changed to this, model is set"). The tab's answer follows as its own
         * row — `✓ tab on …`, or the warning when the switch did not land.
         */
        const change = before.id === chosen.id
          ? `already **${chosen.name}**`
          : `**${before.name}** → **${chosen.name}**`;

        return { message: `${renamed}⚙ effort  ${change} · ${browser}` };
      }

      const now = resolveEffort(loop.modelConfig.effort);
      /*
       * A word that is not a rung has to be *rejected*, not ignored.
       *
       * Falling through to the status display is what this did, so `/effort
       * deeep` printed "Effort: Standard" and the ladder — which reads exactly
       * like a confirmation. The typo is the likeliest way to get here, and the
       * one case where silence is worst: you believe the setting changed, and
       * every later turn goes out on the old rung.
       */
      const rejected = wanted && !foldEffort(wanted)
        ? `⚠ \`${wanted}\` is not an effort level — nothing changed.\n\n`
        : '';
      return {
        message: `${renamed}${rejected}Effort is **${now.name}** · tab **${now.browser}** · `
          + (loop.effortFallback ? `stepped down to **${resolveEffort(loop.effortFallback.got).name}** (${loop.effortFallback.reason}) · ` : '')
          + `\`/effort ${EFFORT_LEVELS.map((e) => e.id).join('|')}\``,
      };
    }

    case 'allowlist': {
      const action = args?.[0]?.toLowerCase();
      const rest = args?.slice(1).join(' ').trim();
      const rules = loop.commandRules;

      // `add` was missing entirely: rules could only ever appear by answering
      // "Allow Always" on a prompt, so there was no way to pre-approve a
      // command you already knew you wanted.
      if ((action === 'add' || action === 'allow') && rest) {
        if (!rules.allow.includes(rest)) rules.allow.push(rest);
        rules.block = rules.block.filter((c) => c !== rest);
        loop._saveConfig();
        return { message: `⚙ allowlist  allowed \`${rest}\`` };
      }
      if (action === 'block' && rest) {
        if (!rules.block.includes(rest)) rules.block.push(rest);
        rules.allow = rules.allow.filter((c) => c !== rest);
        loop._saveConfig();
        return { message: `⚙ allowlist  blocked \`${rest}\`` };
      }
      if (action === 'remove' && rest) {
        const had = rules.allow.includes(rest) || rules.block.includes(rest);
        rules.allow = rules.allow.filter((c) => c !== rest);
        rules.block = rules.block.filter((c) => c !== rest);
        loop._saveConfig();
        return { message: had ? `⚙ allowlist  removed \`${rest}\`` : `Not a rule: \`${rest}\`` };
      }
      if (action === 'clear') {
        const n = rules.allow.length + rules.block.length;
        rules.allow = [];
        rules.block = [];
        loop._saveConfig();
        return { message: `⚙ allowlist  cleared ${n} rule${n === 1 ? '' : 's'}` };
      }
      if (action === 'enable' || action === 'disable') {
        const from = rules.enabled !== false ? 'on' : 'off';
        rules.enabled = action === 'enable';
        loop._saveConfig();
        return {
          message: changed('command rules', from, rules.enabled ? 'on' : 'off',
            rules.enabled ? 'allowed commands run without asking' : 'every command asks'),
        };
      }

      // Counts, not contents. A rule can be a whole compound shell command,
      // and printing every one of them turned "what is this command?" into a
      // page of git incantations. The picker is where you read and remove them.
      return {
        message: `Command rules are **${rules.enabled !== false ? 'on' : 'off'}** · `
          + `${rules.allow.length} allowed, ${rules.block.length} blocked · \`/allowlist\` opens the picker`,
      };
    }

    default:
      return { message: `Unknown command: /${command}. Available: /plan, /auto, /clear, /context, /compact, /undo, /workspace, /agent-dir, /model, /allowlist, /github` };
  }
}
