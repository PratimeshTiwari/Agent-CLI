# The `.agent` folders

The agent keeps everything it writes in two places:

| Folder | What it is |
| --- | --- |
| **`<repo>/.agent/`** | This project's state: its settings, conversations, logs, plans and edit backups. One per project, next to the code, and git-ignored. |
| **`~/.agent/`** | Your own settings, plus a second copy of every project's conversations, so a fresh checkout or a deleted `.agent/` does not lose them. |

Nothing is ever sent anywhere: both are plain files on your machine.

## `<repo>/.agent/`

```
.agent/
├── README.md          this table, short, kept current by the agent; delete its first line to keep your edits
├── config.json        settings for this project
├── memory/            what the agent learned here, one fact per file
├── artifacts/         files written for you to read
│   ├── task.md  implementation_plan.md  walkthrough.md  review.md
│   └── plans/         plans and handovers kept for later
├── conversations/     one folder per conversation (v9.9.2; was sessions/)
│   ├── index.jsonl        the list /history shows
│   ├── current.json       which one is in progress
│   ├── compacted.jsonl    turns that compaction summarised; recall_history searches them
│   └── <id>/              the id `agent --resume` takes, which is also its date
│       ├── conversation.jsonl  every turn
│       ├── chat.json           which Gemini chat it is held in
│       └── plans/              its task list and plans, once it is filed
├── logs/
│   ├── errors.jsonl       failures and notices; /logs reads it
│   ├── traces.jsonl       timings for every reply; /logs speed
│   ├── tool-usage.jsonl   tool calls and rounds per turn; /logs tools
│   └── commands/<date>.jsonl  every shell command, run, blocked or rejected; /commands
├── state/             files other programs read and write
│   ├── bridge.json        port and token, for the VS Code chat panel
│   ├── editor.json  diagnostics.json  chat-queue.jsonl  plan-review.json  plan-approval.json
│   │                      the VS Code companion's channels
├── backups/           a copy of each file before an edit; /undo uses it
└── tmp/               pasted images and over-long command output
```

### What each one answers

| You want to know… | Look in |
| --- | --- |
| what the agent is doing now (its plan, its checklist) | `artifacts/task.md`, `artifacts/implementation_plan.md` |
| what happened in an old conversation | `/history`, or `conversations/<id>/` |
| why something failed | `/logs`, or `logs/errors.jsonl` |
| whether it got slower | `/logs speed` (`logs/traces.jsonl`) |
| what commands it ran on your machine | `/commands`, or `logs/commands/` |
| which settings this project overrides | `config.json`; `/settings` shows them |
| what it remembers about the project | `memory/`; `/memory` |

### What is safe to delete

| Path | Safe? | What you lose |
| --- | --- | --- |
| `tmp/` | yes | old pasted images; a resumed conversation's `[Image #n]` link stops opening |
| `backups/` | yes, between sessions | `/undo` for edits already made |
| `logs/` | yes | `/logs` and `/commands` history |
| `artifacts/plans/` | yes | old plans |
| `conversations/<id>/` | only with the same folder under `~/.agent/workspaces/<repo>-<hash>/conversations/` too | that conversation. Delete just one copy and the other still lists and resumes it. |
| `config.json`, `memory/` | yes, if you mean it | this project's settings and what it learned. A file you add to `memory/` is a fact too. An old `memory.md` is imported, and kept there as a dot file. |
| the whole folder | use `/reset` | `/reset` moves it to `~/.agent/trash/` rather than deleting it |

### Monorepos

The agent looks upward for an existing `.agent/` the way git looks for `.git`. With one at the top
of a monorepo, each repo gets a folder inside it:

```
/base/.agent/              shared: config.json, skills/
/base/.agent/repo-1/       repo-1's own artifacts, conversations, logs, config overrides
/base/.agent/repo-2/
```

A repo inside a monorepo should have no `.agent` of its own, and the agent no longer makes one: a
path like `.agent/artifacts/task.md` goes to `/base/.agent/repo-1/artifacts/`. If an older version
left one holding only `artifacts/` or `tmp/`, the next start moves its files there. If one has
`config.json` or `conversations/` in it, an earlier launch took it for a root and kept that repo's state
in it. The agent cannot tell that from a folder you made on purpose, so it stays. To go back to the
shared folder, move what you want to keep into `/base/.agent/repo-1/` and delete `repo-1/.agent`.

**A folder named after a subdirectory** (for example `.agent/server/` in this repo) means
something ran with that subdirectory as its workspace and filed its state under it. If you did
not do that on purpose, it is clutter.

## `~/.agent/`

```
~/.agent/
├── settings.json          yours, not the project's: theme, name, prompt version, startup, Chrome profile,
│                          the MCP switches, and the Jira site (never its token)
├── atlassian-token.json   the Jira token, readable only by you — only where there is no
│                          macOS Keychain; `agent atlassian logout` deletes it
├── mcp.json               your MCP servers, in the format Claude Code uses (`/mcp add` writes it, or you do)
├── mcp-secrets.json       server tokens, 0600, where there is no Keychain (macOS uses the Keychain)
├── mcp-cache.json         the tools each server last listed, so `/mcp` has something to show
├── AGENT.md               instructions for every project (optional; you write it)
├── recent-workspaces.json what /set-workspace offers
├── workspaces/<name>-<hash>/conversations/   the second copy of each project's conversations
└── trash/                 what /reset (and a cleanup) moved away; delete it when you are sure
```

A few files appear briefly and remove themselves: `pending-reload.json` after `/update`,
`doctor-change.json` while a `/doctor` change is being confirmed, `dep-recovery.json` after a
missing package was installed, and `next-workspace` while switching projects.

Set `AGENT_CLI_HOME` to use another folder instead of `~/.agent` (the tests do this).

## Moving from `sessions/` (v9.9.2)

Before v9.9.2 one conversation was spread over `sessions/history.jsonl`, `session-meta.json`, a line in
`index.jsonl` and a later copy in `sessions/sessions/<id>.jsonl`, with its plans in `<id>-artifacts/`. The
first start of v9.9.2 moves all of it into `conversations/`, in the repo and in the home copy, once. Nothing
is deleted: anything it does not move (a conflict copy such as `history 2.jsonl`, the old meta file) goes to
`~/.agent/trash/<repo>-sessions-<date>/`.

## Cleanup on 2026-10-31

This repo's `.agent/` had grown to 41 MB. It is 9.2 MB now. Everything removed was moved to
`~/.agent/trash/gemini-agent-cleanup-20261031-162800/`, and its `MANIFEST.txt` lists every path
and why it went:

- **`.agent/server/` (4 MB):** a test used the checkout itself as its workspace, so every
  `npm test` since September added to it. Fixed, with a test that stops it coming back.
- **Left over from removed features:** `github-reviews/`, `state/github.json` and
  `logs/agent.log`.
- **Never read:** `data/`, a one-off log export.
- **Sync-conflict copies:** `history 2.jsonl`, `history 3.jsonl` and `bridge 2.json`. See below.
- **Old scratch:** backups from ended sessions, old `tmp/` files and the pty harness's output.
  The harness's scripts stay.
- **Orphaned history copies:** three `~/.agent/workspaces/` folders under names nothing uses any
  more (older naming, and the empty `server` scope).

**Files ending in ` 2`** (`history 2.jsonl`, `bridge 2.json`) are copies made by iCloud Drive or
Finder when two writes collide. The agent never reads them. `~/Documents` syncs to iCloud on many
Macs, and one of these copies, `server/src/backend/context/ruby-symbols 2.js`, was committed to git. A
checkout outside iCloud-synced folders avoids them.
