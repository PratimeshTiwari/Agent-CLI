# Agent CLI

A coding agent for your terminal, in the style of Claude Code — with **no API key**. It drives a
Gemini tab in your own Chrome, signed in as you: the agent writes the prompt, a small extension
types it in and streams the reply back, and the agent reads, edits and runs things in your repo.

![The agent documenting two models into a Markdown file](docs/images/terminal.svg)

- **Local.** No hosted backend, no telemetry, no keys. Nothing leaves your machine except the chat
  you already use.
- **You stay in control.** Edits are diffs you approve (or not, in auto mode), commands are
  risk-checked, and every shell command is logged.
- **Built for real repos.** Large files, long sessions that compact themselves, background tasks,
  and an editor panel for VS Code.

## A quick tour

**Every edit is a diff you approve** — in plan mode, the change is shown before anything is
written. Approve, reject, or approve and switch to auto mode.

![A diff approval prompt](docs/images/diff-approval.svg)

**Send code from your editor** — with the VS Code companion, select lines and press `⌥⌘L`.

![Selecting code in the editor and sending it to the agent](docs/images/add-to-chat.svg)

**Keep typing while it works** — new messages queue and go out when the turn ends; `↑` takes one
back.

![A queued message under a running turn](docs/images/queued.svg)

**Long sessions look after themselves** — near the limit the agent summarises the conversation in
the same chat, moves to a fresh one, and carries on: one line in the transcript, the summary behind
`ctrl+e`. The status bar's meter warns you first (`▰▰▰▰▱ 72% · compacts at 80%`).

![A compacted conversation](docs/images/compaction.svg)

**Every setting on one page** — `/settings` is a list of switches: `↑↓` picks a row, `←/→`
changes it in place, and the selected row says what it does. `tab` moves between Settings, Status
and Context; typing filters across all three.

![The settings page](docs/images/settings.svg)

**Effort is a slider** — `/effort` puts Faster on the left and Smarter on the right. `←/→` moves
the marker, which names the Gemini model that level switches the tab to, and `enter` sets it. The
reply is one line, `⚙ effort  High → Medium · switching to Gemini Flash`, plus a warning only if
the browser could not switch.

![The effort slider](docs/images/effort.svg)

**It asks when the browser disagrees** — if the Gemini tab is on a different model from the one
your effort wants, your next message stops and asks: switch the tab, send on what it has, or change
the effort to match. Esc puts your message back in the box. `/effort mismatch ask·follow·switch`
picks what happens without asking.

![Effort and browser differ: a three-way choice before sending](docs/images/effort-mismatch.svg)

**When Pro is at its limit, it steps down and says so** — a quota reply, or a switch that will not
land, sends the same prompt again one rung lower, once, with a line saying what happened. The status
bar shows `↓ 3.8 Flash` until `/effort` tries the higher model again.

![Pro at its limit: the turn steps down to Flash](docs/images/step-down.svg)

**It reads PDFs, Word and PowerPoint** — `read_file` turns a `.pdf`, `.docx` or `.pptx` into
Markdown (headings, lists, tables, a line per page or slide), so the model reads a policy or a spec
the way it reads code. `.doc`, `.rtf` and `.odt` work on macOS. Other binary files are refused
with a reason rather than read as garbage.

**It debugs from logs** — hand it a Grafana, Loki or Datadog export (JSON, NDJSON, CSV, plain text,
gzipped or not) and `query_log` reads the whole file however large: 200 MB in about four seconds.
It starts where a person would — the time range, the levels, when the errors started and the
messages that repeat — then narrows with filters, counts and the records around an error. It is on
prompt v2 (`/prompt v2`).

![Reading a PDF policy against the code it describes](docs/images/pdf-read.svg)

