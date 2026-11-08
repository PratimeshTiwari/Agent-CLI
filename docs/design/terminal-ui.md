# The terminal UI

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Where `.agent/` actually is

**Exit clears and prints `agent --resume <id>` (v5.4, `frontend/screen/farewell.js`; kept the transcript in
v5.20–v5.22; since v5.23 it erases back to the shell line that launched it, nothing at all when
there was no conversation).** Startup asks the cursor row (`ESC[6n`) before the first frame and no
longer `console.clear()`s; `frontend/screen/screen-span.js` follows every byte written (stdout.write is wrapped)
and moves that row up on each scroll; exit asks again and rewinds only if the two agree — else (the
launch line scrolled off, ctrl+e cleared, no answer) it clears screen and scrollback and puts the
footer at the top. The reports are matched out of stdin before Ink sees them. The pty driver answers
`ESC[6n` from a live pyte screen (`NO_DSR=1` for the fallback). An *exact* Claude Code exit for a
session longer than one screen needs the alternate screen, which costs native scrollback. Every way out — a double ctrl+c, `/exit`, SIGINT, SIGTERM — calls Ink's `clear()`
(erases only the live frame and syncs its log, so the final render on unmount writes nothing),
unmounts, clears screen and scrollback, then prints Claude Code's footer at the top (v5.21: `Resume this session with:` and the command on
a line of its own, dim, flush left, the shell prompt directly under it) — or nothing, when there was
no conversation. Dim is gated on a TTY, not on `NO_COLOR`, as the `mono` palette is. The id is
`SessionStore.liveId()`: the conversation's folder name from its first turn, and used by
`rollover`, so the id at exit is the id in `/history`; `--resume <live id>` before it is filed
behaves as `--continue`, and a resumed conversation keeps its id (`listSessions` keeps the
newest row per id). **ctrl+c is no longer Ink's** (`exitOnCtrlC: false`): Ink's handler
unmounted the app and left the process alive behind a frozen prompt, measured under the pty.
The second press is decided in cli-ui on the raw stream (`interruptGate`), below React, so a
broken render cannot trap anyone; App only clears the prompt and shows the hint where `/help`
sits.

## Queued prompts

**Prompts typed during a turn are queued, not dropped.** `handleUserMessage` returns early
when busy, pushing a transient status line the thinking cycle paints over — and by then
`handleSubmit` has echoed the message into the transcript and cleared the input box. It looked
sent, the text was gone, and nothing would ever answer it. Reported as four prompts typed and
one reply. `queuedUserMessage` had sat on the loop as a field that nothing read or wrote.

The queue lives in the UI, because that is where the transcript and the marker are, and
because "one turn at a time" is the contract that keeps the loop tractable. Busy is read from
`agentLoop.isProcessing`, never React's copy — `handleSubmit` sets that itself. Draining is
gated on the loop being idle *and* no diff prompt or menu being open, because the two flags
disagree during an approval and draining then injects a prompt into a turn parked on a
decision. `:stop` empties the queue, or stopping is followed instantly by the next prompt.

**And the drain is woken by the loop, not by a render (v5.8).** Reported twice: a queued prompt
sat at "queued" until ↑ brought it back. `agentLoop.isProcessing` is not React state, so its
turning false caused no render, and when React's copy was already false (a diff prompt, or prose
with tool calls — v5.5) the turn ended with no state change at all. `isProcessing` is an accessor
now and `onIdle` fires on its busy → idle edge from any of its eleven writers; App drains on it and
lowers its own flag. Pty: a prompt queued during a diff turn is sent unprompted; on `main` it
never is. v5.5 alone already fixes that scenario — this makes it independent of every path
getting the React flag right.

**Up-arrow takes a queued prompt back** when the box is empty — press enter and it rejoins the
queue, press nothing and it is gone, which is the cancel nobody had to invent a key for. Only
when the box is empty: half a typed sentence must not be replaced by something queued a minute
ago.

