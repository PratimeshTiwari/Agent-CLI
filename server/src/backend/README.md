# backend

Everything the agent does except draw the terminal: the turn loop, prompts, tools, the bridge to
the browser, and what is kept on disk. Nothing here imports from `frontend/`.

## What is where

| Folder | Job | Start with |
| --- | --- | --- |
| `core/` | the turn loop and everything it decides, in folders by job (below) | `turn/agent-loop.js` |
| `bridge/` | the WebSocket to the Chrome extension; tab lanes (`extension-lock.js`); the line shown when a tab fails (`tab-failure.js`) | `websocket-server.js` |
| `mcp/` | the tools the model can call | `mcp-server.js` (`TOOL_DEFINITIONS`), `tools/` |
| `prompts/` | prompt text; `v2/` overrides files for the current prompt (v7) | `core/prompt/prompt-loader.js` reads it |
| `context/` | token budget, memory, and code search (`find_symbol`, `find_references`) | `symbol-index.js` |
| `storage/` | conversations, one folder each (`.agent/conversations/<id>/`), written to the repo and to `~/.agent` | `session-store.js` |
| `watcher/` | reports files changed outside the agent | `file-watcher.js` |
| `atlassian/` | Jira by token (`agent atlassian login --token`, Server/DC): client, ADF and wiki markup | `jira-client.js` |
| `mcp/client/` | MCP servers: `~/.agent/mcp.json` and a repo's `.mcp.json` (asked about first), local or HTTP, `/mcp`'s list, `/mcp add`; Atlassian's own server by browser sign-in | `servers.js`, `add-server.js`, `repo-approval.js`, `oauth.js` |

Inside `core/`, one folder per job:

| Folder | Holds | Start with |
| --- | --- | --- |
| `turn/` | the turn loop, recovery from bad replies, compaction, the chat thread, slash commands | `agent-loop.js` |
| `prompt/` | building the prompt, its versions, the tool catalog, `AGENT.md` and skills | `prompt-builder.js` |
| `models/` | effort rungs and which Gemini model each one uses, the thinking level, stepping down on a quota | `effort.js`, `thinking.js` |
| `edits/` | diffs, approval of a diff, backups, the agent's own writes | `diff-engine.js` |
| `commands/` | shell commands: risk, splitting, background tasks, live output | `risk-classifier.js` |
| `policy/` | who may run what: modes, approval, Jira and Confluence writes, MCP tools | `tool-policy.js` |
| `subagents/` | a subagent's tab session, large files read by a subagent | `subagent-session.js` |
| `logs/` | failures, traces, tool usage, the command log | `error-log.js` |
| `install/` | `agent doctor`, updates, restart, migration of old layouts, `/reset` | `doctor.js` |
| `workspace/` | paths, workspaces, settings, the Chrome profile that gets prompts, `.agent/README.md` | `paths.js` |

`workspace/paths.js` is the only place a `.agent/` path is built. Import it; never write the path
by hand.

## A turn, by file

1. `frontend/App.jsx` calls `AgentLoop.handleUserMessage` (`core/turn/agent-loop.js`).
2. `core/prompt/prompt-builder.js` builds the prompt. The full system prompt goes only on a chat's first turn.
3. `_sendToGemini` queues it and `bridge/websocket-server.js` sends it to the extension.
4. The reply streams back. `_extractToolCalls` reads tool calls out of the text, because there is
   no tool-call API.
5. `mcp/mcp-server.js` runs them. Writes become diffs (`core/edits/diff-engine.js`); commands go
   through `core/commands/risk-classifier.js`.
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

Tests live in `server/test/backend/`, folder for folder: `core/workspace/paths.js` is tested by
`test/backend/core/workspace/paths.test.js`. A test about a behaviour rather than one file, such as
`silent-reply.test.js`, sits at `test/backend/core/`.

```bash
npm test                                                          # everything, from the repo root
cd server && node --import ./test/setup-home.js --test test/backend/core/workspace/paths.test.js   # one file
```

Keep `--import ./test/setup-home.js` when running one file: it points the agent's home at a temp
folder, or the test writes into your real `~/.agent`.

## Rules

- **A new tool** needs its handler in `mcp/tools/`, an entry in `TOOL_DEFINITIONS`, and one in
  `core/prompt/tool-catalog.js`. The catalog is what the prompt is built from, and a test fails if the
  two disagree.
- **Prompt v1 is frozen; v7 is current.** A change of wording that alters v1 fails
  `prompt-v1-golden.test.js`: put it in v7. A feature (a tool, a block that appears once something
  is set up) goes in `FEATURES` in `core/prompt/prompt-versions.js`, on both, never in a new version.
- **A write to Jira or Confluence always asks**, in every mode, with no "always": `core/policy/external-approval.js`
  for `jira_issue`, and the `external` check in `tool-policy.js` for Atlassian's MCP server.

The reasons behind all of this are in [`CLAUDE.md`](../../../CLAUDE.md), section Architecture.
