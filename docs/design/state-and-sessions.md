# State, sessions, resume and compaction

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Workspace

`core/workspace/workspaces.js` owns path handling for the workspace: `resolveWorkspaceInput` (`~`
expansion, relative paths, quotes), `validateWorkspace` (exists / is a directory / readable) and
`listWorkspaceCandidates` for the `/set-workspace` picker. `AgentLoop.setWorkspace` is the one
place that rewires the collaborators that hold a copy of the path — `/workspace` and
`/agent-dir` each used to carry their own list and had already drifted. SessionStore is
deliberately *not* rebound: doing so would write the current conversation into another
project's history.

## Where `.agent/` actually is

The user-facing map of both folders, and what is safe to delete, is
[`docs/agent-folder.md`](../agent-folder.md). Keep it in step with `paths.js`.

`workspace` used to mean two things: where state lives, and what the agent works on. In a
monorepo those come apart, so `paths.resolveState(workspace)` walks *up* looking for an
existing `.agent/`, the way git finds `.git`. The first hit is the **root**; the path from it
down to the workspace is the **scope**.

```
/base-repo/.agent/             root — shared by every repo
├── skills/  config.json                            inherited
├── repo-1/   artifacts/ state/ conversations/ logs/  this repo only
│             config.json (overrides)
└── repo-2/ …
/base-repo/AGENT.md            instructions for every repo under it
/base-repo/repo-1/             the code, with no .agent of its own
/base-repo/repo-1/AGENT.md     instructions for this repo — nearest wins
```

Nothing found — the ordinary single-repo case — and the root is `<workspace>/.agent` with an
empty scope, byte-identical to the old behaviour. Opening `/base-repo` and opening
`/base-repo/repo-1` land on the same state, because both walks end at the same root;
`workspaceSlug` is keyed on the resolved state dir for exactly that reason, so siblings don't
collide on one history file.

Scope is **explicit, never inferred from which files the agent touches**, and **chosen at
launch**: `--scope repo-1`, or just open the repo directly. Shown in the status bar. Tools stay
rooted at the workspace so cross-repo work is still possible — only state, sessions and config
are scoped. `/scope` still answers, but only to say where you are and how to change it.

**The prompt's `.agent/artifacts/…` and `.agent/tmp/…` are one literal for every repo (v8.9, #154).**
Tools resolved it against the workspace, so under a scope `task.md` went to `<repo>/.agent/`, where
nothing reads, and the next launch took that folder for a root and moved the repo's state. Every file
tool now goes through `paths.resolveToolPath`, and `isAgentArtifact` too. `resolveState` skips a
`.agent` holding only those two folders (`isStrayAgentDir`) when a real root is above it, and
`migrateStrayAgentDir` moves its files, never overwriting. The companion's `agentStateDir` has the
same rule. **A stray that a launch already filled is not recognised:** `config.json` and `conversations/`
make it look deliberate, so it stays a root. A shell command (`cat .agent/artifacts/task.md`) is not
mapped either. Pty: `task.md` in the scope, no `.agent` in the repo, 0 clears at 13 and 24 rows.

**`/files` and `.agent/README.md` (v9.9.1, `frontend/menus/files-view.js`, `core/workspace/agent-readme.js`).**
Steps A and B of the `.agent` plan. `/files` lists the task list, plans, memory, the conversation and
earlier ones, logs, `/undo` backups, the home copy and the README, each an OSC 8 link (`Choices`
takes `link`); enter shows it in Finder by argv, and a missing one opens the nearest folder and says so.
The README goes to the resolved root after `new AgentLoop`, never creates `.agent`, and is rewritten
only while its first line is the marker. `/reset` moves it. Pty: 0 clears at 13 and 24 rows.
**Conversations are one folder each (v9.9.2, `storage/session-store.js`, `core/install/migrate-conversations.js`).**
Owner, on `sessions/sessions/`: "what is all this". `conversations/<id>/` is written from the first turn and
`current.json` names it, so filing is an index line; `clear()` removes only an unfiled folder, and `--resume`
files the one in progress. Moved once from `sessions/` (both copies), leftovers to `~/.agent/trash/`;
on this repo's real data 97 folders, all 96 listed resumable, a second run moves nothing.