**`ctrl+x ctrl+s` steers instead (v5.23).** Asked for on 2026-10-25: queue by default, steer on
request. The last queued prompt goes to `AgentLoop.steer`; the next tool-results prompt carries it
as `<user_steer>` with a one-line explanation inline (not in the system prompt — rare, and that is
the payload kept small), and the loop records a `type: 'steer'` turn drawn as `↳ steered:`. A turn
that ends with no further tool round never builds that prompt, so the idle edge hands the steer back
(`takeSteers`) as the next message — first in line. `noteUserStop` drops steers;
`abortExtensionWork` does not, because it also runs on error paths where the message is still
wanted. Both bytes are in `HOTKEYS` (raw mode clears IXON, so ctrl+s arrives instead of freezing
the terminal), and `chordGate` allows 1.5 s between them. Pty: delivered, drawn, and the fallback
sent as a message; 0 clears at 10, 13, 24 rows.

## From Gotchas

- `App.jsx` is performance-sensitive: it avoids re-rendering during streaming to prevent
  terminal tearing. Bold is `marked-terminal`'s: v8 strips an escape byte written into the text,
  which left `[1m` on screen (v9.9.6). It was split into `frontend/` modules by moving blocks verbatim
  behind explicit dependency lists; the `<Static>` element, `staticEpoch` and the streaming
  path stayed in `App.jsx` deliberately, and adding memoization to the transcript rows is how
  the scroll glitches came back the last two times.

- **A local command must not touch a running turn.** `handleSubmit` set
  `isProcessing` and cleared `activeToolCalls` before looking at what was
  submitted, and every slash handler ends with `setIsProcessing(false)` — so
  typing anything starting with `/` mid-turn wiped the live turn's rows and
  then declared it finished while the loop carried on. Reported as `/efforttt`
  during a turn and "the agent stopped responding and did not output the
  result": it had not stopped, it had run the tool calls and produced the
  answer. `turnInFlight` is read from **`agentLoop.isProcessing`**, not from
  React's copy, which this very function sets true. Pinned by a source
  assertion, because observing it needs a live turn under the pty harness and
  because moving two `set…` calls back above the branch reads as tidying.

  **The transcript advances on `agent_response` and on every `tool_result`
  (v5.14).** It used to advance only on `agent_response`, which is sent only
  when a reply has prose left after the tool calls are stripped — so a round
  that was *only* tool calls left the screen as it was, and finished calls sat
  in the live list as `✔ name` while an earlier merge drew the same calls
  above them as `⏺ name args · result`. Twice per call, and the duplicate was
  charged to no budget: 28 full clears at 13x72 with a prompt queued, 6 at
  16x72. The loop pushes the call and result turns *before* it sends
  `tool_result`, so the handler merges and removes that call by name (parallel
  calls finish out of order; results used to land on the last row). The live
  list holds only running calls, shares the turn's rows, and gives way first
  — the thinking line already names the tool. 0 clears from 10 to 40 rows.