**A health check for the install** — `/doctor` lists every package the agent uses: whether it is
**required** (the agent will not start without it) or **optional** (one feature stops working),
the version installed, the one `package.json` wants and the latest on your registry. A missing
package also shows one line at startup. It is a menu: tabs for All, Required, Optional, Other
and Tools; enter on a package says why it is here, what breaks without it and which files import
it, and offers to install it, update it, pick any other version, or remove it if nothing uses
it, or uninstall it if it is optional (it stays listed, with Install to bring it back). Unused
packages go in one step. ripgrep needs no installer when VS Code or Cursor is installed: both ship
it, and the agent uses their copy. A missing tool (`rg`, `git`) can otherwise be installed with Homebrew or winget. A failed install says
one line, and the full error is a choice away. If a change stops the agent starting, the next
start puts the previous `package.json` and lockfile back by itself. `/doctor fix` runs the
install; `/doctor report` prints the table. `agent doctor` works from the shell even when the
install is too broken to start.

![/doctor: installed, missing and newer, by tier](docs/images/doctor.svg)

*Screenshots are real terminal frames from the project's test harness, replayed through a terminal
emulator; the editor in the second one is an illustration.*

## How it works

![Architecture: terminal agent, Chrome extension, Gemini tab](docs/images/architecture.svg)

The agent and the extension talk over a WebSocket on `127.0.0.1`. There is no tool-call API — the
agent reads tool calls out of Gemini's reply text, runs them, and sends the results back as the next
message. One Gemini tab holds the conversation; subagents get tabs of their own.
The full design — the turn lifecycle, the bridge, prompt economics, tools, subagents — and the
reasons behind it are in [`CLAUDE.md`](CLAUDE.md), under **Architecture**.

## Install