**The landmine:** `homeDir()` is `~/.agent`. A naive upward walk from any project under `$HOME`
finds it and would adopt the global home as a project root, pooling every project's state and
leaking every project's rules into everyone else's prompt. `resolveState` excludes it and stops
walking at `$HOME`; `paths.test.js` covers it. **A temp dir's own `.agent` is the same trap (v8.7,
`tempAgentDirs`)**: on Linux `os.tmpdir()` is the shared `/tmp`, and tests passing a literal
`'/tmp'` as the workspace left a `/tmp/.agent` that every scratch workspace adopted, 18 CI
failures. `resolveState` and `skillSearchPath` skip it; `setup-home.js` gives each test process
its own `TMPDIR`. A test workspace is a `mkdtemp`, never a literal path. An unwritable one is a
path under a regular file (ENOTDIR everywhere), never `/proc/…`: Linux's recursive `mkdirSync`
spins forever there, which hung three test files until the 2-minute cap.

| Path | Contents |
| --- | --- |
| `<ws>/.agent/config.json` | `modelConfig`, `commandRules`, `memoryEnabled`, `agentName`, `contextFolders`, `skillFolders` |
| `<ws>/.agent/memory/` | what the agent learned here, one fact per file — scoped, never walked, read back into `<memory>` |
| `<ws>/.agent/artifacts/` | `task.md`, `implementation_plan.md`, `walkthrough.md` — written for the user to read |
| `<ws>/.agent/state/` | the VS Code companion's files (see below) and `bridge.json` |
| `<ws>/.agent/logs/errors.jsonl` | structured failure log — one JSON object per line |
| `<ws>/.agent/logs/commands/<date>.jsonl` | every shell command run, blocked or rejected — an audit trail, never read back into a prompt |
| `<ws>/.agent/backups/`, `context/`, `logs/`, `tmp/` | see `paths.js` |
| `<ws>/.agent/conversations/` | one folder per conversation (`<id>/conversation.jsonl`, `chat.json`, `plans/`), `index.jsonl`, `current.json`, `compacted.jsonl` |
| `~/.agent/workspaces/<name>-<hash>/conversations/` | the durable copy, laid out the same |

**Resuming has two doors, and one of them used to skip the browser.** The model's memory is not
`history.jsonl` — that is the *human's* record. It is the chat thread in the tab, and Gemini keeps
that thread's id in the URL (`/app/<id>`), which the conversation's `chat.json` stores. `resumeSessionById`
restores all four halves: the transcript, `chatThread`, an `open_thread` to the extension, and —
only when there is no thread — `pendingRecap`.

`/history` and the side panel called it. **`--resume` and `--continue` called
`sessionStore.resumeSession(id)`, the storage method, and stopped.** So the transcript came back,
the tab opened a *new* conversation, and the model was told nothing about either — the exact
failure `chat-thread.js` exists to prevent, reached through the one door that skipped it.
`resumeSessionById`'s own comment had warned why: *"Two copies of 'restore a conversation' is how
one of them ends up forgetting."* It was lifted out for the panel and the picker; the launch flags
were the copy left behind.

They cannot simply call it: the constructor runs before the WebSocket server exists, so there is
nowhere to send `open_thread`. The constructor records `_resumeOnConnect` and reads `chatThread`
from `chat.json`; `resumeThreadOnConnect()` drains it when a client **identifies as an
extension** — the same event `flushPendingInjects` hangs off, and for the same reason. It holds
rather than clears the flag when neither callback set exists yet, because `_toExtension` drops
silently the way `_notify` once did. **The invariant is a reopened thread or a recap, never
neither**, and `resume-thread.test.js` asserts exactly that.

