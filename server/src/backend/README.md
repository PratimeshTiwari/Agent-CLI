# backend

Everything the agent does except draw the terminal: the turn loop, prompts, tools, the bridge to
the browser, and what is kept on disk. Nothing here imports from `frontend/`.

## What is where

| Folder | Job | Start with |
| --- | --- | --- |
| `core/` | the turn loop and everything it decides | `agent-loop.js`, `prompt-builder.js` |
| `bridge/` | the WebSocket to the Chrome extension, one tab lane per request | `websocket-server.js` |
| `mcp/` | the tools the model can call | `mcp-server.js` (`TOOL_DEFINITIONS`), `tools/` |
| `prompts/` | prompt text; `v2/` overrides files for later prompt versions | `prompt-loader.js` reads it |
| `context/` | token budget, memory, and code search (`find_symbol`, `find_references`) | `symbol-index.js` |
| `storage/` | conversation history, written to the repo and to `~/.agent` | `session-store.js` |
| `watcher/` | reports files changed outside the agent | `file-watcher.js` |
| `atlassian/` | Jira: client, sign-in, ADF and wiki markup | `jira-client.js` |

Inside `core/`, by job:

- **The turn:** `agent-loop.js`, `turn-runner.js`, `loop-tools.js`, `reply-recovery.js`, `drift-detector.js`, `compaction.js`
- **Prompts:** `prompt-builder.js`, `prompt-versions.js`, `prompt-loader.js`, `tool-catalog.js`
- **Models and effort:** `effort.js`, `model-match.js`, `model-fallback.js`
- **Edits and commands:** `diff-engine.js`, `diff-approval.js`, `risk-classifier.js`, `tool-policy.js`, `modes.js`, `external-approval.js`
- **Subagents:** `subagent-session.js`, `delegated-read.js`
- **Logs:** `error-log.js`, `trace-log.js`, `tool-usage.js`, `command-log.js`
- **Install and health:** `doctor.js`, `doctor-guard.js`, `dep-recovery.js`, `update.js`, `restart.js`
- **Paths:** `paths.js` is the only place a `.agent/` path is built. Import it; never write the path by hand.

## A turn, by file

1. `frontend/App.jsx` calls `AgentLoop.handleUserMessage` (`core/agent-loop.js`).
2. `core/prompt-builder.js` builds the prompt. The full system prompt goes only on a chat's first turn.
3. `_sendToGemini` queues it and `bridge/websocket-server.js` sends it to the extension.
4. The reply streams back. `_extractToolCalls` reads tool calls out of the text, because there is
   no tool-call API.
5. `mcp/mcp-server.js` runs them. Writes become diffs (`core/diff-engine.js`); commands go
   through `core/risk-classifier.js`.
6. The results become the next prompt, and the loop repeats until a reply has no tool call.

## Debugging

| You see | Look at |
| --- | --- |
| something failed | `/logs`, or `.agent/logs/errors.jsonl`. Each row names its flow (`bridge`, `extension`, `agent`, `tool`…) and `op` |
| a send to the tab failed | `/logs extension`; `lastInjectError` carries the page's reason |
| a turn is slow | `/logs speed`: each stage of a turn, from `.agent/logs/traces.jsonl` |
| the model calls the wrong tools, or too many rounds | `/logs tools` (`.agent/logs/tool-usage.jsonl`) |
| a command ran, or was blocked | `/commands` (`.agent/logs/commands/<date>.jsonl`) |
| the prompt itself | `/context` for what feeds it; `/prompt` for the version and what it adds |
| a package or tool is missing | `agent doctor` from the shell, `/doctor` inside |

A failure that is expected (no tab yet at connect, a user's stop) is written as a **notice**, not
a failure; `/logs notices` lists them. Decide by "should someone act on this", never by op name.

## Tests

Tests live in `server/test/backend/`, folder for folder: `core/paths.js` is tested by
`test/backend/core/paths.test.js`.

```bash
npm test                                                          # everything, from the repo root
cd server && node --import ./test/setup-home.js --test test/backend/core/paths.test.js   # one file
```

Keep `--import ./test/setup-home.js` when running one file: it points the agent's home at a temp
folder, or the test writes into your real `~/.agent`.

## Rules

- **A new tool** needs its handler in `mcp/tools/`, an entry in `TOOL_DEFINITIONS`, and one in
  `core/tool-catalog.js`. The catalog is what the prompt is built from, and a test fails if the
  two disagree.
- **Prompt v1 is frozen.** A change that alters it fails `prompt-v1-golden.test.js`; put it in a
  new version in `core/prompt-versions.js`.
- **A write to Jira always asks**, in every mode, through `core/external-approval.js`.

The reasons behind all of this are in [`CLAUDE.md`](../../../CLAUDE.md), section Architecture.
