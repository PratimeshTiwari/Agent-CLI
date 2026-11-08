# Changelog

> [!NOTE]
> **Current: v9.9.6** · extension **1.66.0** · VS Code companion **1.8.18** · prompt **v7**
> (current; new installs) or **v1** (original, frozen), with Jira, MCP and memory on both.
> After updating: Chrome reloads the extension itself; reinstall the companion from `/update` →
> Editor companion; restart the agent.

Every release reached `main` through a pull request from a branch that is kept, so this can be
checked rather than believed:

```bash
git log main --merges --format="%h %ad %s" --date=short
```

How to read it: each series opens with its **highlights** (what you can do that you could not
before), then a table with one line per release, then **details** for the releases that changed
more than one thing, folded. The reasoning behind a change is in [`CLAUDE.md`](../CLAUDE.md) and
[`history.md`](history.md); the extension's and the companion's own records are in
[`extension/CHANGELOG.md`](../extension/CHANGELOG.md) and
[`vscode-companion/CHANGELOG.md`](../vscode-companion/CHANGELOG.md).
v1 to v5 and the betas are in [`changelog/v1-v5.md`](changelog/v1-v5.md).

## Version map

Which extension, companion and prompt version arrived with which release. A dash means it did not
change.

| Release | Extension | Companion | Prompt |
| --- | --- | --- | --- |
| v9.9.6 | — | 1.8.18 | v7 gains two lines |
| v9.9.5 | — | — | v7 (v2 to v6 become it) |
| v9.9.4 | 1.66.0 | — | — |
| v9.9.3 | 1.65.0 | 1.8.17 | — |
| v9.9.1 | 1.64.0 | 1.8.16 | — |
| v9.8 | 1.63.1 | — | — |
| v9.7 | 1.63.0 | — | — |
| v9.4 | — | — | v6 |
| v9.3 | 1.62.0 | — | — |
| v9.1 | — | — | v5 |
| v8.10 | 1.61.0 | — | — |
| v8.9 | — | 1.8.15 | — |
| v8.8 | 1.60.0 | 1.8.13, 1.8.14 | — |
| v8.7.1 | — | 1.8.12 | — |
| v8.7 | — | 1.8.11 | — |
| v8.6 | 1.59.0 | 1.8.10 | — |
| v8.4 | 1.58.1 | — | — |
| v8.1 | 1.58.0 | 1.8.9 | v4 |
| v8.0 | 1.57.0 | — | — |
| v7.10 | 1.56.0 | — | — |
| v7.9 | 1.55.0 | 1.8.8 | v3 |
| v7.8 | — | 1.8.7 | — |
| v7.2 | 1.54.0 | — | — |
| v7.1 | 1.53.0 | — | — |
| v6.17 | 1.52.0 | 1.8.6 | — |
| v6.9 | — | 1.8.5 | — |
| v5.34 | — | — | v2 |
| v5.32 | — | — | v1 frozen |

## v9 — MCP, Atlassian, one Chrome profile · 2026-11-05 … 11-08 · [#158](https://github.com/PratimeshTiwari/Agent-CLI/pull/158)–[#175](https://github.com/PratimeshTiwari/Agent-CLI/pull/175)

**Highlights**

- Your own **MCP servers**: add one with `/mcp add`, and set each tool to ask, auto or block.
- **Jira and Confluence** by browser sign-in (`agent atlassian login`). Every write asks, in every
  mode.
- **One Chrome profile** gets prompts (`/chrome`), so a second Google account never types them.
- **Memory is a folder**: one fact per file, with who wrote it, when and why.
- **Thinking level follows effort**, on accounts whose picker has levels.
- **One prompt**: current or original, with every feature on both.
- Conversations are **one folder each**, and `/files` shows where everything is.

