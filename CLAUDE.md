# CLAUDE.md

Guidance for Claude Code when working in this repository. It says **what this is, how to work on
it, and what must not break**. Each area ends with a link to its design file in
[`docs/design/`](docs/design/), which keeps how that part came to be: the reports, the wrong
theories, the measurements. Read the design file before changing the mechanism it describes.
Decisions and removals are in [`docs/history.md`](docs/history.md); the whole of this file as it
was before 2026-11-09 is [`docs/old-claude.md`](docs/old-claude.md): a code comment that cites
CLAUDE.md for a passage not found here means that file.

## What this is

A local coding agent with **no LLM API client**. The Node server sends a prompt over WebSocket to
a Chrome extension, a content script types it into gemini.google.com, scrapes the streamed reply
and sends the text back. Tool calls are parsed out of that text. Every architectural oddity below
follows from that.

npm workspaces: `server/` (brain and terminal UI), `extension/` (MV3 bridge), plus a standalone
`vscode-companion/` (not a workspace).

## Commands

```bash
npm install                       # installs both workspaces from the root
npm run start                     # server with workspace pinned to repo root (../)
npm run dev                       # same, with tsx --watch
cd server && npm start -- --workspace /path/to/project   # run against another project
./setup.sh                        # installs an `agent` / `agent-cli` shim in ~/.local/bin
                                  # (never `npm link` — it needs npm's global prefix)

npm run build --workspace=extension   # esbuild src/background/main.js -> service-worker.js
cd vscode-companion && vsce package --allow-missing-repository --skip-license
                                  # prepublish copies extension/side-panel/ into media/panel/
npm test                          # server, extension and companion suites
node --import ./test/setup-home.js --test <file>   # one server file (run from server/)
```

**Committed builds.** `extension/service-worker.js` is the esbuild bundle of
`extension/src/background/`, and `vscode-companion/*.vsix` is the packaged companion. Chrome and
VS Code load those, not the sources: after editing either source, rebuild and commit the output.
`extension/content-scripts/*.js` are loaded directly and are not bundled. Tests fail when a bundle
or the `.vsix` is stale.

There is no lint script; `package.json` holds `eslintConfig` (eslint:recommended) and `prettier`
(100 columns, single quotes, trailing commas) for editors.

## Tests

- Tests live in `server/test/`, mirroring `server/src/` directory for directory
  (`src/backend/core/workspace/paths.js` → `test/backend/core/workspace/paths.test.js`). A test
  that needs a path into the source tree computes it relative to `src/`, not to itself.
- **The suite runs against a throwaway home.** `test/setup-home.js` is preloaded by `npm test` and
  points `AGENT_CLI_HOME` and `TMPDIR` at temp dirs. Bare `node --test <file>` skips it and writes
  into the real `~/.agent` — always pass `--import ./test/setup-home.js`. A test that sets its own
  home **restores** the previous value on teardown, never `delete`s it. A test workspace is a
  `mkdtemp`, never a literal path like `/tmp`; an unwritable one is a path under a regular file,
  never `/proc/…`. Nothing writes into the repo either: a test that changes prompt files copies
  them to a temp dir first.
- **Expected state: every test passes.** A failure is a real regression.
- **CI** (`.github/workflows/ci.yml`) runs on every push: macOS and Linux, Node 22 and 24, after
  `agent --help` and `agent doctor --offline`. `main` requires the four jobs.
