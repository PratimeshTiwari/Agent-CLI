# The VS Code companion and the side panels

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Where `.agent/` actually is

`vscode-companion/chat-panel-html.js` duplicates the `.agent` constant and ports
`resolveState` as `agentStateDir` — it cannot import from `server/`.
`state-dir-parity.test.js` compares the port against the real resolver, monorepo layout
included; changing `AGENT_DIR` or the walk in `paths.js` turns it red. Until v5.2 the companion
used `<ws>/.agent/state` unconditionally, so in a monorepo every file it wrote went where the CLI
never reads. Found when the pty harness's scratch folder sat under a stray `/private/tmp/.agent`.
`openPlan` and the plan-review lens matcher still assume the unscoped layout.

The companion's original channels are files under the state directory, never a socket:
`editor.json` (active file and cursor), `diagnostics.json` (the Problems panel, debounced 1.5s
because `onDidChangeDiagnostics` fires continuously while a project indexes),
`chat-queue.jsonl` (append-only; "Add to Agent Chat" selections, drained by `frontend/input/chat-queue.js`),
`plan-review.json` (comments accumulated while reviewing) and `plan-approval.json` (the
submitted verdict: `accept` | `changes_requested` | `reject`). Files rather than a socket is
what lets the extension queue work before the CLI is even running.

**The chat panel is the one exception (v5.2, companion 1.8.0)**, because a stream cannot be a
file. It is the Chrome side panel's own page, copied in at package time, with
`media/vscode-shim.js` answering `chrome.runtime` over the WebSocket — so there is one renderer
and a request type cannot be handled in one panel and forgotten in the other. The socket lives
in the webview: the extension host is Node 20 with no WebSocket client, and the companion has
no dependencies. Three rules hold it together:

- **It identifies as `editor`, never `extension`.** `broadcast('extension', …)` also reaches
  editor clients unless the type is in `WORKER_ONLY_TYPES` — what the worker handles itself
  (`inject_prompt`, `new_chat`, `open_thread`, …). A denylist on purpose: an allowlist starves
  the panel of the next *request* type someone adds, and a request nobody answers deadlocks the
  turn. `editor-routing.test.js` reads the worker's `handleServerMessage` switch and fails if
  the list drifts, and asserts `inject_prompt` never reaches an editor even via `'all'`.
- **It finds the agent through `bridge.json`** in the state directory — port, pid and a
  per-launch token, 0600, written on listen and removed on stop only if the pid is still ours
  (you run several agents at once; newest wins). A dead pid reads as stale, not as a port.
- **Admission is by Origin *and* token.** `chrome-extension://` is admitted on its Origin, as
  since P0 — it cannot read a file. `vscode-webview://` and Origin-less local processes must
  present the token. That closes P0's (`docs/history.md`) "another process as the same user can connect" for
  everything except a process that can read the user's files. **The pty harness's fake
  extension still works because it sends a `chrome-extension://` Origin.**

**The panel is built on the terminal's design (v8.8, extension 1.60.0, companion 1.8.14).** Reported
with screenshots as far behind the terminal. Colour is a role (`panel.css` holds `theme.js`'s `dark`
and `light`; `THEME_BRIDGE` re-points them at the editor's theme), and a conversation is rows: `▌`,
`●`, `● Verb(x)` with `⎿`. Mode and effort are menus in the composer, one `#popover` with the `/`
palette; `panelState()` sends each rung's model on this account and each mode's line, so the panel
keeps no copy, and main.js hands over `SLASH_COMMANDS ∩ AGENT_COMMANDS`, because backend/ cannot import
frontend/. `command_result` carries `state`, but `/effort` answers before the tab moves, so
`panel_state` follows every `onModels` (`switching` holds the `⚠` meanwhile): without it the footer
stayed one switch behind. An agent older than the panel sends no list, and the
button falls back to the command. `panel-controls.test.js` runs the real page in jsdom. Headless
Chrome's window has a 500-pixel minimum, so judge narrow widths in an iframe.

A turn started in the panel runs on the server's callbacks, so the terminal draws it on its
next turn rather than live — the same as the Chrome side panel always has. A turn started in
the terminal reaches the panel live, through the mirror.

**Chrome assigns a command's `suggested_key` only on first install** — reloading an unpacked
extension adds the command with nothing bound, and the shortcut silently does nothing. Reported
the day it shipped. The worker sends `floatingShortcut` on identify (`''` = unbound, `null` =
unreadable) and the server's `shortcutNotice` says to set it at `chrome://extensions/shortcuts`.

## From Gotchas

- **A file dropped on a side panel is a tag too (v6.17, `onDropFiles` in `side-panel/panel.js`).**
  Chrome gives a page the dropped file but never its path: an image goes in as a pasted one, a
  text file up to 8 KB is sent whole as a `<file name=…>` block after its header, and anything
  larger is refused with "drop it in the terminal, which can send the path". VS Code's webview gets
  `text/uri-list` for a file dragged from the explorer (with shift), so the path is sent with
  `— read it with read_file`, as the terminal does. Order on send is the terminal's: image blocks,
  file headers, message; `foldFiles` also folds the inline blocks so the text is not drawn twice.
  Not driven in a live browser: a real drag cannot be scripted here; jsdom covers the handler.