- **An instant local command must not raise a spinner it takes down again.**
  Reported with a screenshot: a `Thinking… (0s · ↑ 29.4k tokens · esc to stop)`
  row sitting above `❯ /paste-image` and another above `❯ /image`, both frozen
  at 0s, permanently in the scrollback. `handleSubmit` set `isProcessing(true)`
  for *anything* starting with `/`, and every handler ends by setting it false —
  so an instant command drew the live row, committed its own output to
  `<Static>` in between, then shrank the live frame, stranding the row above the
  static write where Ink can never repaint it. **Above** the command, because it
  was drawn before the rows it ends up sitting on. `SLOW_COMMANDS`
  (`core/turn/slash-commands.js`) is the gate. A set beside the commands rather than
  a literal at the call site, because the literal is what drifts.

  **`isSlowCommand(command, args)` takes the args**, because one name can be two commands: `/update
  pull` is slow and gets the spinner; bare `/update` opens a menu and stays instant.

  **Never split a prompt across messages:** it triples the wait and saves nothing ([`docs/history.md`](../history.md#moved-from-claudemd-in-v992)).

- **A drop that arrives typed is a drop too (v6.23, `asBracketedDrop`).** VS Code's terminal types a
  dropped path in with no paste markers, so it stayed text. One stdin chunk of nothing but existing
  absolute paths is wrapped as a paste in `cli-ui.jsx`; `/help`, a missing path and a sentence are
  not. Pty (`{"raw": …}` step): `[File #1: drop-me.jsonl]`, 0 clears at 13 and 24 rows.
  **It arrives in pieces past 50 characters (v6.25, `createDropJoiner`).** VS Code's pty host
  writes input in pieces of at most 50, 5 ms apart (`chunkInput` in `ptyHostMain.js`), so a
  45-character `.dmg` path became a tag and a workspace path did not. A read whose length is a
  multiple of 50 and that starts like a path is held up to 30 ms and joined; typing never
  delivers 50 characters in one read. Pty (`{"vscode": …}` step, VS Code's own chunker): tag at
  13 and 24 rows, 0 clears; `main` sends the quoted path. **Antigravity's agent panel takes image,
  PDF and video drops for the whole window** (`dragover`/`drop` on `window`, `stopPropagation`),
  so those never reach its terminal while that panel is open — paste the path instead (a paste
  of an existing path is a drop), or **right-click → Attach to Agent CLI (v7.8, companion
  1.8.7)**: the companion appends `{paths}` to `chat-queue.jsonl` and `drainChatQueue` returns
  `{drop}`, which goes through `attachDropped` like any drop. A menu command cannot be taken by a
  panel's `drop` handler. Missing files are skipped, at most 20. Pty (a `{"write"}` step into
  the queue): tags at the caret, the prompt holds headers and no file text, 0 clears at 13 and 24.

- **A dropped file is a tag too (v5.33, `frontend/input/file-drop.js`).** A terminal has no drop event: a drop
  is a bracketed paste of paths. It counts only if **every** piece is an existing absolute path
  (`/…`, `~/…`, `file://…`) — a relative word like `package.json` pasted into a sentence stays
  text. Images go through `loadImage` and become `[Image #n]`; anything else is
  `[File #n: name]` / `[Folder #n: name]`, with one header line per file in front of the message
  (`[File #2: big.js] (6 KB, 1,200 lines) — read it with read_file`) and **never the content**:
  the model reads the range it needs. Backspace takes the tag (`backspaceAt` knows all three),
  and the sent message draws `⎿ [File #2: big.js]` as an OSC 8 link (`foldFiles`). Inlining small
  files was planned and is not built: it would save a round trip only if `/logs tools` says
  dropped files are read whole. Pty (`{"paste": …}` step in drive2.py): a folder, a 1,200-line
  file and an image at 13 and 24 rows, 0 clears; the prompt holds headers and no file text.

- **An image is a tag in the prompt, Claude Code's way (v5.24, `frontend/input/image-attach.js`).**
  ctrl+v (or cmd+V with an image and no text on the clipboard) puts `[Image #n]` at the caret;
  an image goes with a message only while its tag is in the text, so backspace — which takes a
  tag in one press — is how it comes off. `/image` and `/paste-image` are gone, and so is the
  status-bar count: the tag *is* the representation. Each image is sent as a
  `[Image #n: <path>] (KB, mime)` header plus its `<image_data>` block; the tab lifts every
  block out and pastes the files **on their own, before the text**, and no longer waits five
  seconds for a text paste that could never land because an image was in it. The record keeps
  the header without the data, which is what lets the sent message draw `⎿ [Image #n]` rows
  as OSC 8 links to the file (cmd+click — not mouse tracking) on a resume too.

  **Two races had to go before a tag survived the next key.** The field's handlers edited the
  *render's* `value`, so on a busy event loop several keys landed between renders and each
  edited the same stale text; and `cli-ui` dispatched chords before the text in the same chunk.
  Under the pty, `look at` + ctrl+v + `please` sent `look atplease` with no image. `PromptInput`
  now reads `live` (text and caret, ahead of the render) and takes outside text through
  `cursorRef.apply`; `dispatchInOrder` writes text, then defers everything after it a turn, so
  Ink has read it before the chord runs. **A component that reads its props inside an input
  handler is a stale closure waiting for a slow frame.**

- **A word a command does not take stops it (v6.24, `COMMAND_OPTIONS` / `invalidOption` in
  `core/turn/slash-commands.js`).** `/update ayz` ran the update check, and twelve commands answered a
  wrong word as if it were absent — `/subagents zzz` printed the status, which reads as a
  confirmation. Checked before dispatch (and before a destructive confirm), it names the word and
  lists every form with what it does. Free-text commands are absent from the table. A live action
  row is spaced like a committed one when `spaceLive` says the budget holds it, so the newest read
  no longer sits tight and then jumps. Pty: 0 clears at 13, 24 and 30 rows.

- **A setting reply is one line (v5.25, `changed()` in `core/turn/slash-commands.js`).** `⚙ <setting>
  **from** → **to**`, or `already **x**`, plus at most one `·` clause the status bar does not
  already say — owner's words: "subagent on -> off or already off/on". No emoji and no paragraph:
  the reply sits in the scrollback for the rest of the session. A setting that did not change does
  not call `resetPromptState()`, which would spend a full turn-0 payload to change nothing.

- **A menu opened from `/settings` must not answer in the transcript.** `returnTo` is the
  settings page, so setting it back reopens that page *on top of* whatever the command just
  said. Four screens did this — `/effort`, `/config`, and two on the allowlist — and the
  symptom is a setting that changes with no sign it did. `applyAndReturn` in `Menus.jsx` is
  the one rule: go back and say nothing (the row is the confirmation and re-reads live
  state), or close and let the transcript answer. And a menu that mutates shared state needs
  a fresh `activeMenu` object — `commandRules` is shared by reference, so the values were
  already right and React simply had no reason to repaint.

- **The live frame must never outgrow the viewport.** This is the single most important rule in
  `frontend/`. When Ink's dynamic output is taller than the terminal, `shouldClearTerminalForFrame`
  (`ink/build/ink.js`) switches it to writing `ESC[2J ESC[3J` plus a full repaint on *every*
  render. Measured on the pre-fix code, sitting idle with a 12-turn history in a 24-row
  terminal: 108 full clears and 108 scrollback wipes in 15 seconds, 3.85 MB of escape codes.
  That is what "it flickers and I can't scroll or copy" was — the terminal's scrollback and the
  user's selection were being deleted seven times a second. The same shape is now 36 KB and
  zero clears. So: settled turns go to `<Static>`, only the in-flight turn is live, and every
  live row is bounded by `liveBudget` (`terminalHeight - RESERVED_ROWS`). Adding an unbounded
  row to the live region — a full tool result, an artifact dump, a list that grows — brings the
  whole thing back.

  **And it can overflow from below, which is newer.** `liveBudget` has a floor, so the frame had
  a *minimum* height of `RESERVED_ROWS + 3 = 12` rows and any shorter terminal overflowed however
  much the in-flight turn gave up. Measured, one turn, extension connected: 13 rows → 0 clears,
  12 → 1, **10 → 166**. Three of the nine reserved rows are pure spacing, so below
  `COMPACT_BELOW_ROWS` (13) they are dropped and the floor comes down with them — spacing is what
  gets shed, never a row carrying information. That moves the floor to 9 rows; 8 still costs
  thirty clears, which is now a documented limit rather than a silent one. Asked whether
  *resizing* glitches: it does not — a drag firing five SIGWINCH events produces exactly one
  debounced reprint, and the control run that never resizes is identical.

  **The floor is one row now, and used to be three.** `Math.max(3, …)` never meant "at least
  three if there is room" — it meant three even when there is not, and the frame then asks
  for more rows than the terminal has. It was the bug twice: once from the furniture above,
  and again when `/update`'s two notice rows reproduced it at 13 rows (9 + 2 + a floored 3 is
  14). Whenever there *is* room the subtraction already yields more than three, so the floor
  only ever bound in the case where binding it was wrong.

  **The live reply is budgeted too, in wrapped rows.** `liveMessageText` (`live-layout.js`, so a
  plain `node --test` can import it) clamps it at the terminal's real width and says
  `… +N more lines`; the committed copy in `<Static>` is whole. Unclamped, only the top of a long
  reply survived the repaint, and a first clamp that counted `\n` changed nothing. **A clamp
  measured in the wrong unit reads as a fix and behaves as nothing.**

  **A row you draw is a row you budget, and a row that wraps is two.** `/update`'s reload
  notice was ~105 characters, which wraps at 80 columns: charged as one row, drawn as two,
  and 1 `ESC[2J` at 13x80 and 10x80 where there had been none. `wrap="truncate"` on anything
  in the live frame is load-bearing, not tidiness. The arithmetic test caught the first of
  these; only the pty run caught the second.

- **Nothing the user waits for goes in front of the first frame.** Startup was
  2.46s to the prompt box, and almost none of it was work: `main.js` awaited the
  1.5s extension-greeting timeout and then the GitHub agent's start (since
  removed) before it created the Ink UI. Neither answer is something the first
  frame draws. Moving both behind `cli.start()` took the same measurement to
  **0.53s**, with no behaviour change. For scale, every module
  import in the process is 517ms together, 426ms of it ink+react, and `tsx`
  itself is 120ms — so the two waits were larger than the entire program.
  `test/backend/core/startup-order.test.js` pins the ordering, because the regression is
  invisible in review: one more `await` before `cli.start()` reads as ordinary
  sequencing and costs a second every launch, with no failure to notice.

