# Agent CLI Companion

A VS Code extension that lets the CLI agent see what you are looking at, lets you review
its plans where you review everything else, and — since 1.8.0 — lets you talk to it from
the sidebar.

The agent still lives in your terminal. The chat panel is a second window onto **that**
agent — one conversation, one browser tab — not a second agent. Until 1.8.0 this README
said "it is **not** a chat panel"; what changed is in the 1.8.0 entry below.

## What it does

| | |
| --- | --- |
| **Add to Agent Chat** | Send the selection to the agent's prompt as `@file.js:12-30`. `cmd+alt+l`, the editor context menu, the editor title bar, or the line-number gutter. |
| **Attach to Agent CLI** | Right-click files or folders in the explorer (or an editor tab) to attach them to the prompt as `[File #n]`, `[Folder #n]` or `[Image #n]` tags, as a drop would. The agent gets the path and reads what it needs. For editors whose panels take drops for the whole window, such as Antigravity's agent panel. |
| **Editor state** | The active file and cursor position, so `get_editor_state` can answer "what am I looking at?". |
| **Diagnostics** | The Problems panel, so `get_diagnostics` can check whether an edit compiled. |
| **Plan review** | Comment on a plan section by section and approve, request changes, or reject — the shape of a PR review, on `implementation_plan.md`. |
| **Chat** | The Agent CLI icon in the activity bar. `cmd+alt+j` focuses it. Type `@` to attach a file or your selection; edits open in VS Code's diff view with ✓ / ✕ in the title bar. **Agent CLI: Start Agent** opens one in a terminal if none is running. |

## How it talks to the CLI

Through files under `<workspace>/.agent/state/`, never a socket:

```
editor.json         active file and cursor
diagnostics.json    the Problems panel, debounced 1.5s
chat-queue.jsonl    "Add to Agent Chat" selections and attached files, drained by the CLI
plan-review.json    comments accumulated while reviewing
plan-approval.json  the submitted verdict
```

Files rather than a socket is what lets the extension queue work **before the CLI is
even running** — a selection you send at 9am is waiting for you when you start the agent
at 11. It also means there is nothing to reconnect and nothing to leak.

The debounce on diagnostics is not politeness: `onDidChangeDiagnostics` fires continuously
while a project indexes, and writing on every event makes the file unreadable.

## Installing

Extensions panel (`Cmd+Shift+X`) → `...` → **Install from VSIX...** → pick the `.vsix` in
this folder. Requires VS Code **1.93.0** or newer.

## Building

```bash
cd vscode-companion
npx vsce package --allow-missing-repository --skip-license
```

The `.vsix` is **committed**, so a change to `extension.js` that is not repackaged ships
nothing. Only the newest build is tracked — git keeps the rest, and two VSIXs side by side
is how someone installs the wrong one.

`extension.js` duplicates the `.agent` directory name because it cannot import from
`server/`. Changing `AGENT_DIR` in `server/src/core/paths.js` means changing it here too.

## Version history

### 1.8.7 — 2026-10-31

**Attach to Agent CLI** on the explorer's and an editor tab's context menu. The selected files
(multi-select works) become tags at the terminal prompt's caret, exactly as if they had been
dropped. Antigravity's agent panel takes image, PDF and video drops for the whole window, so a
drag never reaches its terminal; a menu command cannot be taken that way. Needs the CLI at v7.8.

### 1.8.6 — 2026-10-30

**Files dragged from the explorer onto the chat panel** (hold shift, as VS Code requires for a
webview) become `[File #n: name]` tags and send the path, as the terminal does; the agent reads
the range it needs. Files from Finder and images behave as in Chrome's panel. Only the copied-in
panel changed.

### 1.8.5 — 2026-10-30

**Action rows read `● Run(npm test)`**, as in the terminal since v6.5: one verb per tool from the
server's catalog, the dot green or red by outcome. Only the copied-in panel changed.

### 1.8.4 — 2026-10-26

**Images in the panel are `[Image #n]` tags**, as in the terminal: a pasted image puts a tag in
the message and goes with it only while the tag is there. A long tool row no longer wraps its name.
Only the copied-in panel changed.

### 1.8.3 — 2026-10-26

**The panel shows prompts typed in the terminal**, not just the replies, and hears when a turn
ends, so its busy state no longer outlasts the turn. Only the copied-in panel changed.

### 1.8.2 — 2026-10-24

**The panel's mode toggle cycles Plan, Auto and Strict**, matching the agent's three modes. Only
the copied-in panel changed.

### 1.8.1 — 2026-10-23

**The panel stays busy for the whole turn.** A reply like "I'll read the file first" plus a
tool call re-enabled Send and removed "Thinking..." while the tools ran and Gemini wrote the
next round. The agent now marks that prose `continuing`, and the shared panel page keeps its
busy state for it. Only the copied-in panel changed.

### 1.8.0 — 2026-10-19

**A chat panel in the sidebar.** Reversing "it is not a chat panel" needs a reason, and it
is this: the agent's two front-ends were the terminal and a Chrome side panel, and the
person using it lives in the editor. The thing only an editor panel can do is open the
agent's edits in the editor's own diff view, and attach the file or selection you are
looking at with `@`.