You need **Node.js 20+**, **Google Chrome**, and a **signed-in tab on [gemini.google.com](https://gemini.google.com)**.

```bash
curl -fsSL https://raw.githubusercontent.com/PratimeshTiwari/Agent-CLI/main/setup.sh | bash
```

That clones to `~/Agent-CLI`, installs, runs the tests, and puts `agent` (and `agent-cli`) on your
`PATH`. Re-running it updates. Prefer to read it first? [`setup.sh`](setup.sh), or:

```bash
git clone https://github.com/PratimeshTiwari/Agent-CLI.git && cd Agent-CLI && ./setup.sh
```

Then two things no installer can do for you:

1. **Load the Chrome extension.** `chrome://extensions` → turn on **Developer mode** → **Load
   unpacked** → pick the `extension/` folder. Pin **Agent CLI Bridge**.
2. **Open gemini.google.com and sign in.** Leave the tab open.

**Optional — the VS Code companion.** Extensions panel → `…` → **Install from VSIX…** →
`vscode-companion/cli-agent-companion-1.8.6.vsix`. It gives the agent your open file, cursor and
Problems panel, and adds a chat panel to the sidebar (`cmd+alt+j`).

## First run

```bash
cd ~/code/your-project
agent
```

![First-start setup: choosing a theme with a live preview](docs/images/setup.svg)

The very first start walks you through setup, one screen per step: pick a theme (previewed live
as you move), name the agent (the banner previewed as you type), and connect Chrome (the exact folder
to load, and a spinner that turns into **Connected** when the extension dials in). Enter goes on,
esc skips. Later: `/theme` and `/name`.

The status line shows the mode — `⏸ plan mode on (shift+tab to cycle)` — and the input box says so if
the extension is not connected. Type a request and press Enter. To pick up where you left off:
`agent --continue`, or `agent --resume <id>` (printed under the transcript when you exit).

## Using it

### Modes — `shift+tab` cycles them

The status line says which one is on, the way Claude Code does: `⏸ plan mode on`,
`⏵⏵ auto mode on`, `⏹ strict plan mode on`. The rules above and below the input take the mode's colour.

| Mode | Edits | Commands |
| --- | --- | --- |
| **plan** (default) | ask first — except Markdown inside the repo, which is written straight away (AGENT.md and CLAUDE.md still ask) | ask first, unless read-only |
| **auto** | small, safe edits apply on their own; large rewrites ask | safe ones run, risky ones ask |
| **strict** | every edit asks, Markdown included | ask first, unless read-only |

### Keys

| Key | |
| --- | --- |
| `esc` | stop the run |
| `ctrl+c` twice | quit (prints how to resume) |
| `↑` | with an empty prompt, take back a queued message |
| `ctrl+x` `ctrl+s` | steer the last queued message into the running turn instead of waiting |
| `ctrl+e` | expand or collapse every step |
| `ctrl+o` | show or hide the task list |
| `ctrl+b` | bring the Gemini tab to the front |
| `ctrl+j` | newline without sending |
| `⌘⇧1` | the floating chat window, from any app *(bind it once at `chrome://extensions/shortcuts`, Global)* |

**Themes.** `/theme` picks the colours and previews each as you move through the list: Dark and
Light (tuned palettes), colour-blind versions of both (blue and orange instead of green and red),
**Terminal** (your terminal's own colours, the default) and Mono. The choice follows you across
repos (`~/.agent/settings.json`); `NO_COLOR` always means Mono.

Messages typed while the agent is working are **queued** and sent when it finishes. Paste freely —
long pastes collapse to a marker. `ctrl+v` with an image on the clipboard puts `[Image #1]` in
the prompt; backspace over the tag takes the image off. **Drag files or folders onto the terminal**
and each becomes a tag — `[File #1: app.js]`, `[Folder #2: src]`, or `[Image #3]` for a picture.
Only the path goes to the model, with its size and line count, and it reads what it needs.

### Commands worth knowing

| Command | |
| --- | --- |
| `/effort` | how hard to work, on a slider; switches the Gemini model picker to match |
| `/prompt` | which prompt version is sent: `v1` is the frozen baseline, `v2` the candidate; bare `/prompt` compares rounds per turn |
| `/doctor` | packages and tools as a menu: why each is used, install, update, pick a version, remove unused · `report` prints the table |
| `/diff` | the last edit's diff, and whether it was written |
| `/undo` | revert the last edit |
| `/copy` | the last reply, as markdown, to the clipboard — `/copy code` for the last code block |
| `/shell` | a scratch shell, one command, then back to the prompt |
| `/compact` | summarise the conversation now (it also happens on its own, with a progress bar) |
| `/history` | past conversations — pick one to reopen |
| `/settings` | everything that is set, on one page |
| `/context` | what is in the window and which files feed the prompt |
| `/subagents on·off` | parallel tabs for research and review |
| `/theme` | colours — Dark, Light, colour-blind, Terminal (the classic look) or Mono; previews as you move |
| `/logs` | a picker: failures, speed, tool use, the text channel and notices, each row with its answer; enter opens the full one (`/logs speed`, `/logs tools`, `/logs <flow>` still work typed) |
| `/reset` | start this repo fresh — its `.agent` state goes to `~/.agent/trash`, nothing deleted |
| `/help` | every key and command |

## Telling it about your project

- **`AGENT.md`** at the root of your code: conventions it must know before its first edit ("tests
  run with `pnpm vitest`", "never edit `src/generated/`"). Nested ones are read too, nearest wins;
  `~/.agent/AGENT.md` applies everywhere.
- **Skills** — Markdown files in `.agent/skills/` that it opens only when their one-line
  description matches the task. `/skills` lists and creates them.
- **Memory** — facts it learns along the way, in `.agent/memory.md`. `/memory` shows them; edit the
  file to correct one.

## Where it keeps things

Everything for a repo lives in **`<repo>/.agent/`** — config, sessions, logs, backups for `/undo`,
and `artifacts/` (task list, plans) written for you to read. A second copy of the conversation
history lives in `~/.agent/workspaces/` so a fresh checkout doesn't lose it. In a monorepo, one
`.agent/` at the top holds a folder per repo.

## Troubleshooting

| You see | Do |
| --- | --- |
| `○ agent` in yellow | The extension isn't connected: open a gemini.google.com tab, or reload the extension at `chrome://extensions` |
| ⌘⇧1 does nothing | Chrome only assigns the shortcut on first install — set it at `chrome://extensions/shortcuts` and choose **Global** |
| It feels slow | `/logs speed` shows each stage of a turn, by rung and by prompt version; typing the prompt should take well under a second |
| Something failed | `/logs` groups failures by where they came from |
| After `git pull` | `/update` says what to reload — usually the extension and a restart |
| A feature fails on a new machine | `/doctor` (or `agent doctor` from the shell) lists what is missing; `/doctor fix` installs it |
| `latest` is blank in `/doctor` | npm could not reach your registry — the reason is printed; on a work laptop check `npm config get registry` |

## Release history

Every change reached `main` through a pull request from a branch that is kept. The full list — every
PR with its date, branch and notes — is in [`CHANGELOG.md`](CHANGELOG.md).

| Series | Dates | PRs | What it was about |
| --- | --- | --- | --- |
| **v5** | 2026-10-19 … 2026-10-26 | [#63](https://github.com/PratimeshTiwari/Agent-CLI/pull/63)–[#93](https://github.com/PratimeshTiwari/Agent-CLI/pull/93) | Clean slate, one recovery policy, the VS Code chat panel, compaction that hands over, large files, three modes, themes, a redesigned transcript, first-start setup, the effort slider and Argon |
| **v4** | 2026-09-27 … 2026-10-19 | [#60](https://github.com/PratimeshTiwari/Agent-CLI/pull/60)–[#62](https://github.com/PratimeshTiwari/Agent-CLI/pull/62) | An honest failure log, the rename to Agent CLI, fixes from real use |
| **v3** | 2026-09-22 … 2026-09-27 | [#26](https://github.com/PratimeshTiwari/Agent-CLI/pull/26)–[#59](https://github.com/PratimeshTiwari/Agent-CLI/pull/59) | The model picker, tab lanes, effort low/medium/high, traces, subagent fixes |
| **v2** | 2026-09-20 … 2026-09-22 | [#17](https://github.com/PratimeshTiwari/Agent-CLI/pull/17)–[#25](https://github.com/PratimeshTiwari/Agent-CLI/pull/25) | Bridge speed and stability, tool-call parsing and discipline, prompt trims |
| **v1** | 2026-09-16 | [#13](https://github.com/PratimeshTiwari/Agent-CLI/pull/13)–[#16](https://github.com/PratimeshTiwari/Agent-CLI/pull/16) | The first stable release |
| **Betas** | 2026-08-26 … 2026-09-06 | [#1](https://github.com/PratimeshTiwari/Agent-CLI/pull/1)–[#12](https://github.com/PratimeshTiwari/Agent-CLI/pull/12) | Context management, subagents, the GitHub agent (later removed), the CLI |

## Project images

Every screenshot in this project, in one place. They are real terminal frames from the test harness
(`docs/images/`), except the editor in *Add to chat* and the architecture diagram, which are drawn.

| | |
| --- | --- |
| ![The agent at work](docs/images/terminal.svg)<br>**The agent at work** — reading two models and documenting them | ![Diff approval](docs/images/diff-approval.svg)<br>**Diff approval** — every edit in plan mode |
| ![Add to chat](docs/images/add-to-chat.svg)<br>**Add to chat** — a selection from VS Code arrives as a marker | ![Queued messages](docs/images/queued.svg)<br>**Queued messages** — type while it works |
| ![Compaction](docs/images/compaction.svg)<br>**Compaction** — long sessions summarise and carry on | ![First-start setup](docs/images/setup.svg)<br>**First-start setup** — theme, name, Chrome |
| ![Settings](docs/images/settings.svg)<br>**`/settings`** — switches changed with `←/→` | ![Effort slider](docs/images/effort.svg)<br>**`/effort`** — faster to smarter |
| ![Effort mismatch](docs/images/effort-mismatch.svg)<br>**Effort and browser differ** — it asks first | ![Step down](docs/images/step-down.svg)<br>**Step down** — Pro at its limit, Flash answers |
| ![Reading a PDF](docs/images/pdf-read.svg)<br>**Documents** — a PDF read as Markdown | ![Package detail](docs/images/doctor-package.svg)<br>**`/doctor <package>`** — why it is used |
| ![Health check](docs/images/doctor.svg)<br>**`/doctor`** — required and optional packages, installed and latest | ![Architecture](docs/images/architecture.svg)<br>**Architecture** — terminal, extension, Gemini tab |

## More

- [`CHANGELOG.md`](CHANGELOG.md) — what changed, release by release
- [`CLAUDE.md`](CLAUDE.md) — architecture, internals, and why things are the way they are
- [`extension/README.md`](extension/README.md) · [`vscode-companion/README.md`](vscode-companion/README.md)

Developed by Pratimesh Tiwari.
