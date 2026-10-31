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
├── config.json        settings for this project
├── memory.md          what the agent learned here
├── artifacts/         files written for you to read
│   ├── task.md  implementation_plan.md  walkthrough.md  review.md
│   └── plans/         plans and handovers kept for later
├── sessions/          conversations
│   ├── history.jsonl      the conversation you are in
│   ├── session-meta.json  which Gemini chat it belongs to
│   ├── index.jsonl        the list /history shows
│   ├── sessions/          earlier conversations, one file each
│   └── archive.jsonl      turns that compaction summarised; recall_history searches them
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
| what happened in an old conversation | `/history`, or `sessions/sessions/` |
| why something failed | `/logs`, or `logs/errors.jsonl` |
| whether it got slower | `/logs speed` (`logs/traces.jsonl`) |
| what commands it ran on your machine | `/commands`, or `logs/commands/` |
| which settings this project overrides | `config.json`; `/settings` shows them |
| what it remembers about the project | `memory.md`; `/memory` |

### What is safe to delete

| Path | Safe? | What you lose |
| --- | --- | --- |
| `tmp/` | yes | old pasted images; a resumed conversation's `[Image #n]` link stops opening |
| `backups/` | yes, between sessions | `/undo` for edits already made |
| `logs/` | yes | `/logs` and `/commands` history |
| `artifacts/plans/` | yes | old plans |
| `sessions/` | only with `~/.agent/workspaces/<repo>-<hash>/` too | conversations. Delete just one copy and the next start rebuilds it from the other. |
| `config.json`, `memory.md` | yes, if you mean it | this project's settings and what it learned |
| the whole folder | use `/reset` | `/reset` moves it to `~/.agent/trash/` rather than deleting it |

### Monorepos

The agent looks upward for an existing `.agent/` the way git looks for `.git`. With one at the top
of a monorepo, each repo gets a folder inside it:

```
/base/.agent/              shared: config.json, skills/
/base/.agent/repo-1/       repo-1's own artifacts, sessions, logs, config overrides
/base/.agent/repo-2/
```

**A folder named after a subdirectory** (for example `.agent/server/` in this repo) means
something ran with that subdirectory as its workspace and filed its state under it. If you did
not do that on purpose, it is clutter.

## `~/.agent/`

```
~/.agent/
├── settings.json          yours, not the project's: theme, name, prompt version, startup
├── AGENT.md               instructions for every project (optional; you write it)
├── recent-workspaces.json what /set-workspace offers
├── workspaces/<name>-<hash>/   the second copy of each project's conversations
├── trash/                 what /reset (and a cleanup) moved away; delete it when you are sure
└── backups/
```

A few files appear briefly and remove themselves: `pending-reload.json` after `/update`,
`doctor-change.json` while a `/doctor` change is being confirmed, `dep-recovery.json` after a
missing package was installed, and `next-workspace` while switching projects.

Set `AGENT_CLI_HOME` to use another folder instead of `~/.agent` (the tests do this).

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
Macs, and one of these copies, `server/src/context/ruby-symbols 2.js`, was committed to git. A
checkout outside iCloud-synced folders avoids them.