- **Guards worth knowing:** `bundle-fresh.test.js` and `vsix-fresh.test.js` (committed builds),
  `docs-size.test.js` (this file's size cap), `prompt-v1-golden.test.js` (prompt v1 is frozen),
  `toolCatalogDrift()` (registry and catalog agree), `tool-smoke.test.js` (every tool called once
  on its happy path, plus a membership check so a new tool cannot skip it),
  `slash-command-smoke.test.js` (every slash command, bare and with arguments).
- **A passing test can lie.** Give a new check a negative control: break the thing and watch it go
  red. Use real collaborators (`MemoryManager`, `DiffEngine`, …) in a temp workspace, not stubs.
- **Editing by script:** a Python `str.replace(old, new)` with no count replaces every occurrence,
  and a string anchor hits the first match. Assert the match count before writing.

Details: [`docs/design/testing.md`](docs/design/testing.md).

## Verifying anything a person sees: the pty harness

Anything visible on screen is checked by driving the **real CLI under a pty** with a fake
extension answering from a script, so a full turn runs with no browser and no Gemini account. The
harness lives in `.agent/artifacts/harness/`, not in the repo; use it, do not rebuild it.

- `drive.py` forks the CLI under a pty, runs JSON steps (type, key, resize, paste, write a file)
  and counts per step the bytes, `ESC[2J` (full clears), `ESC[3J` and erase-lines. Use its
  `{"screen": file}` (pyte's rendered viewport) for anything about layout; `snap` is the raw
  stream and invents blank rows.
- `fake-extension.js` identifies as `{type:'identify', payload:{clientType:'extension'}}` with a
  `chrome-extension://` origin and logs every prompt it is sent: that log is where prompt sizes
  and "the secret never reached the prompt" come from.
- `tabrig/` runs the real CLI and the real extension in headless Chrome against a Gemini-shaped
  page; `scrape-test.mjs` runs the bridge's scrape against a Gemini-shaped DOM in jsdom.
- **The standard check** for a UI change is "0 clears at 13 and 24 rows" (more sizes when the
  layout depends on width). Count frames only with a driver that waits on output, never on sleeps.
- **The harness has lied at least six times.** Check it before believing a result, positive or
  negative.

Harness safety, every run:
- **Never port 7777** — the real extension dials it and would receive the harness's prompts.
  Always a random port.
- **Live Gemini tests only on account `/u/3`.** `/u/0` and `/u/1` are the owner's own accounts.
- **Nothing installs into a real app.** Anything that can reach one needs an allow-list
  (`AGENT_EDITOR_APPS`, set by `setup-home.js`); real `npm` runs only in a full repo copy.
- MCP runs set `AGENT_MCP_NO_KEYCHAIN=1`. **An empty `AGENT_ATLASSIAN_MCP_URL` means the real
  Atlassian server** — always pass the fixture's URL.
- **Never `npx -y` a real third-party server.**

Details: [`docs/design/testing.md`](docs/design/testing.md).

## Rules that must not break

The short list. Each is explained in its area below.

1. **Never commit or push to `main`.** A branch, a PR into `main`, the owner merges.
2. **Rebuild committed builds** (`service-worker.js`, the `.vsix`) after editing their sources.
3. **Prompt v1 is frozen.** A prompt change goes in v7 as a flag or a feature, never in v1 and
   never as a new version.
4. **A new tool is three edits:** handler in `mcp/tools/`, an entry in `TOOL_DEFINITIONS`
   (`mcp/mcp-server.js`), an entry in `core/prompt/tool-catalog.js`. The description is the
   contract with the model. Add it to `tool-smoke.test.js`.
5. **Anything that writes outside the repo or runs something new asks, through three locks:**
   `requiresApproval` (or the runner) shows a box, `issueApproval` gives a one-use token, and the
   handler refuses without `consumeApproval`. Subagents never get these tools.
6. **Secrets never pass through the model**: not in a prompt, an argument, a result, a log or a
   settings file. They live in the Keychain or a 0600 file; errors are scrubbed.
7. **The live frame never outgrows the terminal.** A row you draw is a row you budget, and a row
   that wraps is two.
8. **No mouse tracking.** New ctrl+ chords go in `HOTKEYS`, never `useKeyBindings`, and never a
   chord another app owns system-wide.
9. **`frontend/` imports `backend/`, never the reverse.**
10. **Nothing the user waits for goes before the first frame** (`startup-order.test.js`).
11. **An undelivered prompt is held, never dropped; a delivered one is never resent** if that
    risks a double answer.
12. **Colour is a role (`T.accent`), never a name.**
13. **This file stays short.** A new feature adds a line or two to its area here; its story goes in
    its design file and `docs/CHANGELOG.md`. `docs-size.test.js` caps this file.

## Layout

```
server/src/
├── index.js          # bin shim: re-spawns main.js under tsx (sources contain JSX)
├── main.js           # arg parsing, migration, component wiring, bootstrap
├── backend/          # README.md says where to look and how to debug
│   ├── core/         # by job: turn/ prompt/ models/ edits/ commands/ policy/
│   │                 #   subagents/ logs/ install/ workspace/
│   ├── bridge/       # websocket-server (the Chrome-extension transport)
│   ├── context/      # token budget: code-minifier, symbol-index, context/memory-manager
│   ├── atlassian/    # Jira: client, config, ADF and wiki markup, `agent atlassian login`
│   ├── mcp/          # mcp-server.js + tools/ + client/ (MCP servers you add)
│   ├── prompts/      # prompt files; prompts/v2/ overrides them for later versions
│   └── storage/  watcher/
└── frontend/         # the terminal UI; README.md says where to look and how to debug
    ├── cli-ui.jsx    # render(): stdin shim, hotkey routing, trailing-Enter split
    ├── App.jsx       # state, effects, layout — everything else is a module
    ├── text.js  theme.js  constants.js   # width and wrapping, colour roles, shared values
    ├── input/        # hotkeys, enter-splitter, paste, file-drop, image-attach, clipboard…
    ├── transcript/   # transcript, markdown, tool-rows, live-layout, status-rows, action-row…
    ├── menus/        # each menu's logic (rows, sizing, actions); drawn by components/
    ├── screen/       # status-bar, intro, welcome, farewell, screen-span
    ├── hooks/        # use-key-bindings, use-hotkeys, use-slash-commands, use-agent-callbacks
    └── components/   # Banner, TranscriptTurn, Menus, InputBar, PromptInput,
                      #   AgentTerminal, QuestionPrompt, SettingsList, Panel
```

Modules are kebab-case; React components keep PascalCase. `core/turn/x.js` and the like in this
file are under `backend/`. `server/src/index.js` does nothing but re-spawn `main.js` under `tsx`,
so plain `node src/main.js` fails. Running the CLI without a TTY fails with Ink's "Raw mode is not
supported": that is the environment, not a bug (`script -q /dev/null <cmd>` gives it a pty).

## Architecture

### Turn lifecycle

`main.js` wires everything and hands off to `frontend/cli-ui.jsx` → `frontend/App.jsx`.

1. `App.jsx` sends input to `AgentLoop.handleUserMessage` (`core/turn/agent-loop.js`).
2. `PromptBuilder.buildPrompt` (`core/prompt/prompt-builder.js`) assembles the prompt.
3. `AgentLoop._sendToGemini` queues it (`extensionQueue`, one prompt in flight per tab) and
   `bridge/websocket-server.js` relays it to the extension.
4. The content script streams `gemini_response_stream`, then `gemini_response`, which resolves
   `AgentLoop.handleGeminiResponse`.
5. `_extractToolCalls` parses JSON tool calls out of the reply text (`_cleanJsonString` is an
   escape-aware scan), and `_executeToolCalls` dispatches through `MCPServer.executeTool`.
6. Results go back through `buildToolResultPrompt` and the loop repeats.

Rounds per turn, not prompt length, are what a turn costs.

### Bridge and reply path

The rules, each with an incident behind it ([`docs/design/bridge.md`](docs/design/bridge.md)):

- **The reconnect alarm is periodic and permanent.** `stopKeepAlive` must not clear it
  (`watchdog-alarm.test.js`).
- **An undelivered prompt is held, not dropped.** `flushPendingInjects` drains when a client
  identifies as an extension (not on socket open); past `INJECT_BUFFER_TTL_MS` it is dropped.
- **Readiness is a handshake, not a sleep** (`waitForBridge`: `ready`, `canType`).
- **In a hidden tab only the page's own timers are throttled**, so the clock lives in the service
  worker (`tick_completion`). A clock fix has as many sites as the clock has callers.
- **Completion:** Gemini's finished row under the newest reply ends the wait; otherwise
  consecutive quiet checks do (`completionConfirms`, cancelled by stop).
- **The model picker cannot kill a turn** (`NON_FATAL_EXTENSION_OPS`; a notice is never fatal).
  `dismissStuckMenu` runs on every inject.
- **Repairs:** the main lane sends once, then reopens the **same** `/app/<id>` in a fresh tab,
  then fails with one line and the chat's link (`bridge/tab-failure.js`). Never a new chat: it
  would answer a question it never saw. Subagents keep `sendWithRepairs`. An unsubmitted prompt
  is resent once, verbatim (`_lastMainPrompt`).
- **Two silent minutes** (`SILENT_REPLY_MS`) resend once, verbatim, in a fresh tab on the same
  chat; a second silence ends the turn.
- **A closed tab ends the turn and says so**, decided by the lane; never reopened and resent.
- **A message the tab never sent is carried** in front of the next one (`carryUndelivered`).
- **Every main prompt carries `threadUrl`**, and the tab is put back on the session's chat before
  typing (`ensureOnChat`); if it will not load there, nothing is typed (`chat_unreachable`).
- **A fresh session starts in a new chat** (`_freshChatOwed`); `--continue`/`--resume` reopen the
  stored thread.
- **One profile gets prompts** (`/chrome`, `profile-binding.js`): bound by a pairing link, never
  a fallback to another profile.
- **A provider error resends the failed prompt** after 3 s then 8 s; a usage limit steps the model
  down instead (`core/turn/reply-recovery.js`).
- **Tool amnesia** ("I cannot access your files"): a new thread re-teaches the whole prompt
  (`_recordThread` → `resetPromptState()`); a denial inside the same thread is repaired with
  `requestToolRedeclaration()`, never `resetPromptState()` (`core/turn/drift-detector.js`).
- **Scraping:** `extractLatestResponse` waits for a *new* block; Gemini's editor takes text only
  through a synthetic paste (`ClipboardEvent('paste')`), never `innerHTML`; a formula is scraped
  once, as its TeX; a Canvas chip is a request to write the file with `create_file`.
- **Traces** record five stages per turn and how the prompt was typed (`/logs speed`).

### Prompt

- **Turn 0 and every Nth turn carry the full system prompt and tool definitions**; other turns
  carry the **tool anchor** (names only). Resending the full prompt every turn trips Gemini's
  filters. `resetPromptState` re-teaches after `/compact`, `/clear` or a thread change.
- **Two versions** (`core/prompt/prompt-versions.js`, `/prompt`): **v1** (original, frozen by
  `prompt-v1-golden.test.js`) and **v7** (current, default for new installs). A version is wording
  only: v7's switches are `flags` (`lookFirst`, `noCanvas`, `modeNote`, `mcpSetup`, …), and
  `FEATURES` (Jira, MCP, memory) are on for both, each silent until set up. v2–v6 read as v7.
  Every reply and `tool-usage.jsonl` row records `promptVersion`; judge a change by `/prompt` and
  `/logs`, not by its size.
- **Prompt files:** `prompts/<name>.md`, overridden by `prompts/v2/<name>.md` for later versions.
- **Tier** (`lite` / `flash` / `pro`) shapes the reasoning instructions. The prompt follows the
  model actually selected in the tab (`_promptConfig`), not the setting.
- **A tool name on every turn is not a trigger.** An unused tool needs a nudge at the moment it is
  relevant (`_turnEvidence`), not another mention.
- **Loop nudges, once per turn:** a reply that promises to look and makes no call is asked to make
  it (`_askToKeepPromise`); a Canvas reply is asked for the file.
- **Warm start** (`/startup warm`) sends turn 0 on connect; it is off by default.

Details: [`docs/design/prompt-and-models.md`](docs/design/prompt-and-models.md).

### Models and effort

- **Effort rungs** low / medium / high / max map to the account's models (`rungForModel`,
  `pickModelFor`, `model-match.test.js`). Max is the model named Argon, else the first after Pro;
  without it, Max is unavailable. A **locked** model (lock icon in the picker) does not exist.
- **The browser differing from the effort is asked about once** (`/effort mismatch ask|follow|switch`),
  never mid-turn; the footer shows `⚠ <model>`. A switch is confirmed by reading the picker back;
  a failed switch or a quota reply steps **down**, never up (`core/models/model-fallback.js`).
- **Thinking level follows effort** (`core/models/thinking.js`), sent with every main prompt, on
  accounts whose picker has levels; an account with none shows no Thinking anywhere.

Details: [`docs/design/prompt-and-models.md`](docs/design/prompt-and-models.md).

### Tools

- One flat `TOOL_DEFINITIONS` array in `mcp/mcp-server.js`, handlers in `mcp/tools/`, and the
  prompt's view in `core/prompt/tool-catalog.js`. Catalog fields decide policy: `mutates`,
  `shell`, `detached`, `dispatch: 'loop'`, `mcp`, `flag` (offered only on prompt versions with that
  flag). Loop-answered tools (`ask_question`, `ask_subagent`, `manage_memory`) are in
  `core/turn/loop-tools.js`, derived from the catalog.
- **Tool-call parsing:** only a fenced block tagged `json`, or an untagged one with a `"name"` key,
  is a call. A block that yields no call stays in the reply.
- **Reads go into the prompt as numbered text.** One that does not fit is cut by whole lines and
  names the missing range (`fitReadResult`). A partial read ends with the headings or definitions
  it did not show. An unranged read of a large file goes to a subagent for a digest when that is
  on (`core/subagents/delegated-read.js`); a large log gets `query_log`'s overview.
- **Edits:** `edit_file` with `oldText`/`newText` or `append`; a miss names the nearest line.
  An `oldText` that ends the file and that `newText` starts with is run as an append.
- **Documents:** PDF, `.docx`, `.pptx` come back as Markdown (`mcp/tools/documents.js`); other
  binaries are refused.
- **`query_log`** reads log exports (NDJSON, JSON, CSV, text, `.gz`) as records
  (`log-records.js`); a time with no zone is UTC.
- **`find_symbol` / `find_references`** (`context/symbol-index.js`): acorn for JavaScript and JSX,
  `ruby-symbols.js` for Ruby, one table for 14 other languages (`pattern-symbols.js`). acorn-jsx
  teaches the parser, not the walker, and acorn-walk ignores `ImportSpecifier` — both bite.
- **`run_command`** shows its last five lines live (`core/commands/output-tail.js`), charged to
  the live budget; every run is in the command log.
- **Project commands** (test, lint, build) are detected from root marker files
  (`core/prompt/project-commands.js`); an `AGENT.md` `Test:` line wins.
- `executeTool` retries transient OS errors and rewrites `errno` codes into instructions.

Details: [`docs/design/tools.md`](docs/design/tools.md).

### Approvals, modes and policy

- **Writes never go straight to disk.** `edit_file` / `create_file` build a `DiffEngine` diff
  (`core/edits/diff-engine.js`) with per-hunk accept, backups, atomic writes and `undo()`.
  `core/edits/diff-approval.js` keeps the model, the screen and the disk told the same thing.
- **Who may run what is `core/policy/tool-policy.js`**: `isBlockedOutright` and
  `requiresApproval`, over the catalog's flags. Never a literal list of tool names in dispatch.
- **Commands** go through `core/commands/risk-classifier.js`; persistent rules are
  `commandRules` (`/allowlist`). `critical` is blocked in every mode; `risky` asks in every mode.
  Anything aimed at Rails production is `critical`.
- **Three modes** (`core/policy/modes.js`), shift+tab cycles them: **plan** (asks for edits,
  except Markdown inside the workspace — never `AGENT.md`, `CLAUDE.md`, `GEMINI.md`), **auto**,
  **strict** (asks for every edit except the agent's own artifacts, decided by resolved location
  under `paths.artifactsDir`, never by extension).
- **External writes** (`jira_issue`, Atlassian's server) ask in every mode, Send / Don't send,
  starting on Don't send, with no "always" (`core/policy/external-approval.js`).
  `requiresApproval`'s **first** statement checks external writes, before mode or risk, and its
  second the MCP switch; source assertions pin both places. A 403 is `HANDED OFF — not done`,
  never retried.
- `DETACHED_TOOLS` makes the read-only exemption ask about `run_background`, whose process
  outlives the turn.

Details: [`docs/design/policy.md`](docs/design/policy.md).

### MCP servers, Jira and Confluence

- **Servers** come from `~/.agent/mcp.json` (Claude Code's shape) and, once allowed per folder
  and per whole entry in `/mcp`, a repo's `.mcp.json` (`mcp/client/repo-approval.js`; any edit
  asks again; it cannot use `${secret:}`). Started on first use, never at launch; children die on
  exit. HTTP is `https`, or `http` to this machine only. Never pass `redirectPolicy: 'follow'`.
- **The model reaches them through `mcp_describe` and `mcp_tool`.** Each tool is ask / auto / block
  (`mcp/client/switches.js`); `alwaysAsk` in `mcp.json` beats it. A result is labelled data.
- **Adding a server:** `/mcp add` (`components/McpAdd.jsx`, `mcp/client/add-server.js`), or the
  model's `mcp_setup` **only when asked** (v7, `core/policy/mcp-setup-approval.js`). The box shows
  the command first; the same name and command again in a session runs unasked; a server needing a
  secret always asks, because the person types it there (`SetupValues`). Saved only if the test
  answered. A side panel cannot take a secret, so it gets a refusal naming `/mcp add`.
- **Secrets** go to the Keychain or a 0600 `mcp-secrets.json`; `mcp.json` holds
  `${secret:<server>/<VAR>}`; a server reads only its own. A text field behind a menu needs its
  own `usePaste`.
- **Jira** (`jira_issue`, `atlassian/`): Cloud uses ADF, Server/DC wiki markup; reads answer in
  Markdown; every other action is a write. The token is set by `agent atlassian login`.
- **Atlassian's MCP server** is built in (`mcp/client/oauth.js`, `atlassian-server.js`), signed in
  by browser OAuth; a connection never opens a browser. The record is stored in the Keychain in
  3,000-character pieces and read back before it is trusted. Reads are a name list
  (`ATLASSIAN_READS`); anything else is a write and asks.

Details: [`docs/design/mcp-and-atlassian.md`](docs/design/mcp-and-atlassian.md).

### Subagents

- **One tool, one switch:** `ask_subagent` with `role: "review" | "research" | "task"`;
  `subagentsEnabled` is on unless `modelConfig.subagents === false`.
- Each subagent runs in **its own tab** on a `sub:<requestId>` lane, so calls really run in
  parallel; a session keeps its tab and sends only what that tab has not seen
  (`core/subagents/subagent-session.js`). A subagent tab's failure is the subagent's, not the
  main turn's.
- Subagents get a restricted tool set: no external writes, no MCP, no `mcp_setup`.
- On `pro`, the review step sends the diff to a `review` subagent (past one file or ~30 lines): a
  reader with no memory of the conversation. A description leads with **when** to use the tool.

Details: [`docs/design/subagents.md`](docs/design/subagents.md).

### Context and memory

- `context/`: `code-minifier` (`minifyJson` always returns a string; tool results are embedded
  compact), `context-manager`, `memory-manager`, `memory-store`, `symbol-index`.
- **Memory is a folder** (`context/memory-store.js`): one fact per file, stamped with author,
  session, time and why; writes are checked against the hash last shown, inside a per-fact lock.
- **No embedding index.** grep → read → grep, plus `find_symbol`.
- **The file watcher holds no descriptor per file** (recursive `fs.watch`); the agent's own writes
  are not announced as external edits (`core/edits/own-writes.js`). Any new long-lived resource
  per file brings back `EBADF` past the open-file limit.

Details: [`docs/design/context-and-memory.md`](docs/design/context-and-memory.md).

### State, sessions and compaction

- **Where `.agent/` is:** `paths.resolveState(workspace)` walks up for an existing `.agent/`, like
  git; the first hit is the **root**, the path down to the workspace is the **scope**
  (`--scope`, or open the repo directly). It never adopts `~/.agent` (it stops at `$HOME`) or a
  temp dir's `.agent`. Every file tool resolves through `paths.resolveToolPath`. The
  prompt's `.agent/artifacts/…` is one literal for every repo; a stray `.agent` holding only
  `artifacts/` and `tmp/` under a real root is skipped and its files moved (`isStrayAgentDir`). The user-facing map
  is [`docs/agent-folder.md`](docs/agent-folder.md); keep it in step with `paths.js`.
- **Workspace paths** are `core/workspace/workspaces.js`; `AgentLoop.setWorkspace` is the one place
  that rewires collaborators (never the session store).
- **Home** is `~/.agent` (`AGENT_CLI_HOME` overrides; the older names are still read). Never
  `~/.gemini`, which belongs to Google's tools.
- **Conversations** are one folder each (`conversations/<id>/`), written to the workspace copy and
  the home copy on every turn and reconciled at start (more turns wins).
- **Resuming restores four things**: transcript, `chatThread`, an `open_thread` to the extension,
  and a recap only when there is no thread. `--resume`/`--continue` go through
  `resumeThreadOnConnect`; the invariant is a reopened thread or a recap, never neither
  (`resume-thread.test.js`).
- **Compaction** (`core/turn/compaction.js`) happens before the next message, never mid-turn, and
  is offered, not forced (Compact now / Continue in this chat). The summary is asked of the current
  chat and handed over once as `<compacted_context>` with the last 3 exchanges.
- **Migrations move, never copy, and run once** (`core/install/migrate*.js`), and are tested from
  their own plan. `/reset` moves state to `~/.agent/trash/`, never deletes.

Details: [`docs/design/state-and-sessions.md`](docs/design/state-and-sessions.md).

### VS Code companion and side panels

- The companion talks through **files** under the state directory (`editor.json`,
  `diagnostics.json`, `chat-queue.jsonl`, `plan-review.json`, `plan-approval.json`), except the chat
  panel, which is the Chrome side panel's own page over the WebSocket.
- The panel **identifies as `editor`**, never `extension`; worker-only message types are listed in
  `WORKER_ONLY_TYPES` (a denylist, checked by `editor-routing.test.js`).
- It finds the agent through `bridge.json` (port, pid, token, 0600). Admission is by Origin **and**
  token; only `chrome-extension://` is admitted on Origin alone.
- `chat-panel-html.js` ports `resolveState` as `agentStateDir`; `state-dir-parity.test.js` keeps them
  equal.
- The panels follow the terminal's design and its colour roles; `panelState()` sends what they show,
  so they keep no copy.

Details: [`docs/design/companion-and-panels.md`](docs/design/companion-and-panels.md).

### Logs

- **Failure log** (`core/logs/error-log.js` → `<ws>/.agent/logs/errors.jsonl`), tagged by flow,
  read by `/logs`. It never throws and collapses repeats within 60 s into a tally. Notices
  (`level: 'notice'`) are counted apart from failures, and shown beside them: **demote, never
  drop**. How loudly something is logged never decides what the bridge does about it, and never
  demote by op name.
- **Command log** (`core/logs/command-log.js` → `logs/commands/<date>.jsonl`): every
  `run_command`, MCP and external write, whether it ran, was blocked or rejected. An audit trail,
  never read into a prompt; `logCommand` never throws.
- **`/doctor`** says what is installed (`core/install/doctor.js`, built-ins only; every package has
  a tier and a why). `doctor.test.js` holds it to the code: `required` is a static import,
  `optional` only a lazy one. A change that breaks the next start is undone (`doctor-guard.js`).

Details: [`docs/design/logs.md`](docs/design/logs.md),
[`docs/design/install-and-update.md`](docs/design/install-and-update.md).

## Terminal UI

The frontend is Ink. Claude Code is the reference design.

- **The live frame must never outgrow the viewport.** When Ink's dynamic output is taller than the
  terminal it clears screen and scrollback on every render. So settled turns go to `<Static>`, only
  the in-flight turn is live, and every live row is charged to `liveBudget` (`live-layout.js`).
  Below 13 rows spacing is shed, never information. Anything unbounded in the live region — a full
  tool result, a long list — brings the flicker back.
- **A row you draw is a row you budget, and a row that wraps is two.** `wrap="truncate"` in the
  live frame is load-bearing. A truncated row loses its right end, so put what must survive on the
  left. Clamp in wrapped rows, not `\n`s.
- **Merging the loop's history into the screen** uses recorded positions (`__loopIndex`,
  `__echo`, `historyOffset` after compaction), never a count. The transcript advances on
  `agent_response` and on every `tool_result`; the live list holds only running calls. Keeping
  `isProcessing` up for a whole turn was 1,228 clears — do not retry it.
- **A fixed-width glyph beside flexible text goes in a `flexShrink={0}` box.**
- **App.jsx is performance-sensitive.** `<Static>`, `staticEpoch` and the streaming path stay in
  it; do not memoize transcript rows (it brought scroll glitches back twice).
- **Input:** Ink never reads the real stdin — `cli-ui.jsx` pipes it so `enter-splitter.js` can
  split a trailing Enter. Hotkeys are pulled from stdin before Ink (`hotkeys.js`), because
  `ink-text-input` types any key it does not know. A retired chord stays in `HOTKEYS` and answers
  where the thing went. Pastes over four lines fold to a marker; drops (bracketed or typed, chunked
  by VS Code) become `[File #n]` / `[Image #n]` tags and never inline the content. A handler reads
  live text (`live`), not a render's props.
- **A local command must not touch a running turn** (`turnInFlight` reads
  `agentLoop.isProcessing`), and an instant one raises no spinner (`SLOW_COMMANDS`,
  `isSlowCommand(command, args)`).
- **Typed prompts during a turn are queued**, drained on the loop's `onIdle`; ↑ on an empty box
  takes one back; `ctrl+x ctrl+s` steers instead. `:stop` empties the queue. The drain waits for the
  loop to be idle **and** no diff prompt or menu to be open.
- **Every menu is a `Panel`** (no borders, `panelRoom` sheds spacing, never a choice). A menu
  opened from `/settings` goes back and says nothing (`applyAndReturn`); a menu that mutates shared
  state needs a fresh `activeMenu` object.
- **Every slash command validates its words** (`COMMAND_OPTIONS`); a setting reply is one line. A
  setting that did not change does not call `resetPromptState()`.
- **Start and first run:** `Intro` then App (`frontend/screen/intro.js`); first-start setup
  (`components/Onboarding.jsx`) runs instead of App, and is decided before `new AgentLoop`
  (`welcome.test.js`). The status bar is laid out in `frontend/screen/status-bar.js` with a fixed
  shedding order.
- **Colour is a role** (`frontend/theme.js`, `theme-tokens.test.js`); palettes are tested to WCAG
  contrast. `NO_COLOR` wins.
- **No mouse tracking.** Scroll, select and copy are the terminal's. `Ctrl+E` toggles verbosity for
  the whole transcript and is the only deliberate full clear.
- **A child spawned while Ink is up must not inherit stderr.**
- **Exit** erases back to the launch line and prints `agent --resume <id>`; ctrl+c is decided in
  `cli-ui` (`exitOnCtrlC: false`).

Details: [`docs/design/terminal-ui.md`](docs/design/terminal-ui.md).

## Gotchas

- `AGENT.md` at the repo root is **workspace context** read into the prompt, not instructions for
  you. It belongs to whatever project the agent is pointed at.
- The agent defaults to `--workspace ../`, so running it here makes it work on its own repo.
- Chat-site DOM selectors break when Gemini changes its page.
- `/update` runs git in `server/`; a path handed back to git there needs `:(top)`.
- Chrome assigns an extension command's shortcut only on first install; reloading leaves it
  unbound.
- `macOS` has no `timeout`; use `perl -e 'alarm N; exec @ARGV'`.

## Branching and PRs

- **Never commit or push to `main`.** Branch from `main` as `vN.M/short-description` (named for
  what it does), open a PR into `main`, and the owner merges. One PR per version, never stacked
  on another open PR.
- A force-push to `main` is a repair that only the owner can ask for.
- Branches are the history: `beta-v1` … `beta-v10`, `fix/bridge-lock-and-cli`, `v1-stable` and
  every `vN.M/…` are kept. Do not delete or squash them.
- A conflict on a PR that should be a clean descendant usually means the sides no longer share
  history: check `git rev-list --left-right --count main...<branch>` before resolving anything.
- The series history (v3 to v9) is in [`docs/design/project.md`](docs/design/project.md) and
  [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

## Product decisions

Choices, not limitations to route around:

- **Gemini Web only.** ChatGPT was removed on 2026-09-19; a second provider is a decision to
  re-open, not a file to un-delete.
- **Purely local:** no hosted backend, no telemetry, no API keys.
- **Two front-ends:** the terminal and the side panel (Chrome and VS Code).
- **One answer per turn:** never drafts or alternatives to pick between.
- **One bridge**, and no second target restored to make a comparison meaningful.
- **An API backend is a fork, not a plan.** If ever built: opt-in, for people who already have a
  key, with the browser bridge staying the default.

Standing decisions, and what was measured and discarded:
[`docs/history.md`](docs/history.md#standing-decisions-rescued-from-handoffmd),
[`docs/history.md`](docs/history.md#measured-and-discarded). Read `docs/history.md` before
re-opening any removed feature or decision.
