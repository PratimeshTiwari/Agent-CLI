# Agent CLI Companion

A VS Code extension for Agent CLI. It lets the agent see what you are looking at, puts the agent's
chat in the sidebar, and sends code or files to the agent's prompt from the editor. It works in VS
Code, Cursor, Antigravity and Windsurf.

![The chat panel in VS Code](https://raw.githubusercontent.com/PratimeshTiwari/Agent-CLI/main/docs/images/vscode-chat.png)

The agent still lives in your terminal. The chat panel is a second window onto **that** agent: one
conversation, one browser tab.

![Add to Agent Chat](https://raw.githubusercontent.com/PratimeshTiwari/Agent-CLI/main/docs/images/add-to-chat.png)

## What it does

| | |
| --- | --- |
| **Chat** | In the secondary side bar (the right one) on VS Code 1.106+ and Antigravity IDE, like Claude Code's; in the activity bar on older editors such as Cursor. `cmd+alt+j` or **Agent CLI** in the status bar opens it. Type `@` or press the paperclip to attach a file; edits open in the editor's diff view with ✓ / ✕ in the title bar. Messages sent during a turn queue; esc stops the turn. **Agent CLI: Start Agent** opens one in a terminal if none is running. |
| **Add to Agent Chat** | Send the selection to the agent's prompt as `@file.js:12-30`: `cmd+alt+l`, the editor context menu, the editor title bar, or the line-number gutter. |
| **Attach to Agent CLI** | Right-click files or folders in the explorer (or an editor tab) to put them in the prompt as `[File #n]`, `[Folder #n]` or `[Image #n]` tags. The agent gets the path and reads what it needs. |
| **Editor state** | The active file and cursor, so the agent can answer "what am I looking at?" (`get_editor_state`). |
| **Diagnostics** | The Problems panel, so the agent can check whether an edit compiled (`get_diagnostics`). |
| **Plan review** | Comment on `implementation_plan.md` section by section, then approve, request changes or reject, like a PR review. |
| **Shift+Enter** | A newline in the agent's prompt from the editor's terminal. |

## How it talks to the agent

Through files under `<workspace>/.agent/state/`, so it can queue work **before the agent is even
running**: a selection sent at 9am is waiting when you start the agent at 11.

```
editor.json         active file and cursor
diagnostics.json    the Problems panel, debounced 1.5 s
chat-queue.jsonl    selections and attached files, read by the agent
plan-review.json    comments made while reviewing a plan
plan-approval.json  the verdict
```

The chat panel is the exception: it streams, so it uses the agent's WebSocket. It finds the agent
through `.agent/state/bridge.json` and presents the token written there.

## Installing

Extensions panel (`Cmd+Shift+X`) → `…` → **Install from VSIX…** → pick the `.vsix` in this
folder. Requires VS Code **1.93.0** or newer (or a fork built on it: Cursor, Antigravity,
Windsurf).

From a terminal, with your editor's command-line tool (`code`, `cursor`, `antigravity`,
`windsurf`; if it is not found, run **Shell Command: Install '…' command in PATH** from the
editor's command palette):

```bash
<editor> --install-extension <checkout>/vscode-companion/cli-agent-companion-1.8.10.vsix
```

`<checkout>` is wherever `setup.sh` put the agent. If you are not sure, the `agent` command
knows. This works for any install:

```bash
AGENT_HOME_DIR="$(sed -n 's|^exec node "\(.*\)/server/src/index.js".*|\1|p' "$(command -v agent)")"
code --install-extension "$AGENT_HOME_DIR"/vscode-companion/cli-agent-companion-1.8.10.vsix
```

Three common setups:

```bash
# setup.sh's default location, VS Code
code --install-extension ~/Agent-CLI/vscode-companion/cli-agent-companion-1.8.10.vsix

# a checkout from before the rename (setup.sh keeps it), Cursor
cursor --install-extension ~/Gemini-Agent/vscode-companion/cli-agent-companion-1.8.10.vsix

# a custom AGENT_INSTALL_DIR, Antigravity
antigravity --install-extension ~/Documents/Gemini-Agent/vscode-companion/cli-agent-companion-1.8.10.vsix
```

Antigravity IDE's command is `antigravity-ide`, and it is usually not on `PATH`; the full path works:

```bash
"/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide" \
  --install-extension ~/Documents/Gemini-Agent/vscode-companion/cli-agent-companion-1.8.10.vsix
```

Then reload the window (**Developer: Reload Window**). Installing over an older version
replaces it.

## Building

```bash
cd vscode-companion
npx vsce package --allow-missing-repository --skip-license
```

The `.vsix` is **committed**, so a change to `extension.js` that is not repackaged ships
nothing. Only the newest build is tracked — git keeps the rest, and two VSIXs side by side
is how someone installs the wrong one.

`chat-panel-html.js` repeats the `.agent` folder name and the way the agent finds it, because it
cannot import from `server/`. Changing `AGENT_DIR` or the walk in
`server/src/backend/core/workspace/paths.js` means changing it here too; `state-dir-parity.test.js`
fails until you do.

Version history: [`CHANGELOG.md`](CHANGELOG.md).