- **The startup look is Look A (v5.22, chosen 2026-10-25 from
  `.agent/artifacts/plans/2026-10-25-startup-look.md`).** A four-row `❯` mark in block characters
  with name, byline, workspace and `/help` beside it (`Banner.jsx` `Header`), replacing six rows of
  figlet — `figfont.js`, `banner-text.js` and `Standard.flf` are deleted. The input is ruled above
  and below with no sides (`borderLeft/Right={false}`), so a drag-select no longer copies `│`; same
  three rows. The mode line carries Claude Code's glyphs (`MODE_GLYPHS`: `⏸` `⏵⏵` `⏹`), which v5.20
  had removed as rendering badly — chosen back knowingly; the plan's M3 set is the fallback. The
  header's text column needs an **explicit width**: inside `<Static>` Yoga sizes it to content and
  `wrap="truncate"` then wraps instead. `/copy` (same release) copies the last reply's markdown.

- **The header draws in on every start, and exit says goodbye (v5.23, `frontend/screen/intro.js`,
  `components/Intro.jsx`).** `Root` shows `Intro` — the banner with a `frame`: the mark sweeps in,
  the name types out, the dim lines arrive, ~440 ms — then mounts App, whose `<Static>` writes the
  same header at the same position. On exit `farewell.js` awaits the registered outro (capped at
  `OUTRO_CAP_MS`): App swaps its live frame for `❯ Goodbye.`, then the clear and the footer.
  **App must draw the goodbye itself** — swapping App out for it left Ink laying out the Static App
  had owned, ~90 blank rows a frame, the transcript pushed off screen. TTY only, ≥16 rows for the
  intro, off under `AGENT_CLI_NO_ANIMATION` or `CI`. Pty: 1 `ESC[2J` (the exit's own) at 13, 16, 24.

- **First-start setup runs instead of App, then App mounts (v5.22, `components/Onboarding.jsx`,
  `frontend/screen/welcome.js`).** Splash (the mark draws in, the greeting types out), theme (live preview), name (banner preview), Chrome
  (Load-unpacked steps with this checkout's real `extension/` path; spinner → `✔ Connected`).
  `Root` in `cli-ui.jsx` switches — never both mounted — so the banner App commits to `<Static>`
  has the chosen theme and name. "First" is `welcomed` absent from `~/.agent/settings.json` and an
  empty `~/.agent/workspaces/`; it is `'pending'` until setup ends (a ctrl+c halfway shows it
  again) and an install with history is marked `true` unseen. `main.js` must decide before
  `new AgentLoop` — the session store creates `workspaces/<slug>` — and `welcome.test.js` pins it.
  The screens are live frames: `onboardingLayout` drops the theme preview and the name preview, then
  spacing by height. Pty: 0 clears at 12, 16, 20, 30 rows.

- **A fixed-width glyph beside flexible text must be in a `flexShrink={0}` box (v6.12).** Yoga
  shrinks children in proportion to their natural width; a reply's is the whole paragraph on one
  line, so the reply's 2-column `● ` was rounded down to 1 and the reply laid out a column wider
  than the terminal. Each wrapped row spilled a character onto a row of its own, Ink counted fewer
  rows than the terminal drew, and a long reply left ~20 blank rows above the prompt. Replies are
  also wrapped by `fitLines` (`text.js`) now, to the width beside the dot, with bullets hanging
  at their text column — Ink kept the space it broke at and knew nothing of lists. The harness's
  `snap` is the raw stream with escapes stripped and invents blank rows; use `{"screen": file}`,
  pyte's rendered viewport, for anything about layout.

- **`?` as the whole input shows the keys (v6.18, `frontend/menus/keys-view.js`).** A grid of `KEY_HINTS`
  (two or three words each; every key must be one `/help`'s `KEY_ROWS` lists) in the `/` palette's
  place, 1–3 columns by width, filled down then across, charged `paletteRoom` rows like the palette;
  short of rows, the last cell is `/help`. Making it found the palette's own overflow: below 13 rows
  `paletteRoom` added 2 for the spinner and its margin, but the margin is shed there, so `/` drew
  one row too many and cleared the screen once at 10 rows (on `main` too). Pty: 0 clears for `/`
  and `?` at 10–13 rows, and at 24 rows × 60 and 120 columns.

- **The status bar is laid out in `frontend/screen/status-bar.js` (v6.13, Option A of
  `.agent/artifacts/plans/2026-10-30-status-bar.md`).** Quiet by default: only the mode glyph is
  coloured; `⚠`/`↓`, `N running` and the meter past 50% are attention, past 80% danger; the rest
  is dim. Bare values (`v2`, `medium`, `14%`), absent at default (prompt v1, context before the
  first message). `shift+tab to cycle` shows only before the chat's first message, while idle
  (owner: "show this at the start of chat only"). What gives way as it narrows is a fixed order
  (`shed` in `statusBarLayout`), tested at 30–120 columns; App only maps roles to colours. Pty:
  0 clears at 10, 13, 24 rows × 60, 90 columns.

- **A row in the live frame is truncated from the right, so put the part that
  must survive on the left.** The filed-session row read `↺ Previous
  conversation filed (2 turns) — --resume <28-char id>`, which is ~80
  characters: at 80 columns `wrap="truncate"` ate the end of the id and offered
  a `--resume` that resumes nothing. Leading with the id and trailing the prose
  costs nothing and degrades correctly — at 60 columns the sentence is cut and
  the command is still intact.

- **Colour is a role, never a name (v5.15, `frontend/theme.js`).** Components write `T.accent`,
  `T.attention`, `T.success`… and the palette picks the colour; `test/frontend/theme-tokens.test.js`
  fails on any `color="cyan"` or `'cyan'` in a `frontend/` component. About 86 call sites had named
  ANSI colours, and cyan alone meant six things. The only palette so far is `terminal`, which
  maps every role back to its old colour — verified under the pty as the same 19 on-screen
  styles and a byte-identical run. `T` is mutated in place, so a module-level table of colours
  (`DiffRows`' old `COLOUR`) must be read at render, not at import. Still literal, deliberately:
  the markdown renderer's colours (`marked-terminal`, configured once at load) and the banner
  gradient. The plan for the rest is `.agent/artifacts/plans/2026-10-24-ui-redesign.md`.
  **Palettes since v5.16:** `dark`, `light`, `dark-colorblind`, `light-colorblind` (Okabe–Ito
  blue/orange), `mono` (every role `null` — plain text), `amoled` (v9.9.1: dark's inks on `#000`; Ink paints no page, so
  `screen/terminal-bg.js` sets the terminal's with OSC 11 and OSC 111 resets it on a switch, exit or crash;
  the panels take it from `panel_state.theme`) and `terminal`, still the default. Each
  palette but `terminal`/`mono` names the background it was designed for in `PALETTE_INFO`, and
  a test holds every role to WCAG 4.5:1 against it (3:1 for `muted`). `/theme` previews by
  calling `setTheme` on highlight; esc restores `original`; enter saves to
  `~/.agent/settings.json` (`core/workspace/user-settings.js` — per person, not per repo) and reprints the
  transcript, because committed rows cannot be recoloured. `NO_COLOR` beats the saved choice.

- **Every menu is a `Panel` (v5.24, `frontend/menus/panel.js`, `components/Panel.jsx`).** Asked for 2026-10-26:
  the boxes "do not follow a common design theme". `/help`'s shape for all of them — a rule, a
  title, at most two dim lines, `Choices` (`❯`, a dim second column, `✔` on the current one,
  `1.`–`9.` where a digit may answer, never on an approval), one line of keys. No borders:
  `panel.test.js` fails on a `borderStyle` in `Menus.jsx`. `panelRoom` sheds spacing, then the
  description, never a choice. A menu opened **mid-turn** (`ask_question`) is charged like the
  approval box and hides the live turn — 25 `ESC[2J` at 13 and 16 rows before, 0 now; an idle
  menu also gets the spinner's rows. Menus at 13 rows: 13 clears on the previous commit, 0 now;
  10 rows is 8 (22 before), mostly at startup and on close. VS Code: start-up erases in place
  (`enterSequence`), because a command line scrolled off screen is pinned over the header by
  sticky scroll.

- **`/settings` is a list of switches (v5.27, Option C′, `frontend/menus/settings-view.js`,
  `components/SettingsList.jsx`).** The owner's pick from `.agent/artifacts/plans/2026-10-27-settings-redesign.md`.
  A row with `control` is a switch (`● on  ○ off`) or a ladder (`◂ high ▸`), and ←/→ set it in place
  through its own `restore` command, run in order (`settingsChain`), so the leaving summary still
  sees every change. ←/→ are spatial and never wrap. The hint is on the selected row and drops below
  70 columns. The filter stays on top, underlined; printable keys go to it, and **tabs are on tab
  only** now. Enter steps a switch or mode in place and opens a chooser only for Effort, Browser
  differs (v7.9: the bare `ask · follow · switch` ladder was "confusing even for me"), Startup and
  Command rules (`OPENS_CHOOSER`); bare `/effort mismatch` opens the same chooser. Values are plain except a switch's active state and a read-only
  `attention`; `Choices` no longer recolours the selected row's detail in any menu. Pty: 0 clears at
  13×90, 24×100 and 24×60.
  **Status → Gemini tab (v7.9)** names the tab the main lane types into and its chat
  (`tab 1873 · chat 17d6…`), from `tab_status`'s `mainTab`, which extension 1.55.0 sends on connect,
  on every heartbeat and on each Gemini load (`describeBrowserTab`; older builds say so). The value
  is an OSC 8 link to the chat (`browserTabUrl`, `link` on a settings row): cmd+click opens it.

- **A model mismatch is the footer's `⚠ 3.8 Flash` and nothing else (v7.9).** The row above the
  input went through two redesigns in one afternoon and was then cut (owner: "just show ⚠ 3 Flash,
  that's it nothing else"): the next message asks anyway, and the ask says both names. The footer's
  mark now shows at every height (`modelDiffers`; it went with the row below 13). The ask is two
  answers, **Match the agent** (switch the tab) and **Match the browser** (set the effort to the
  tab's rung, or send on it when no rung maps); "Send on 3.8 Flash" once was the confusing third.
  The Effort slider adds `⚠ browser 3.8 Flash` beside the marked stop's model (`tabDiffers`). **A
  model picked by hand in the tab is seen in ~1.5 s** (extension 1.55.0): the bridge watches the
  picker's label (`currentModelLabel`, no menu) and sends `model_selected`; `noteSelectedModel`
  marks the one entry it names, exactly or as its last word (`Flash` is `3.8 Flash`, not
  `3.1 Flash-Lite`), else asks for the list; `onModels` redraws an idle screen. It was read only at
  connect, on a new tab and at the end of a turn: "picked up almost a minute later". `Choices` cuts
  a label past its 28-column cap (`fitLabel`), which had pushed that row's detail a column right.
  The warm-up row is just `✔ Ready`, and it sits on the input with the blank row above it
  (`noticeHugsInput`). An extension *newer* than the running agent says `Agent restart needed`
  instead of `Extension update · 1.55.0 → 1.54.0` (`compareVersions`). The watcher ignores an
  editor's atomic-save temp files (`x.js.tmp.<pid>.<hex>`, `x~`). Pty: 0 clears at 13, 16 and 24.

- **A child spawned while Ink is up must not inherit stderr (v5.24).** `execFileSync` passes a
  child's stderr to ours by default, and ours is Ink's terminal. osascript prints `*** Error
  creating a JP2 color space` twice when it reads a screenshot, so ctrl+v stranded the input
  box's top rule in scrollback. `OSASCRIPT_STDIO` in `frontend/input/clipboard-image.js`. The same release
  stopped the meter counting an image's base64 (`promptCharge`: a 650 KB screenshot read `0%
  until auto-compact`).

- **No mouse tracking, ever.** Terminal mouse reporting and native scroll are mutually
  exclusive: a terminal that is tracking hands the app the wheel and suppresses drag-select. The
  app therefore enables nothing, and `cli-ui.jsx` writes the disable sequences once on startup
  in case a crashed run left the terminal tracking. Scroll, drag-select and copy are the
  terminal's, exactly as in Claude Code. Everything that used to be clickable is a keybinding.

- **The transcript has no selection model.** `Ctrl+E` toggles verbosity for the *whole*
  transcript rather than one row, because there is nothing to point at a single row with. Ink
  cannot repaint what `<Static>` has committed, so `toggleVerbose` clears the screen and lets
  Static print the transcript again at the new setting — that one clear per keypress is
  deliberate and is the only `ESC[2J` the app writes. ↑/↓ always mean input history.

- **`ink-text-input` types every key it does not recognise.** Its handler special-cases exactly
  one chord, ctrl+c, so a ctrl+e handled in `useKeyBindings` still left a stray `e` in the
  prompt — and ctrl+o, ctrl+t and ctrl+v their letters. Ink offers no way to stop a `useInput`
  handler running, and the text field's is registered first (child effects run before the
  parent's). So the chords never reach Ink at all: `cli-ui.jsx` pulls them out of the stdin
  chunk via `hotkeys.js` and dispatches them through `use-hotkeys.js`. Adding a new ctrl+ binding
  means adding it to `HOTKEYS`, not to `useKeyBindings`. **Never a chord another app owns system-wide:** the task
  list was on ctrl+g until 10-24, and Chrome's Gemini panel takes Ctrl+G on macOS before the
  terminal sees it — pressing it opened Chrome. It is ctrl+o now.
  **A retired chord stays in `HOTKEYS` (v5.24).** `ctrl+t` became `/shell` and `ctrl+y` became
  `/copy code` — a command is listed by `/`, a chord has to be remembered. Unbinding the byte would
  hand it to `ink-text-input`, which types the letter; it stays taken and answers with one line
  saying where the thing went.

- **The prompt's rows are drawn rows (v7.9, `frontend/input/prompt-rows.js`).** ↑/↓ move by the rows Ink
  draws, wraps included, and only past the first or last row reach input history; the draft is
  kept (`draftRef`) and ↓ past the newest prompt gives it back, where it used to clear the box.
  `promptExtraRows` and the field's window count the same rows, so a long wrapped prompt is
  charged what it draws. `❯ ` sits in a `flexShrink={0}` box, the v6.12 rule: beside a wrapped
  prompt Yoga squeezed it to one column. **Newlines:** shift+enter (kitty, or Esc+Enter, which
  companion 1.8.8 binds shift+enter to in the editor's terminal) and `ctrl+n` (a hotkey); ctrl+j
  is ignored (owner: not needed).
  `newlineRef` is gone: every newline set it and only an Enter cleared it, so the first Enter after
  any newline was eaten. Pty at 13 and 24 × 60: a four-line message sent by Enter, the draft back,
  `XX` typed one wrapped row up in the right column, 0 clears.

- **A paste is folded to a marker, not typed into the prompt.** `usePaste` (Ink 7) turns on
  bracketed paste, which is the only thing that distinguishes "pasted forty lines" from "typed
  forty lines very fast" — and it keeps the text off `useInput` entirely. `paste.js` swaps
  anything over four lines for `[Pasted text #1 +42 lines]` and `App.handleSubmit` expands it on
  the way to the model. This is a frame-budget rule as much as a legibility one: the input box
  is in the live frame, and a pasted file is the easiest way to blow the viewport.

- **Ink never reads the real stdin.** `cli-ui.jsx` pipes `process.stdin` through a PassThrough
  so `enter-splitter.js` can peel a trailing `\r` into a chunk of its own. Ink's input parser
  deliberately does not split `\r` from adjacent text (a CR can sit inside a paste), so when the
  terminal delivers the last typed character and the Enter after it in one read — routine when
  typing fast, over ssh, in tmux, or on key repeat — Ink sees `"i\r"` with `key.return` false,
  `ink-text-input` types the CR into the prompt, and **the message is silently never sent**. The
  second write is deferred with `setImmediate`, because Ink's `read()` drains everything
  buffered and two back-to-back writes would arrive as the one chunk this exists to split.