**A chat we walked away from is a third state (`72fe1ed`).** `setThread` opens with
`if (!thread?.id) return` — that guard stops a URL with no id, which is every brand-new chat, from
wiping a good record — and a fresh chat has no id until its first exchange. So between
`startNewChat()` and the first reply, memory said "no thread" while disk still named the old one,
and both resume paths read disk. `startNewChat()` now calls `sessionStore.clearThread(previous)`,
which writes `thread: null, leftThread: previous`; `planResume` turns `left` into `replay`. This
note said "the next bug" for a while after it was fixed — check the code before believing a
paragraph here that says something is still open.

**`/reset` starts a repo fresh, and moves rather than deletes (v5.6).** Both copies go — the
repo's `.agent/` and `~/.agent/workspaces/<slug>/`, or the reconcile on the next start brings the
history straight back — to `~/.agent/trash/<slug>-<stamp>/`. Only `core/install/reset.js`'s
`STATE_ENTRIES` move: a monorepo root holds every sibling's scope folder, and this repo's own
`.agent/` held a stray `server/` scope, so an unknown entry is listed and left. `skills/` stays
(a person wrote it); `--keep-settings` also keeps `config.json` and `memory.md`. It restarts,
because the loop would write the old conversation back.

**Compaction never handed anything over, and ran beside the turn (fixed v5.9).** Found under
the pty by logging every prompt the fake extension received: the first prompt in the fresh chat
had the system prompt and the next message and **no summary**. The summary was a `system` turn,
`pendingRecap` skips those, and nothing else read it — the write-only trap a third time, on the
mechanism that runs exactly when a session is longest. It also fired at the *start* of a turn,
alongside it, and `startNewChat` had no lane check, so the tab could move to an empty chat
mid-round. And the summary came from re-pasting every older turn, results replaced by
placeholders, into a cold tab. Now (`core/turn/compaction.js`):

- **Asked of the current chat** (`_askThread`, a side question on the main lane whose reply is
  consumed whole and never run): 465 characters out, where the paste was the largest prompt in the
  system.
- **Before your next message, never during a turn (v5.20).** Past the threshold, `handleUserMessage`
  compacts first (`_runCompaction`, awaited, busy flag up so typed prompts queue) and then sends
  the message into the fresh chat. Owner's call: *"do not compact mid conversation, that should
  hit after threshold is met and user enters a new message"* — the between-rounds
  `_compactAndResume` and the automatic end-of-turn run are gone. A `/compact` typed during a
  turn still runs when it ends. The status bar says `N% until auto-compact` within 20 points.
  `startNewChat` refuses while the main lane is busy.
- **Asked, not forced (v7.5, `compactionToAsk`).** Owner: *"before auto-compact, lets give user
  option, auto-compact now or continue using, we will stop user once and lets not force it"*. Past
  the threshold, `handleSubmit` stops before sending (after the mismatch ask, whose choice rides in
  `opts`): **Compact now** (as before) or **Continue in this chat** (`declineCompaction`: not
  compacted, not asked, no countdown in the status bar, until `startNewChat`). `/compact` still runs.
  Esc gives the message back. The side panel never asks, so a panel message still compacts when
  due. Pty: both paths and a third message at 13 and 24 rows, 0 clears.
- **Handed over once** as `<compacted_context>`: summary, the archive pointer naming
  `recall_history`, and the kept turns capped (1.5k each, 6k total). The count restarts at **zero**
  — counting the kept turns in full re-triggered it on the next turn (a 335k-character reply).
- **The screen survives the rewrite.** `historyOffset` records how far the front moved;
  `mergeLoopHistory` positions are absolute, or the kept turns are drawn twice. The turn commits
  while compaction runs (`turnInFlight` excludes `isCompacting`): holding a long final reply live
  under the progress row was 8 full clears and 3.1 MB for one compaction; now 0.
