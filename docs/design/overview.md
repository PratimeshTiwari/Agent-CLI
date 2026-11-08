# Overview: what it is, commands, layout, turn lifecycle

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## What this is

A local coding agent that has **no LLM API client**. Inference happens by driving a real
browser tab: the Node server sends a prompt over WebSocket to a Chrome extension, a content
script types it into gemini.google.com, scrapes the streamed reply,
and sends the text back. Every architectural oddity below follows from that.

npm workspaces: `server/` (brain + CLI UI), `extension/` (MV3 bridge), plus a standalone
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
npm run test:companion            # the companion's tests (also part of `npm test`)
```

`extension/service-worker.js` is a **committed build artifact**. Editing anything under
`extension/src/background/` without re-running the build ships stale code — Chrome loads the
bundle, not the sources. `extension/content-scripts/*.js` are loaded directly and are not bundled.
Likewise `vscode-companion/*.vsix` is committed and must be repackaged after editing
`vscode-companion/extension.js`.

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
│   ├── mcp/          # mcp-server.js + tools/
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

Imports go one way: `frontend/` uses `backend/`, never the reverse. `core/turn/x.js` and the like in
this file are under `backend/`. Modules are kebab-case; React components keep PascalCase
(`frontend/App.jsx`). Tests live in `server/test/`, mirroring this tree —
`src/backend/core/workspace/paths.js` is tested by `test/backend/core/workspace/paths.test.js`.

## Turn lifecycle

`main.js` wires everything and hands off to `frontend/cli-ui.jsx` → `frontend/App.jsx`.

1. `App.jsx` sends user input to `AgentLoop.handleUserMessage` (`core/turn/agent-loop.js`).
2. `PromptBuilder.buildPrompt` (`core/prompt/prompt-builder.js`) assembles the prompt.
3. `AgentLoop._sendToGemini` pushes onto `extensionQueue` and calls `callbacks.injectPrompt`;
   `bridge/websocket-server.js` relays it to the extension. The queue is serialized by
   `isExtensionBusy` — one browser tab, one in-flight prompt.
4. The content script streams back `gemini_response_stream` (rendered live) then
   `gemini_response`, which resolves `AgentLoop.handleGeminiResponse`.
5. `_extractToolCalls` parses JSON tool calls out of the reply text (there is no structured
   tool-call API — this is text parsing, hence `_cleanJsonString`), then `_executeToolCalls`
   dispatches through `MCPServer.executeTool`.
6. Results are fed back via `buildToolResultPrompt` and the loop repeats.

## From Gotchas

- **`server/src/index.js` is the bin and does nothing but re-spawn `main.js` under `tsx`** —
  the sources contain JSX, so plain `node src/main.js` fails.

- `AGENT.md` at the repo root is *workspace* context read by `prompt-builder.js`, not
  instructions for you. It belongs to whatever project the agent is pointed at. It was the
  unedited stock template until 2026-09-16 — 740 bytes of `<!-- Describe your project here -->`
  going into every turn-0 prompt as this project's context, because `_loadAgentMd` skips a file
  only when its trimmed body is *empty* and a template full of headings is not. It now says what
  this project is; `instruction-sources.js` flags the template state so the next one cannot sit
  there unnoticed.

- The agent defaults to `--workspace ../`, so running it here makes it operate on its own repo.
  That is why this repo kept accumulating agent state.