- **One renderer.** The page is the Chrome side panel's own (`panel.html`, `panel.js`,
  `panel.css`, copied in by `scripts/sync-panel.js` at package time), with
  `media/vscode-shim.js` answering its `chrome.runtime` calls over the agent's WebSocket.
  A request the side panel handles — a question, a command approval — is handled here by
  the same code, so it cannot be forgotten in one of them. A panel that ignores a request
  deadlocks the turn waiting on it.
- **The socket lives in the webview**, because the extension host is Node without a
  WebSocket client and this extension has no dependencies. It identifies as `editor`,
  never `extension` — an extension is sent `inject_prompt`.
- **It finds the agent through `.agent/state/bridge.json`**, which the agent writes when
  it starts listening: port, pid (to recognise a file left by a crash), and a per-launch
  token the panel must present. The Chrome extension still connects on its Origin alone.
- **A turn started here** runs in the same conversation; the terminal draws it on its next
  turn. A turn started in the terminal streams here live.

Not done, deliberately: checkpoints/rewind, several parallel sessions, per-hunk decisions
in the diff view (the panel's card still has the patch).

### 1.7.0 — 2026-09-26

**Terminal forwarding removed.** It never produced a single record.

`editor.json` and `diagnostics.json` are written continuously on a live
install; `terminal.jsonl` **has never been created**. Both ends were wired
correctly — the companion wrote on `onDidEndTerminalShellExecution`, the CLI
drained it behind `ctrl+f` — so this was not the write-only trap this project
has hit twice before. It was simply never reached.

The cause is the gate, and 1.5.0's own note predicted it: the offer appears
only when a command *fails* in an *unwatched* terminal, **once per session**,
as a dismissable toast. Dismiss it and it is gone until you restart. That note
said *"a feature nobody can find is the same as one that is off"*, which was
right, and this is what it looked like eleven days later.

Removed rather than made discoverable, on the owner's call. The alternative was
a second attempt at a gate for a feature with no demonstrated demand — and the
ladder of failed guesses is what CLAUDE.md warns about by name. Gone with it:
`terminal-queue.js`, `paths.terminalQueuePath`, the `ctrl+f` binding, the
`N failed ^f` status field, and the `agentCli.watchTerminal` command.

The 1.4.0 and 1.5.0 entries below stay. They are the record of what was tried.

### 1.6.0 — 2026-09-21

- **Stops writing `visibleText`.** The editor state carried the ±50 lines around
  the cursor, rewritten every time the cursor moved — measured on a live session
  at **2,501 of 2,630 bytes, 95.1% of the file**. Nothing reads it: the CLI's
  `get_editor_state` stopped returning it on the same day, because those bytes
  bought the model a worse read than it already had — viewport-cropped, without
  line numbers, of a file `read_file` returns whole and numbered. What is left
  is the pointer: active file, cursor position, timestamp.

### 1.5.0 — 2026-09-16
**Terminal forwarding became opt-in, per terminal.** Right-click a terminal →
*Agent CLI: Watch This Terminal for Failures*.

*Why:* it forwarded **every** non-zero exit from **every** terminal. Reported from use —
three markers piled into one prompt, one of them a typo the owner had made in their own
shell and already fixed. A failure you already know about, from a command you ran
deliberately, is noise you delete by hand before the prompt is usable. "Offered, not acted
on" was always the design; this is the same idea one level up.

A first failure in an unwatched terminal offers to watch it — **once** per session, with a
button. A feature nobody can find is the same as one that is off; a prompt on every
failure is the nagging that forwarding-everything already was.

### 1.4.0 — 2026-09-11
**Terminal shell integration.** Failed commands — and only their tail — are forwarded to
the CLI, where they wait behind `ctrl+f` rather than typing themselves into your prompt.

Engine moved `^1.80.0` → `^1.93.0`, which is where
`onDidStartTerminalShellExecution` lands.

*Why only failures, and only the tail:* a passing `npm test` is not news, and a full build
log is tens of thousands of characters that would be typed into a browser chat tab
verbatim.

### 1.3.1 — 2026-09-10
**Fix:** the plan-review code lenses did not appear, and a stale review could be answered
after the plan had moved on.

### 1.3.0 — 2026-09-10
**More ways into Add to Agent Chat** — the editor title bar and the line-number gutter,
alongside the context menu and `cmd+alt+l`. One feature, four doors, because the one you
remember is the one you use.

### 1.2.0 — 2026-09-10
The big one. **Diagnostics**, **Add to Agent Chat**, and **PR-style plan review** —
comment on sections, then accept / request changes / reject.

### 1.1.0 — 2026-09-05
State moved under `.agent/`, with the rest of the project. Renamed
`gemini-agent-companion` → `agent-cli-companion` → `cli-agent-companion` as the CLI itself
was renamed away from being Gemini-specific.

### 1.0.0 — 2026-08-23
Active file and cursor position, written to a JSON file on a 500 ms debounce. That was the
whole extension.