- **The budgets are tested by the log, not argued (v7.3).** `contextFill` (tokens and the rung's
  budget) rides on every trace and on every `provider_error`, `tool_amnesia` and `compaction` row;
  `/logs speed` shows first token and reply time by fill band (under 25%, 25–50%, 50–80%, over
  80%). Before this, none of those rows said how full the thread was, so 24k / 48k / 96k could
  not be checked. Change a budget only when a band says to.
- One spinner row, `✻ Compacting conversation… (15s · esc to stop)` under the `❯ /compact` row
  (v7.9; the stages still ride in `progress`, undrawn), esc cancels with nothing changed; the status
  bar says `N% to auto-compact` within 20 points; every compaction writes a `compaction` notice with
  which path ran. **Typed `/compact` never showed its progress**: between turns `loop.callbacks` are
  the background ones, which go to the side panel, so the row read "Thinking…"; App sets the words
  itself now.
- **A new chat is asked for twice (v7.9, `startNewChat`).** Reported: `/compact` said the browser did
  not start a new conversation. Extension 1.55.0 acks only after the load and the bridge (up to
  13 s) and the server waited 5, so a slow load failed here and succeeded in the tab, with the
  summary never handed over. 15 s per ask, and a timeout or `ok: false` asks once more; a tab
  already on a new chat acks at once. The failure message is two lines and the chat's URL, on a
  line of its own. `visibleWidth`/`wrapAnsi` count OSC 8 links as zero columns: marked-terminal
  wraps a URL in one, and the bytes broke it after 44 characters. Pty (`FAKE_NEWCHAT=true,false,true`,
  `FAKE_SUMMARY_MS`): handed over on the second ask, and the both-refused path, at 13 and 24 rows;
  the one `ESC[2J` is `/compact`'s repaint, on `main` too.

**Compaction keeps what it promises (v6.15, plan Phase 6).** The fresh chat gets the summary plus
the last **3 exchanges** (`splitForCompaction`: from the third-last user message, however many rows
follow), not the last five rows of any kind — replayed against real history those were empty in 28%
and one row in 41%, filled by watcher and tool rows. Watcher rows (`type: 'fs_event'`) are not
turns for any count a person reads (`countTurns`: `/compact`'s guard, "Compacted N turns",
`/context`, settings, the local summary); storage is unchanged. The agent's own writes are no
longer announced as edits "made externally by the user": `DiffEngine._writeFileAtomic` notes the
path and its temp file in `core/edits/own-writes.js` and the watcher drops events for that path within
3 s, so a real edit meanwhile still shows. v2's `ask_subagent` says `low | medium | high | max`
(`subagentEffortWords`); the code already folded both vocabularies. Pty: the fresh chat's first
prompt held exchanges 4–6 with 8 watcher rows after them; the one `ESC[2J` at compaction is on
`main` too (13 and 24 rows).

**Session history is written to both copies on every turn** (`storage/session-store.js`). The
workspace copy sits next to the code; the home copy survives a clean checkout or a wiped
`.agent/`. On startup the two are reconciled — more turns wins, the other is rebuilt from it.

`AGENT_CLI_HOME` overrides the home dir, which is `~/.agent`. The pre-rename `GEMINI_AGENT_HOME`
and the older `AGENT_HOME` are still read, because dropping them would silently repoint an
existing install rather than fail. It is
deliberately **not** `~/.gemini`: that belongs to Google's Gemini CLI and Antigravity, which
really do keep data there.

`core/install/migrate.js` folds the pre-`.agent` layout (`.gemini/`, `.gemini-agent/`, `~/.gemini-agent/`,
`.agent-github-plans/`, root `setAgentName.json` / `agent.log`) into `.agent/` on startup. It
runs only when `.agent/` is absent, moves rather than copies, and is a no-op on the second run.

**Those three claims are assertions** (`test/backend/core/migrate-workspace.test.js`): the migration
moves the user's data before anything is on screen, and a clobber cannot be undone. A fixture for it
must come from the migration's own plan, not from memory of the old layout.