| Release | Date | PR | Summary |
| --- | --- | --- | --- |
| v9.9.6 | 11-08 | [#175](https://github.com/PratimeshTiwari/Agent-CLI/pull/175) | Shift+tab at an approval box; the diff box fits; no Canvas; Cursor's chat can move right |
| v9.9.5 | 11-08 | [#174](https://github.com/PratimeshTiwari/Agent-CLI/pull/174) | Two prompt versions, current and original; Jira, MCP and memory on both |
| v9.9.4 | 11-08 | [#173](https://github.com/PratimeshTiwari/Agent-CLI/pull/173) | Fixes from use: Canvas replies become files, whole-document rewrites become appends, replies end sooner |
| v9.9.3 | 11-08 | [#171](https://github.com/PratimeshTiwari/Agent-CLI/pull/171) | Thinking level follows effort |
| v9.9.2 | 11-08 | [#170](https://github.com/PratimeshTiwari/Agent-CLI/pull/170) | Conversations are one folder each |
| v9.9.1 | 11-08 | [#169](https://github.com/PratimeshTiwari/Agent-CLI/pull/169) | `/theme amoled`, `/files`, and a README inside `.agent/` |
| v9.9 | 11-08 | [#168](https://github.com/PratimeshTiwari/Agent-CLI/pull/168) | Jira and Confluence Cloud by browser sign-in |
| v9.8 | 11-08 | [#167](https://github.com/PratimeshTiwari/Agent-CLI/pull/167) | Small fixes; Node 22 or newer; the README's disclaimer |
| v9.7 | 11-08 | [#166](https://github.com/PratimeshTiwari/Agent-CLI/pull/166) | A locked model is never picked; Gemini Auto accounts work |
| v9.6 | 11-06 | [#164](https://github.com/PratimeshTiwari/Agent-CLI/pull/164) | A repo's `.mcp.json` waits for your yes; HTTP servers |
| v9.5 | 11-06 | [#163](https://github.com/PratimeshTiwari/Agent-CLI/pull/163) | `/update` is a menu; `/doctor` updates everything |
| v9.4 | 11-05 | [#162](https://github.com/PratimeshTiwari/Agent-CLI/pull/162) | Memory is a folder; prompt v6 |
| v9.3 | 11-05 | [#161](https://github.com/PratimeshTiwari/Agent-CLI/pull/161) | `/chrome`: one Chrome profile gets prompts |
| v9.2 | 11-05 | [#160](https://github.com/PratimeshTiwari/Agent-CLI/pull/160) | `/mcp add` |
| v9.1 | 11-05 | [#159](https://github.com/PratimeshTiwari/Agent-CLI/pull/159) | The model can call your MCP tools; prompt v5 |
| v9.0 | 11-05 | [#158](https://github.com/PratimeshTiwari/Agent-CLI/pull/158) | The MCP client, listed in `/mcp` |

<details><summary><b>v9.9.6</b> — small fixes</summary>

**Fixed**
- Shift+tab at an edit or command approval box changes the mode; it used to do nothing there. The
  box stays open and the key approves nothing. On current, the next prompt tells the model which
  mode it is in now, and the side panels follow.
- The edit approval box fits a short terminal: diff lines, then spacing, then the reason give way,
  never a choice, and the rest of the turn is charged for it. Its header counts the whole change;
  a box cut short said `+0 / -0`.

**Changed**
- The current prompt (v7) asks Gemini not to build in its Canvas or make interactive visuals,
  which take about 30 seconds and which the agent cannot read. +164 to +215 characters on turn 0.
- `marked-terminal` 8; bold and the other styles are its own. Node 22.12 or newer.
- Companion 1.8.18: in Cursor, which cannot put a view in the secondary side bar, the chat offers
  once to move there ("Move Chat to Another Side Bar").
</details>

<details><summary><b>v9.9.5</b> — one prompt</summary>

**Changed**
- Two prompt versions instead of six: **current** (v7: the leaner wording plus "look before
  answering") and **original** (v1, frozen, kept to compare against). `/prompt` is two rows.
- Jira, MCP servers and memory are features, on both versions, each silent until set up. They
  needed v4, v5 and v6 before.
- A new install starts on current. A setting of v2 to v6 now means current; someone who never
  chose stays on original, and the status bar says `v1`.

**Removed**
- `/mcp`'s "Use prompt v5" row and `/jira`'s "`/prompt v4` offers it": there is nothing to switch.
</details>

<details><summary><b>v9.9.4</b> — fixes from use</summary>

**Fixed**
- A document Gemini wrote into its Canvas was lost: the Canvas is a frame the agent cannot read.
  The reply now says so in place, and the agent asks once for it as a file.
- An `edit_file` that rewrote a whole document only to add to its end now runs as an append, so
  auto mode no longer stops on it as a risky rewrite.
- A reply ends about 1.5 s sooner per round: Gemini's copy row under a finished reply is taken as
  the end, instead of waiting for two seconds of quiet (#104).
- `npm test` no longer writes into the repo's prompt files, which showed as "modified externally"
  rows in a running agent.

**Changed**
- The README's warning says plainly what is at risk: use a separate Google account, not your main
  or workplace one.
</details>

<details><summary><b>v9.9.3</b> — thinking level</summary>

**Added**
- Each prompt asks the tab for Low, Medium or High: `same as effort` by default, and
  `/effort thinking <level>` pins one. A level chosen is set at once.
- `/effort`, `/settings`, both panels and the status bar show it. An account whose picker has no
  levels shows none of it; a locked level is listed and refused.
</details>

<details><summary><b>v9.9.2</b> — conversation folders</summary>

**Changed**
- `.agent/conversations/<id>/` holds a conversation's turns, its Gemini chat and its plans, where
  `sessions/` spread one over four places. Starting a new one copies nothing, and `--resume` files
  the one in progress instead of overwriting it.

> [!NOTE]
> The first start moves the old layout, in the repo and in the home copy, once. Leftovers such as
> `history 2.jsonl` go to `~/.agent/trash/`.
</details>

<details><summary><b>v9.9.1</b> — amoled and /files</summary>

**Added**
- `/theme amoled`: true black for an OLED screen, in the terminal and both panels.
- `/files`: where this project's things are, each a link. `.agent/` holds a README saying what each
  folder is and what is safe to delete.

**Changed**
- On an account with only Auto, `/effort` says so and names the locked models.
</details>

<details><summary><b>v9.9</b> — Atlassian by browser sign-in</summary>

**Added**
- `agent atlassian login` opens Atlassian's page: no site, email or token. Jira and Confluence Cloud
  arrive through Atlassian's own MCP server, a built-in `/mcp` row.
- Every write still asks, in every mode, with no switch or "always". `--token` keeps the old sign-in
  for Server / Data Center.
</details>

<details><summary><b>v9.8</b> — small fixes</summary>

**Fixed**
- `/mcp` no longer prints React's duplicate-key warning on Jira's page (#165).
- A fast double ↓ in a menu moves two rows.

**Changed**
- Node 22 or newer.
- The README opens with a disclaimer: for development and learning only.
</details>

<details><summary><b>v9.7</b> — locked models</summary>

**Fixed**
- A locked model is never picked or clicked. On a Gemini Auto account every rung lands on Auto, and
  the prompt follows the setting.
</details>

<details><summary><b>v9.6</b> — repo MCP servers and HTTP</summary>

**Added**
- A repo's `.mcp.json` runs nothing until you allow it, per folder and per entry; any edit asks
  again.
- MCP servers can be HTTP, with headers.
</details>

<details><summary><b>v9.5</b> — /update menu</summary>

**Changed**
- `/update` is a menu: pull, and install the companion in the editors you pick.
- `/doctor` can update every package, inside their ranges or to latest.
</details>

<details><summary><b>v9.4</b> — memory folder</summary>

**Changed**
- One fact per file, with who wrote it, when and why, and writes that cannot overwrite another
  agent's. `memory.md` is imported.
- Prompt v6 lists an index, saves without re-teaching the chat, and asks to save a correction.
</details>

<details><summary><b>v9.3</b> — one Chrome profile</summary>

**Fixed**
- Every extension used to get every prompt, so two profiles meant two accounts. `/chrome` opens the
  chosen profile on a one-use link and pairs with it; nothing else is admitted, and a closed profile
  makes prompts wait.
</details>

<details><summary><b>v9.2</b> — /mcp add</summary>

**Added**
- Paste a server's command or JSON, name it, give what it needs, see the command, test it once,
  save. Tokens go to the Keychain or a 0600 file; a server reads only its own.
</details>

<details><summary><b>v9.1</b> — MCP tools for the model</summary>

**Added**
- `mcp_describe` and `mcp_tool` on prompt v5. Each tool is ask, auto or block: ask shows a box, auto
  runs in plan and auto mode and still asks in strict, block refuses.
- Calls that need no box run together; esc cancels a running call. Results are labelled as data and
  secrets in them are hidden.
</details>

<details><summary><b>v9.0</b> — MCP client</summary>

**Added**
- Stdio servers from `~/.agent/mcp.json`, Claude Code's format, started on the first `/mcp` and
  never at launch. A server that fails is a row saying why.
</details>

## v8 — Jira, CI, panels like the terminal · 2026-10-31 … 11-05 · [#142](https://github.com/PratimeshTiwari/Agent-CLI/pull/142)–[#157](https://github.com/PratimeshTiwari/Agent-CLI/pull/157)

**Highlights**

- **Jira** (`jira_issue`, prompt v4): every write is a Send / Don't send box, in every mode.
- The **side panel and VS Code chat** look and work like the terminal.
- **CI** runs the suite on every push, macOS and Linux × Node 22 and 24.
- A silent or **closed Gemini tab** is noticed and recovered on the same chat.
- The source tree is split into `backend/` and `frontend/`, each with a README.

| Release | Date | PR | Summary |
| --- | --- | --- | --- |
| v8.10 | 11-05 | [#157](https://github.com/PratimeshTiwari/Agent-CLI/pull/157) | A closed Gemini tab is noticed at once |
| v8.9 | 11-05 | [#156](https://github.com/PratimeshTiwari/Agent-CLI/pull/156) | Under a shared `.agent`, `task.md` lands in the repo's own folder; ctrl+o fixes |
| v8.8 | 11-05 | [#155](https://github.com/PratimeshTiwari/Agent-CLI/pull/155) | The panels rebuilt on the terminal's design |
| v8.7.1 | 11-03 | [#152](https://github.com/PratimeshTiwari/Agent-CLI/pull/152) | The companion's status-bar entry opens the chat wherever it lives |
| v8.7 | 11-02 | [#151](https://github.com/PratimeshTiwari/Agent-CLI/pull/151) | CI on every push; CLAUDE.md slimmed |
| v8.6 | 11-02 | [#150](https://github.com/PratimeshTiwari/Agent-CLI/pull/150) | The panels catch up: attach, stop, queue, footer |
| v8.5.2 | 11-02 | [#149](https://github.com/PratimeshTiwari/Agent-CLI/pull/149) | README images at full width |
| v8.5.1 | 11-02 | [#148](https://github.com/PratimeshTiwari/Agent-CLI/pull/148) | Panel screenshots show their host |
| v8.5 | 11-02 | [#147](https://github.com/PratimeshTiwari/Agent-CLI/pull/147) | READMEs redesigned; `agent --help`; a failed subagent's row |
| v8.4 | 11-02 | [#146](https://github.com/PratimeshTiwari/Agent-CLI/pull/146) | `backend/` and `frontend/` split |
| v8.3 | 11-02 | [#145](https://github.com/PratimeshTiwari/Agent-CLI/pull/145) | The docs match the code |
| v8.2 | 11-02 | [#144](https://github.com/PratimeshTiwari/Agent-CLI/pull/144) | A tidier root: the CHANGELOG moves to `docs/` |
| v8.1 | 11-01 | [#143](https://github.com/PratimeshTiwari/Agent-CLI/pull/143) | Jira; prompts go only into this session's chat |
| v8.0 | 10-31 | [#142](https://github.com/PratimeshTiwari/Agent-CLI/pull/142) | Two silent minutes resend once in a fresh tab; cleaner rows |

<details><summary><b>v8.10</b> — closed tab</summary>

**Fixed**
- A turn waiting on a closed tab ends with one line and the chat's link, and the message rides in
  front of the next one, which reopens the chat. Idle, it is a row; between rounds of tools the turn
  goes on.
- With no Chrome window left the chat opens in a new window. That was "failed to reopen".
</details>

<details><summary><b>v8.9</b> — scoped artifacts</summary>

**Fixed**
- Under a shared `.agent`, `task.md` and other prompt-named paths reach the repo's own folder, and
  plan mode stops asking for them. A stray `.agent` is no longer taken for a root, and its files come
  back.
- ctrl+o answers when there is no list, and shows the list during a turn.
</details>

<details><summary><b>v8.8</b> — panels like the terminal</summary>

**Changed**
- Mode and effort menus in the composer, a `/` palette, `●` and `⎿` rows, a timed working row,
  image thumbnails, and a footer that follows the tab.
</details>

<details><summary><b>v8.7</b> — CI</summary>

**Added**
- The suite on every push and PR, macOS and Linux × Node 22 and 24, each test capped at two
  minutes; tests that fail when `service-worker.js` or the `.vsix` is stale.

**Fixed**
- On Linux, a temp dir's `.agent` in the shared `/tmp` was adopted as a state root.

**Changed**
- CLAUDE.md cut to about 140k characters; its history moved to `docs/history.md`.
</details>

<details><summary><b>v8.6</b> — panels catch up</summary>

**Added**
- Attach files with a paperclip, stop with the button or esc, queue messages during a turn, a footer
  with effort, model and context.

**Fixed**
- esc in the terminal stops the Gemini tab too.

**Changed**
- The VS Code chat moves to the secondary side bar on 1.106+ (Antigravity IDE).
</details>

<details><summary><b>v8.5</b> — READMEs and --help</summary>

**Added**
- `agent --help` lists the shell commands; `agent doctor --test` runs the suite.

**Changed**
- READMEs redesigned around pictures. A failed subagent's row reads `could not run · doing it in this
  chat · <why>`.
</details>

<details><summary><b>v8.1</b> — Jira</summary>

**Added**
- `jira_issue`: read, search, create, update, comment, move and attach, Cloud and Server/DC. Every
  write is a Send / Don't send box, with no "always". `agent atlassian login` keeps the token in the
  Keychain.
- `/prompt` shows what each version adds to the one before.

**Fixed**
- A prompt goes into this session's chat or nowhere: the tab is moved back first, and if it cannot
  be, a warning names `/chat <link or id>`.
- A subagent keeps its tab for its session, and its failure no longer ends your turn.

**Changed**
- The extension reloads itself when the checkout is newer.
</details>

<details><summary><b>v8.0</b> — silent retry</summary>

**Fixed**
- Two minutes without reply text resends the prompt once, in a fresh tab on the same chat.

**Changed**
- Table rows get a dotted rule when any row wraps; a call with wrong arguments reads
  `wrong arguments · query missing`.
</details>

## v7 — fresh chats, honest traces · 2026-10-30 … 10-31 · [#131](https://github.com/PratimeshTiwari/Agent-CLI/pull/131)–[#141](https://github.com/PratimeshTiwari/Agent-CLI/pull/141)

**Highlights**

- A new session starts in a **new Gemini chat**, and a reopened tab goes back to its conversation.
- A message the tab **failed to send** is carried to the next one, never lost.
- Before compacting it **asks**: compact now, or continue in this chat.
- Test, lint and build commands are **detected** from the project.
- Prompt **v3**: look before answering, on low and medium.

| Release | Date | PR | Summary |
| --- | --- | --- | --- |
| v7.10 | 10-31 | [#141](https://github.com/PratimeshTiwari/Agent-CLI/pull/141) | Token count climbs live; failed sends carried and retried once |
| v7.9 | 10-31 | [#140](https://github.com/PratimeshTiwari/Agent-CLI/pull/140) | Fresh chat per session; model mismatch is the footer's `⚠`; prompt v3 |
| v7.8 | 10-31 | [#139](https://github.com/PratimeshTiwari/Agent-CLI/pull/139) | Right-click → Attach to Agent CLI in the editor |
| v7.7 | 10-31 | [#138](https://github.com/PratimeshTiwari/Agent-CLI/pull/138) | The `/doctor` revert guard, tested end to end |
| v7.6 | 10-31 | [#137](https://github.com/PratimeshTiwari/Agent-CLI/pull/137) | A partial read of code lists the definitions it did not show |
| v7.5 | 10-31 | [#136](https://github.com/PratimeshTiwari/Agent-CLI/pull/136) | Asks before compacting |
| v7.4 | 10-31 | [#135](https://github.com/PratimeshTiwari/Agent-CLI/pull/135) | Project commands detected |
| v7.3 | 10-31 | [#134](https://github.com/PratimeshTiwari/Agent-CLI/pull/134) | `/logs speed` by context fill |
| v7.2 | 10-31 | [#133](https://github.com/PratimeshTiwari/Agent-CLI/pull/133) | Traces say how the prompt was typed (#104) |
| v7.1 | 10-31 | [#132](https://github.com/PratimeshTiwari/Agent-CLI/pull/132) | A formula is scraped once, as its TeX |
| v7.0 | 10-30 | [#131](https://github.com/PratimeshTiwari/Agent-CLI/pull/131) | READMEs lead with pictures |

<details><summary><b>v7.10</b> — failed sends</summary>

**Fixed**
- A message the tab failed to send goes in front of the next one; a lost first prompt is sent again
  in full.
- A send that fails is retried once, in the same chat in a fresh tab, then says one line and the
  chat's link.

**Changed**
- The spinner's token count climbs while Gemini writes.
</details>

<details><summary><b>v7.9</b> — fresh chat</summary>

**Added**
- Prompt v3: v2 plus "look before answering", and one ask when a reply promises to look and makes no
  call.
- `/settings` names the Gemini tab. shift+enter and ctrl+n are newlines.

**Fixed**
- A fresh session starts in a new chat; a reopened tab returns to its conversation; a new chat is
  asked for twice.
- ↑/↓ move by drawn row and keep the draft.

**Changed**
- A model mismatch is the footer's `⚠`, seen as soon as the tab changes, and asks to match the agent
  or the browser.
</details>

## v6 — symbols in every language, log exports · 2026-10-30 · [#105](https://github.com/PratimeshTiwari/Agent-CLI/pull/105)–[#130](https://github.com/PratimeshTiwari/Agent-CLI/pull/130)

**Highlights**

- `find_symbol` and `find_references` read **Ruby and every common language**, measured against
  each language's own parser.
- `query_log` reads **Grafana, Loki and Datadog exports** of any size.
- A **large file** is read by a subagent; the main chat gets a digest.
- **Drag and drop** files into the side panels.
- Lean menus and rows in **Claude Code's shape**; `?` shows the keys.

| Release | Date | PR | Summary |
| --- | --- | --- | --- |
| v6.25 | 10-30 | [#130](https://github.com/PratimeshTiwari/Agent-CLI/pull/130) | Long dropped paths in VS Code become tags |
| v6.24 | 10-30 | [#129](https://github.com/PratimeshTiwari/Agent-CLI/pull/129) | A wrong option lists the valid ones |
| v6.23 | 10-30 | [#128](https://github.com/PratimeshTiwari/Agent-CLI/pull/128) | C++ and React symbols measured; VS Code drops |
| v6.22 | 10-30 | [#127](https://github.com/PratimeshTiwari/Agent-CLI/pull/127) | Status bar gutter; `/context` wording |
| v6.21 | 10-30 | [#126](https://github.com/PratimeshTiwari/Agent-CLI/pull/126) | Symbols in every common language |
| v6.20 | 10-30 | [#125](https://github.com/PratimeshTiwari/Agent-CLI/pull/125) | `query_log` |
| v6.19 | 10-30 | [#124](https://github.com/PratimeshTiwari/Agent-CLI/pull/124) | Ruby references 99.5% precise; Rails production blocked |
| v6.18 | 10-30 | [#123](https://github.com/PratimeshTiwari/Agent-CLI/pull/123) | `?` shows the keys |
| v6.17 | 10-30 | [#122](https://github.com/PratimeshTiwari/Agent-CLI/pull/122) | Drag and drop in the side panels |
| v6.16 | 10-30 | [#121](https://github.com/PratimeshTiwari/Agent-CLI/pull/121) | A large file is read by a subagent |
| v6.15 | 10-30 | [#120](https://github.com/PratimeshTiwari/Agent-CLI/pull/120) | Compaction keeps the last 3 exchanges |
| v6.14 | 10-30 | [#119](https://github.com/PratimeshTiwari/Agent-CLI/pull/119) | A partial Markdown read lists the headings it did not show |
| v6.13 | 10-30 | [#118](https://github.com/PratimeshTiwari/Agent-CLI/pull/118) | A quieter status bar |
| v6.12 | 10-30 | [#117](https://github.com/PratimeshTiwari/Agent-CLI/pull/117) | Replies fit the terminal |
| v6.11 | 10-30 | [#116](https://github.com/PratimeshTiwari/Agent-CLI/pull/116) | `/prompt` compares the versions |
| v6.10 | 10-30 | [#115](https://github.com/PratimeshTiwari/Agent-CLI/pull/115) | `/prompt` opens a menu |
| v6.9 | 10-30 | [#114](https://github.com/PratimeshTiwari/Agent-CLI/pull/114) | The companion carries the new action rows |
| v6.8 | 10-30 | [#113](https://github.com/PratimeshTiwari/Agent-CLI/pull/113) | Ruby symbols |
| v6.7 | 10-30 | [#112](https://github.com/PratimeshTiwari/Agent-CLI/pull/112) | A greeting no longer ends on a plan review |
| v6.6 | 10-30 | [#111](https://github.com/PratimeshTiwari/Agent-CLI/pull/111) | Time between turns measured (#104) |
| v6.5 | 10-30 | [#110](https://github.com/PratimeshTiwari/Agent-CLI/pull/110) | Action rows in Claude Code's shape |
| v6.4 | 10-30 | [#109](https://github.com/PratimeshTiwari/Agent-CLI/pull/109) | The question prompt in Claude Code's layout |
| v6.3 | 10-30 | [#108](https://github.com/PratimeshTiwari/Agent-CLI/pull/108) | Lean menus |
| v6.2 | 10-30 | [#107](https://github.com/PratimeshTiwari/Agent-CLI/pull/107) | List text readable again (#103) |
| v6.1 | 10-30 | [#106](https://github.com/PratimeshTiwari/Agent-CLI/pull/106) | Settings wait for Apply |
| v6.0 | 10-30 | [#105](https://github.com/PratimeshTiwari/Agent-CLI/pull/105) | `/update pull` restores the lockfile (#102) |

## Before v6

[`changelog/v1-v5.md`](changelog/v1-v5.md), unchanged. In short:

- **v5** (10-19 … 10-28, #63–#101): the Claude Code-style terminal (themes, first-start setup,
  menus as one panel, images and drops as tags), three modes, versioned prompts, documents read as
  Markdown, `/doctor`, and the VS Code chat panel.
- **v4** (09-27 … 10-19, #60–#62): the failure log counts failures, not events; the rename to
  Agent-CLI.
- **v3** (09-22 … 09-27, #26–#59): the model picker, chased through seven extension releases to a
  missing relay case.
- **v2** (09-20 … 09-22, #17–#25) and **v1** (09-16, #13–#16): prose is not a tool call, resume
  reaches the browser.
- **Betas** (08-26 … 09-06, #1–#12): the bridge, subagents, `.agent/`.
