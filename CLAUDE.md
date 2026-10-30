# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local coding agent that has **no LLM API client**. Inference happens by driving a real
browser tab: the Node server sends a prompt over WebSocket to a Chrome extension, a content
script types it into gemini.google.com, scrapes the streamed reply,
and sends the text back. Every architectural oddity below follows from that.

npm workspaces: `server/` (brain + CLI UI), `extension/` (MV3 bridge), plus a standalone
`vscode-companion/` (not a workspace).

## Commands

```bash
npm install                       # installs both workspaces from the root
npm run start                     # server with workspace pinned to repo root (../)
npm run dev                       # same, with tsx --watch
cd server && npm start -- --workspace /path/to/project   # run against another project
./setup.sh                        # installs an `agent` / `agent-cli` shim in ~/.local/bin
                                  # (never `npm link` — it needs npm's global prefix)

npm run build --workspace=extension   # esbuild src/background/main.js -> service-worker.js
cd vscode-companion && vsce package --allow-missing-repository --skip-license
                                  # prepublish copies extension/side-panel/ into media/panel/
npm run test:companion            # the companion's tests (also part of `npm test`)
```

`extension/service-worker.js` is a **committed build artifact**. Editing anything under
`extension/src/background/` without re-running the build ships stale code — Chrome loads the
bundle, not the sources. `extension/content-scripts/*.js` are loaded directly and are not bundled.
Likewise `vscode-companion/*.vsix` is committed and must be repackaged after editing
`vscode-companion/extension.js`.

### Tests

```bash
npm test                                       # -> server: node --test "test/**/*.test.js"
node --test server/test/core/risk-classifier.test.js   # single file
```

Tests live in `server/test/`, mirroring `server/src/` directory for directory. They used to sit
beside their subjects, which made a missing test visible in an `ls` — that is how `diff-engine.js`
was found with none, and it turned out to be 358 lines that overwrite files, containing a bug
that wrote backups outside the backup directory.

Moving them bought one thing back: `node --test src/` used to be a landmine, because given a
directory Node runs *every* `.js` file under it as a test — including `main.js`, which starts the
WebSocket server and hangs forever. Nothing under `test/` starts anything, so the trap is gone.
The quoted glob is still what makes the script work under `sh`, which has no globstar.

A test that needs a path into the source tree must compute it relative to `src/`, not to itself
(`prompt-loader.test.js` reads `../../src/prompts`).

**The suite runs against a throwaway home.** `test/setup-home.js` is preloaded by the `test`
script and points `AGENT_CLI_HOME` at a temp dir. Without it every test that built an
`AgentLoop` against a temp workspace wrote that workspace's durable history into the real
`~/.agent/workspaces/` — 3,238 folders by 2026-10-19, twelve more per run, failing nothing. A
test that sets its own home must **restore** the previous value on teardown, never `delete`
it, or every later test in that file falls back to the real one; `test-home.test.js` names
any file that does. Running a single file with bare `node --test` skips the preload — use
`node --import ./test/setup-home.js --test <file>` for anything that touches sessions.

**Expected state: all tests pass.** They used to be 34/10/24 red: the tests described designs
the code had replaced — `plan-generator` writes one file per comment under `PR-<n>/` rather than
one `PR-<n>.md` per PR, and `comment-classifier` stopped categorising by keyword once the AI
took that over. Both test files were rewritten against the shipped behaviour, so a failure now is
a real regression.

There is no lint script; `.eslintrc.json` (eslint:recommended) and `.prettierrc`
(100 cols, single quotes, trailing commas) exist for editor integration.

### The pty harness — how anything user-visible gets measured

Most of the numbers in this file came from a harness that drives the **real CLI under a pty**
with a fake extension answering prompts from a script, so a full turn — inject, reply, tool
call, tool result, next prompt — runs with no browser and no Gemini account. It lives in the
session scratchpad, not the repo. Rebuild it from this:

- **`drive.py`** — `pty.fork()` the CLI with `--workspace <scratch> --port <p> --editor <shim>
  --no-github`. `PATH` is prefixed with a `bin/` of shims for `open`, `code`, `xdg-open` and
  `cursor` that log their argv instead of launching anything, which is how "did it open the
  editor" became checkable. Steps are a JSON list: type text, send a key, resize the window
  (`{"resize": [rows, cols]}`), or write a file into `.agent/state/` to stand in for the VS
  Code companion. It counts bytes, `ESC[2J`, `ESC[3J` and erase-lines per step — which is what
  makes a frame regression visible at all.
- **`fake-extension.js`** — connects with a `chrome-extension://` origin, sends
  `{type:'identify', payload:{clientType:'extension'}}` (`clientType`, not `client`), and
  answers each `inject_prompt` from a scripted list. It logs every prompt it is given, which
  is where the per-turn character counts come from.
- **`ext-cadence.js`** — the real extension in headless Chrome against a server whose
  `verifyClient` **refuses every handshake**, so each retry becomes an observable timestamp.
- **`scrape-test.mjs`** — the scrape lifted verbatim out of the bridge and run against a
  Gemini-shaped DOM in jsdom.

**Check the harness before believing anything, positive or negative.** It has lied at least
six times, and most of those looked like product bugs first: a port the extension never dials;
a file-seeding step that also typed its content into the prompt; an extractor that dropped an
`async` keyword; a fake extension that answered subagent requests without `isSubagent`, so
compaction hung; a `ClipboardEvent` probe that silently did nothing, making an empty composer
look like proof the send button was unfindable; and a `ws` import that was wrong, so a "resize
during a live turn" measurement had no live turn in it.

**A passing test lies the same way.** `toolCatalogDrift()` compared an empty registry to an
empty catalog and went green — it needed a negative control per branch before the pass meant
anything.

**And a tool with no test at all is worse.** `find_symbol` had 1,474 green tests around it and
not one that called it, so a stray edit that left `isMethod` referenced in `findSymbol` — where
it is never defined — made **every** `find_symbol` call return `Tool find_symbol failed:
isMethod is not defined`, and shipped. Its sibling `find_references` was covered in detail;
the tool beside it was covered not at all.

The cause is a class, not an accident: **a Python `str.replace(old, new)` with no count
replaces every occurrence**, and the tail of `findSymbol` was byte-identical to the tail of
`findReferences`. This file already said "a string anchor hits the first match"; replacing
without a count is the same trap with the opposite failure. When editing by script, assert the
match count before writing.

`test/mcp/tool-smoke.test.js` is the answer that generalises: every registered tool called once
on its happy path, plus a membership assertion so a tool added later cannot slip past by simply
not being in the map. It asserts almost nothing about *what* comes back — the per-tool suites
do that — only that the call the agent makes does not throw. A tool that cannot run at all is
the failure that costs a whole turn, and the model has been told by the prompt that it exists.

## Layout

```
server/src/
├── index.js          # bin shim: re-spawns main.js under tsx (sources contain JSX)
├── main.js           # arg parsing, migration, component wiring, bootstrap
├── core/             # agent-loop, prompt-builder, diff-engine, risk-classifier,
│                     # task-manager, paths, migrate, workspaces
├── bridge/           # websocket-server (the Chrome-extension transport)
├── context/          # token budget: code-minifier, symbol-index,
│                     # context-manager, memory-manager
├── github/           # PR agent: poller, comment-classifier, ci-log-parser, plan-generator
├── mcp/              # mcp-server.js + tools/
├── storage/  watcher/
└── ui/               # the terminal front-end
    ├── cli-ui.jsx    # render(): stdin shim, hotkey routing, trailing-Enter split
    ├── App.jsx       # state, effects, layout — everything else is a module
    ├── hotkeys.js    # ctrl+ chords, pulled off stdin before Ink sees them
    ├── enter-splitter.js  # peels a trailing \r off a chunk so Enter is a keypress
    ├── paste.js      # collapses a big paste to a marker; expands it on submit
    ├── format.js  constants.js  transcript.js     # pure, tested
    ├── hooks/        # use-key-bindings, use-hotkeys, use-github-tab,
    │                 #   use-github-keys, use-slash-commands, use-agent-callbacks
    └── components/   # Banner, TranscriptTurn, GithubTab, Menus, InputBar,
                      #   AgentTerminal, QuestionPrompt
```

Modules are kebab-case; React components keep PascalCase (`ui/App.jsx`). Tests live in
`server/test/`, mirroring this tree — `src/core/paths.js` is tested by `test/core/paths.test.js`.

## Architecture

### Turn lifecycle

`main.js` wires everything and hands off to `ui/cli-ui.jsx` → `ui/App.jsx`.

1. `App.jsx` sends user input to `AgentLoop.handleUserMessage` (`core/agent-loop.js`).
2. `PromptBuilder.buildPrompt` (`core/prompt-builder.js`) assembles the prompt.
3. `AgentLoop._sendToGemini` pushes onto `extensionQueue` and calls `callbacks.injectPrompt`;
   `bridge/websocket-server.js` relays it to the extension. The queue is serialized by
   `isExtensionBusy` — one browser tab, one in-flight prompt.
4. The content script streams back `gemini_response_stream` (rendered live) then
   `gemini_response`, which resolves `AgentLoop.handleGeminiResponse`.
5. `_extractToolCalls` parses JSON tool calls out of the reply text (there is no structured
   tool-call API — this is text parsing, hence `_cleanJsonString`), then `_executeToolCalls`
   dispatches through `MCPServer.executeTool`.
6. Results are fed back via `buildToolResultPrompt` and the loop repeats.

### Bridge liveness — why a prompt used to wait for you to open Chrome

Reported from use, 2026-09-17: *"most of the time the prompt is not sent while I am out
of Chrome, and as soon as I open Chrome or the Gemini tab it is sent."* That is two
independent faults that produce one symptom, and neither is throttling.

**The reconnect alarm was cleared on connect.** `chrome.alarms.create('reconnect')` was
called in `scheduleRetry` and `chrome.alarms.clear` in `stopKeepAlive` — which runs on
`onopen`. So a *healthy* bridge had no alarm at all. Chrome can still evict a service
worker that believes it is connected, and when it does the socket dies with it: `onclose`
never runs inside a worker that is already gone, no `setTimeout` survives it, and nothing
outside the browser can reach in and start it. What actually revived it was incidental —
the user focusing a tab, `chrome.tabs.onUpdated` firing, and Chrome starting the worker to
deliver that event, which re-runs the module and its bottom-line `connectWebSocket()`.
The alarm is periodic and permanent now. While connected it costs nothing, because the
heartbeat already keeps the worker resident; it is the only thing that can resurrect a
worker Chrome has silently collected. `test/background/watchdog-alarm.test.js` pins it,
including a source assertion that `stopKeepAlive` does not clear it — re-adding that line
reads as ordinary cleanup in a diff.

**And the prompt it was waiting for had already been thrown away.** `broadcast` returns
whether it reached anyone; every caller ignored it. `injectPrompt` with no extension
connected wrote to no sockets and vanished, leaving the lane busy until the seven-minute
watchdog. `sendInjectPrompt` honours the return and holds what it could not deliver;
`flushPendingInjects` drains it when a client **identifies as an extension** — not on
socket open, because the socket is open before we know what is on the other end and the
side panel uses the same transport. Held prompts past `INJECT_BUFFER_TTL_MS` are dropped
rather than sent: the lane watchdog has already abandoned that turn, and typing it into
Gemini then starts a conversation nobody is listening to.

**Fixed sleeps became a readiness handshake.** 4000ms after opening a subagent tab, 1500ms
after a new main tab loaded, 1000ms after re-injecting — 6.5s of unconditional waiting per
new tab, wrong in both directions: seconds burnt on a warm machine, and still too early on
a cold one, where the send lands before the listener exists and is reported as an
unreachable tab. `waitForBridge` polls a `ping` the content script answers. It reports two
things because they fail differently: `ready` (this script is listening and not orphaned)
and `canType` (the composer is in the DOM, which is the real precondition for an inject).
**Gating only on `canType` would be worse than the sleep it replaces** — a changed composer
selector would turn "the send fails with a readable error" into "every turn burns its whole
budget first" — so the last 40% of the budget accepts `ready` alone and lets the send
produce the honest error.

**The 3-second nudge was the third mechanism doing this job, and the most expensive.** Every
model tab ran `setInterval(() => safeSend({type:'connect'}), 3000)` for the life of the
page, so an open Gemini tab woke the service worker twenty times a minute forever — a
worker never allowed to go idle, to solve a problem that only exists while there is nothing
to connect to. The worker now answers `connect` with its state and the tab backs off to 30s
once connected, which is a tenth of the steady-state cost with the fast cadence still there
for the case it was written for. It reports the state *before* attempting the connection:
`connectWebSocket` resolves long before a socket is open, and answering "connected" there
would slow the nudge down at the moment it is working.

**The clock was the only throttled thing, and that is measurable.**

The bridge activated the model tab and held your focus for the length of a turn, because
completion was detected by a 2s `setInterval` in the content script and Chrome throttles
page timers in a hidden tab. Before redesigning around that, it was measured — on
example.com, in a genuinely hidden tab, Chrome 152, over 334 seconds:

| mechanism | delivered | expected |
| --- | --- | --- |
| page `setInterval(100ms)` | 63 | 3340 — **1.9%** |
| **Worker** `setInterval(100ms)` | 3344 | 3340 — 100% |
| **`MutationObserver`** | 9.97–10/s every bucket | 10/s |
| **`getBoundingClientRect()`** | 3213 real boxes | **0** empty |

Three things that were assumed to be broken in a hidden tab are not. The MutationObserver
that supplies the evidence runs at full rate. Layout works, so the Stop-button visibility
check — `getBoundingClientRect` plus `getComputedStyle` — is sound. A Worker's timers are
not throttled at all. **Only the page's own timer is**, and it collapses to roughly one
tick per minute within 60 seconds of the tab being hidden, staying there across the
five-minute intensive-throttling boundary rather than degrading further at it.

So a 2s completion check becomes a ~60s one, per round, and a multi-round turn stalls until
you look at the browser. That is the whole of "it hangs while I am out of Chrome".

The fix keeps the evidence in the page and moves the clock out: a service worker is not a
tab and is not throttled, and `chrome.tabs.sendMessage` is an *event* rather than a timer,
so it is delivered at full rate into a hidden page. `startCompletionTicks` drives
`tick_completion` every 2s from the worker; the content script's own interval stays as a
backstop for a worker evicted mid-turn. **A Worker inside the page would also have worked
and was rejected**: creating one from a content script means either a `blob:` URL, which
gemini.google.com's CSP is entitled to refuse, or a `chrome-extension://` URL, which is
cross-origin for a worker. The service worker needs no new capability and is already kept
alive for the turn by the heartbeat.

With the clock outside the tab, **focus is returned as soon as the send lands** rather than
when the reply does — the tab only has to be in front long enough to accept the paste.

**And that fix was applied to one caller, on 2026-09-25 to the second.** The completion
check was the throttled poll anyone had noticed, because it is the one that stalls a turn.
The **mode picker** read the same way and was left on the same clock, and it is worse off:
that last sentence is why. `discover_models` and `switch_model` are messages to a tab rather
than turns, so nothing activates the tab first — the picker is read *only* in a hidden tab,
where the `send` stage's measured ~500ms says injection is not.

`openModelMenu` polled `20 × 50ms` and `closeModelMenu` `8 × 50ms`, the second of those
inside the `finally` that `readModelOptions` returns the list through. Nominally 1.4
seconds, clamped ≥28, against a server watchdog of 8. In `errors.jsonl`: **36
`model_options_unanswered`, of which only 13 were "no tab to ask"** — the other 23 reached a
tab and the answer arrived too late to be wanted. That is the whole of "the model never
switches" and of routing falling back to the default: `modelOptions` was never filled, so
`pickModelFor` had nothing to resolve a rung against.

`waitForDom` waits on a `MutationObserver` (full rate, per the table above) with
`performance.now()` as the deadline — a clock *read* rather than a timer. One `setTimeout`
remains as a backstop for a page that goes completely still, and it is only ever reached
when the answer is "no". The close-confirmation loop was deleted rather than converted: it
never retried and never reported, so every tick of it was spent on a value nobody read.

**The lesson generalises past this file: a clock fix has as many sites as the clock has
callers.** It had four. The typing path held the other two until 2026-09-27: the paste-settle
check slept `setTimeout(…, 50)` between looks (the `type` stage went from a **27ms** median over
376 turns to **994ms**, one turn-0 paste took **22s**), and `waitForSendButton` polled on a page
timer against a 30s deadline — first look before Gemini rendered the button, next look after the
deadline, prompt pasted and never sent. Both run on the observer clock now, and both are tested
with a `setTimeout` that **never fires**, which is the only honest model of a hidden tab: every
earlier test ran on Node's timers, which are never throttled, and so could not see either bug. Nothing in the codebase distinguished the two, and the second one was invisible
because its symptom — a picker that does not change — reads as a DOM-selector bug. It was
diagnosed as one twice.

**A failure to read the picker also used to kill the turn.** The bridge's `error` case ends
in `isProcessing = false` plus `abortExtensionWork()`, which is right for every error that
means the in-flight prompt is not coming back and wrong for these two, which are asked
outside the lane in the first place. So `/effort` during a turn, or one unreachable tab,
abandoned the prompt underneath it and filed the reason under `flow: 'extension'`, nowhere
near the turn that stopped. `NON_FATAL_EXTENSION_OPS` is the gate, with a negative control
per branch — a bridge that aborts for nothing is a worse bug than the one being fixed, since
a prompt that really is dead then holds the lane for seven minutes.

**The picker had a veto and no containment until v4.0.** Everything it had was a veto —
don't open a menu over a live composer, don't act on a half-read list — and a veto only works
while every path that could leave a menu open is *known*. Eight selector ladders against a page
Google redesigns without telling anyone means that assumption expires without warning. An open
menu puts an overlay across the composer; the send lands on its backdrop, `waitForSendButton`
burns its budget, and the turn is lost two turns away from its cause.

`dismissStuckMenu` is the containment: every inject clears a stuck menu before typing, so the
turn stops trusting the picker to have cleaned up. Three properties are load-bearing, because it
runs on **every** turn. It is **synchronous and unbudgeted** — never `findModelTrigger`, which
waits up to 8s for a picker to *appear*. It **cannot throw**, or it becomes a cause of the lost
turn it prevents. And it tries **Escape before the trigger**, which is not a matter of taste:
the trigger *toggles*, so clicking it after Escape has closed the menu **opens it again**. The
first DOM fixture modelled a trigger that could only close and could not see that; the second
toggles, as Gemini's does. **A fixture that is kinder than the page tests the fixture.**

**And the first cut closed menus that were not stuck.** A subagent's tab is switched to its
model and then typed into; the worker gives the switch **5s**, and in a fresh tab the switch's
own waits add up to about **14**. So the inject arrived mid-switch and the cleanup closed the
switch's own menu — the switch failed and the subagent ran on Pro. Picker operations register
themselves now (`trackPicker`, including the fire-and-forget close, which would otherwise let the
count reach zero while a toggle is still pending), and the inject waits for them before deciding
a menu is abandoned. **Containment must not be able to tell a stuck thing from a busy one by
looking at it**; it has to be told which is which by the thing that owns it.

The notice it sends says *"tried to close it"*, not *"closed it"*, and does not re-check. Angular
Material animates the overlay out, so a synchronous look after Escape can still see it open on
the live page — escalating on that would log a false failure for every stuck menu, which is the
noise the log levels exist to remove. Whether the prompt landed is observed properly by the send
path.

`switch_model` also gained the `isInjecting` guard `discover_models` had since 1.30.0. The server
defers a *main-lane* switch while the lane is busy, but a **subagent** switch is dispatched with
no lane check — and its tab is precisely the one about to be typed into. The lane is the server's
model of the tab; `isInjecting` is the tab's own answer, and only one of them can be wrong about a
composer.

**Verified with the picker forced to fail on every call:** 20 of 20 turns, five tool rounds and a
subagent, two failures landing mid-turn. A `/effort` typed a second into a deliberately slow turn
was held and dispatched **4ms after** that turn's reply.

**The composer stopped claiming our paste, and every prompt waited 5 s for it (fixed v5.7).**
The `type` stage was ~30 ms median here until 09-24, then 1–6 s; on the work laptop 6.5 s median,
113 s max. Checked on the live page 10-24: the synthetic paste is no longer `preventDefault`ed and
never lands, so every turn waited out `PASTE_LAND_BUDGET_MS` before the `insertText` fallback —
which puts 34,615 characters in exactly, one paragraph per line, in 1.2 s. The work account's
composer is a `<textarea>`, which never claimed it. An **unclaimed** paste cannot land later (a
browser does nothing by default with an untrusted one), so the wait now runs only for a claimed
paste or an image. That is the converse of the earlier lesson — claimed is not landed — and
does not undo it. The shape fallback also vetoes `Expand input to Fullscreen`, which appears
exactly when a long prompt goes in and was clicked instead of send.

**Chrome also discards background tabs**, which looks identical to a hang: the tab stays in
the strip with its title intact while the page and content script are gone.
`prepareTabForTurn` sets `autoDiscardable: false` on a tab about to hold a turn, and
reloads plus re-handshakes one that was already discarded. The flag is a request, not a
guarantee, which is why the repair exists alongside it.

**What is still unexamined:** the `MutationObserver` watches `document.body` with
`subtree: true, characterData: true`, which on an app as busy as Gemini fires far more than
it needs to. Narrowing it to the response container is a real cost saving and a real risk —
a wrong selector observes nothing and every turn breaks — so it wants measuring against the
live page, not a guess.

**Self-healing: what is repaired, and the two things deliberately not.**

Every failure below used to end the turn, and the prompt with it.

- **A failing send repairs the tab.** `sendWithRepairs` is a ladder — send,
  re-inject the content script, reload the tab — cheapest repair first, because
  the commonest cause by far is a script orphaned by an extension reload. It
  **stops before opening a fresh tab, on purpose**: a reload returns to the same
  `/app/<id>` and Gemini still holds the thread, while a new tab is a new
  conversation, and an incremental prompt sent into one gets a confident answer
  to a question the model never saw. Losing a turn beats answering a different
  one. That is the same reasoning `session_lost` already encodes for batch tabs.

  **That middle rung did nothing at all until 2026-09-19.** The bridge declared
  its constants at the top level of the content-script world, and that world
  outlives the script that created it — so re-injecting into a tab that already
  had a copy threw `Identifier 'RESPONSE_IDLE_TIMEOUT' has already been
  declared` on line one and the fresh copy never evaluated. The rung existed for
  exactly the case that guarantees a copy is already there. It failed silently,
  `waitForBridge` then burned its budget waiting for a script that had not
  loaded, and the only evidence was an entry on `chrome://extensions`.

  The file is an IIFE now, which makes a second injection legal, and a
  `window.__agentBridgeStop` handover makes it a *replacement*: the new copy
  calls the old one's `invalidate()` before taking the handle, so the orphan's
  MutationObservers and timers stop immediately instead of running until
  something happens to call `safeSend`. Skipping would not have done — the goal
  is to replace an orphan, not to notice one.
- **A prompt that never reached the composer is sent again, once.** The content
  script always knew the difference and discarded it. `sawGenerating` is the
  discriminator: generation started and we failed to read it means the model
  **has** an answer, so a resend asks twice into a thread that already holds the
  first reply; generation never started and nothing scraped means the submit did
  not happen, so a resend is the first attempt landing. Only the second retries.
  It resends `_lastMainPrompt` **verbatim**, because `buildPrompt` has side
  effects — rebuilding after a failed turn 0 marks the system prompt as seen and
  hands the model a bare question with no tools.
- **A tab about to hold a turn is opted out of discarding, and reloaded if it
  was already discarded** (`prepareTabForTurn`). A discarded tab is
  indistinguishable from a hang: it keeps its title in the strip while the page
  and script are gone.

Not done, and why: **`timedOut` with partial text is not retried** — the model
answered, and a second ask corrupts the thread for a reply we already partly
have. And **a disconnected extension mid-turn does not re-dispatch the in-flight
prompt**; `pendingInjects` covers prompts that were never delivered, but one
that *was* delivered may have been answered into a tab we can no longer see, and
re-sending it blind is the double-answer bug again. Doing that safely needs the
worker to ask the tab whether it is still watching that `requestId` — the
`tick_completion` handshake is the piece that would make it answerable.

**Tool amnesia: the cause is a thread the model never saw, not a bad detector.**

Reported from use with two screenshots. The prompt in both was the *short*
turn — a bracketed context line and a list of tool **names** — sent into a
brand-new Gemini conversation. The model has names and no definitions, so it
says the tools "are not actually connected to my current execution
environment", and the turn is spent.

`hasSeenSystemPrompt` is the **prompt builder's belief**; the model's memory is
the **thread**, which is the entire premise of `chat-thread.js`. Nothing
connected the two. So when the tab moved to a different conversation — the user
opening a new chat, `ensureModelTab` opening one because the old tab was gone,
a reload landing on `/app` with no id — the builder carried on sending short
turns forever. `_recordThread` notices the change already; it now also calls
`resetPromptState()`, but **only when there was a previous thread**: the first
id of a session is turn 0's own conversation, which already carried the prompt.

**The detector was wrong in both directions, and one of them destroyed
answers.** `looksLikeCapabilityDenial` gates a repair that discards the reply
and re-asks. It asked for an inability phrase and then, loosely, for any of
`execute|run|access|read|…` within 60 characters of any of
`local|file|directory|command|…` — a window wide enough to span two clauses, so
*"I read the file and I can't see any problem with the parser — the local
variable is fine"* was classified as a refusal and thrown away. Meanwhile both
denials seen in use that day slipped through, because both were **passive**:
the model did not say it could not, it said the tools were not connected.

The cure for the false positives is the *subject*, not a narrower window. A
denial is about the agent's tooling or the box it runs in; an ordinary answer
saying "can't" is about code. `local scope` and `local variable` are no longer
objects, `local disk` and `file system` are, and `mcp/tools/` is excluded by
path because in this repo that directory is a thing an answer mentions by name.
A second pattern covers *"I can't read files in that directory"*, which names
no environment: there the negation must attach within four words to a verb the
tools perform, so `can't see`, `can't reproduce`, `can't find` and `can't make`
— the four ways an ordinary answer says it — do not qualify.
`test/core/denial-corpus.test.js` holds both lists; the old pattern fails it in
both directions.

**And moving the clock exposed a latent race.** A turn ended on a *single*
observation of "no Stop button and one second since the text changed". That was
only safe while the check was throttled to roughly once a minute, where a
transient is almost never sampled. At a reliable 2s cadence the transients get
caught, and a reply came back truncated mid-token. Gemini pauses longer than a
second between sections and the Stop button is briefly absent while the
composer re-renders — either alone looks exactly like finished. The condition
must now hold across consecutive checks. **A fix that makes something reliable
will find every place that was quietly relying on it being unreliable.**

**Turn latency, measured — and where it actually goes.**

`core/trace-log.js` records five stages per turn (`find_input`, `type`, `send`,
`first_token`, `complete`); `/trace` reads them back. From 74 real turns on the
owner's machine:

| stage | median | p90 |
| --- | --- | --- |
| `find_input` | 1ms | 13ms |
| `type` | 24ms | 513ms |
| `send` | 514ms | 1201ms |
| `first_token` | **0ms** | 1ms |
| `complete` | 6004ms | 18981ms |

Two things fall out of that table, and neither is Gemini being slow.

**`first_token` measured nothing.** It was marked one line after the send, so
it timed the gap between two adjacent statements. The number it is named for —
the one that separates *the model thinking* from *our overhead* — was never
captured; it all went into `complete`. Marked now when the observer first sees
text, which is what makes any further latency claim checkable.

**`complete` was quantised to the poll interval.** 6004, 8966, 10001, 16002,
30064: every sample sits on a ~2000ms boundary, because a finished reply is
only noticed when the check next fires. A reply that ended at 4.2s was
delivered at 6s, and the two-consecutive-checks rule that stopped truncated
replies added another whole interval. The rule is right and the *cadence* was
wrong: the tab now reports `confirmSoon` as soon as it goes quiet and the
worker returns at a quarter of the interval for the confirming look — slow
while the model writes, fast only when there is something to confirm.

The remaining per-turn overhead is `send` (~0.5s median, 1.2s p90), and the
real multiplier is **round trips**: every tool call is another full
inject → think → scrape cycle, so tail latency is paid once per round, not
once per turn.

**Rounds per turn are recorded since v5.1** (`rounds` on each `tool-usage.jsonl` row; `/logs
tools` prints median and p90), because nothing did, and "faster" was uncheckable. The same
release fixed the line most likely inflating them: turn 0 says *"You can make MULTIPLE tool
calls in a single response"*, but every tool-result turn ended *"Reply once, with exactly one
of: the next tool call"* — singular, and the line the model reads last and most often. It now
asks for independent reads and searches in one reply. **Judge it from `/logs tools` after a
few days of use, not from the argument.**

**One recovery table (`core/reply-recovery.js`, v5.1).** `handleGeminiResponse` was 510 lines
holding five retry policies inline; the decisions are pure functions now, in the shape of
`tool-policy.js`, and the handler is under 200 lines. Three behaviours changed, each from the
log rather than from taste:

- **A provider error re-sends the prompt that failed, verbatim.** It rebuilt one from
  `currentObjective` — the user's original question — so an error after a tool round threw
  away the `<tool_results>` the model had asked for and restarted the task. The unsubmitted
  resend had already learned that a resend cannot be a rebuild; the branch beside it had not.
  Inline image data is stripped first, because the tab took the upload before it errored.
- **It waits first: 3s, then 8s, ±20%.** The immediate retry was measured failing — on 09-22
  the identical error came back six seconds later, and on 09-24 the retry hit a timeout. The
  timer is Node's, so hidden-tab throttling does not apply. `abortExtensionWork` cancels it,
  because during the wait the lane is free and a stop would otherwise find nothing to abort.
- **A usage limit is never retried.** Its wording ("try again later") matches the provider
  detector, so a limit was re-asked twice into the same wall. `looksLikeQuotaReached` runs
  first and logs a `quota_reached` notice. The wording is a guess — the log had never held one.
  **Since v5.28 it is retried one rung down**, never on the same model (see Prompt economics).

Verified end to end under the pty harness with a scripted provider error after a tool round:
the resent prompt was byte-identical to the failed one (622 characters, tool results intact),
sent 3,381ms later, with `retrying in 3s` on screen and the final answer drawn.

**And the confirming look leaked, once per turn, compounding.** It was scheduled with a bare
`setTimeout` nobody held, and `stopCompletionTicks` cleared only the interval. Stopping a turn
from outside — the tab closing, the session ending, the next turn starting — therefore left a
tick to fire into a tab whose turn was over, which costs one stray message and nothing else.

The next turn is where it gets expensive. `startCompletionTicks` stops the old ticker and
installs a new one, so an orphaned confirm firing afterwards finds `completionTickers.has(tabId)`
**true again** — for the new turn — and schedules another. That is a second fast chain running
beside the real one, holding the *previous* turn's `everyMs`, with no handle anywhere to stop
it, and it compounds once per turn on a long session.

`completionConfirms` holds the pending timeout so the stop can cancel it, and the cancel runs
*before* the early return on a missing interval — returning early there is precisely how it got
left running.

**It was found by widening an unrelated timing window until the leak reached the next test.**
Nothing else would have: a stray message is invisible and the doubling only shows if you count.
That test had asserted `>= 3` ticks after `TICK * 1.6`, where the third tick and the deadline
are 4ms apart — so it failed about one run in five, on the machine's load rather than the code.
**A wall-clock assertion with no margin measures the machine**, which the frame-budget harness
had already learned once.

**`mergeLoopHistory` uses a recorded position, not a count.** It counted the screen's
non-local rows and used that number to `slice()` the loop's history — valid only if the screen
mirrors the loop one-for-one, in order. Two ordinary things break that: `file-watcher.js`
appends `[System Event]` turns the screen never asked for, *including before the session's
first prompt*, and the prompt is echoed to the screen optimistically, so it is there before the
loop has it. Measured under the harness with a busy watcher: screen 1 row, loop 16 —
`[system ×12, user, agent, system, system]`. Slicing from index 1 appended eleven system events
and a second copy of the user's own prompt, and every later merge was misaligned. The position
now rides on the rows (`__loopIndex`), and the optimistic echo (`__echo`) is claimed by the
loop's own copy rather than drawn twice — once per echo, because asking the same question twice
must produce two rows.

**The reply after a diff approval — fixed by reprinting, not by staying live.** `App.jsx` keeps only the last turn live *while `isProcessing`*; everything else is
committed to `<Static>`, which Ink never repaints. `agent_response` cleared `isProcessing` even
when the turn still had tool calls to run, so the turn was written to scrollback mid-flight and
the tool result, the approval and the closing reply were appended to a group that could no
longer be drawn. Reproduced in the harness: file written, diff shown, final reply never drawn.

The obvious fix — make `isProcessing` follow `agentLoop.isProcessing`, so the turn stays live
until the loop is done — restores the reply and is **catastrophic**: one run went from 15KB and
**0** full clears to **6.8MB and 1,228**, which is the flicker bug entire. Three attempts to
bound the longer-lived turn made it worse still (45, then 89 clears). Do not retry it.

What works is the mechanism this file already had for exactly this: the turn still commits
early, and when a *committed* turn grows, `<Static>` is remounted and the transcript reprinted.
Measured across three runs: **18.2–18.5KB, 0 clears, reply present** — against a 15.1KB, 0-clear
baseline where the reply never appeared. A remount reprints without clearing, so it is cheaper
than the one clear `ctrl+e` pays.

**`agent_response` is not "the turn ended" (v5.5).** It is sent for any reply with prose,
including prose that comes *with* tool calls, and every front-end treated it as the end: the
status bar went back to `● agent`, `esc to stop` vanished, and — because the task panel draws
only when idle — the checklist appeared under the prompt mid-turn. Reported as "the indicator
stops but gemini runs, executes some command and output updates"; reproduced under the pty. The
payload carries `continuing` now, and a `tool_call` or `status` re-raises the flag while
`agentLoop.isProcessing` says the loop is busy, which also covers the diff prompt, which lowers it
with nothing to raise it again. Keeping React's flag up for the whole turn was the catastrophic
experiment described above; it is safe now only because rows are committed one at a time — measured at
0 clears.

Two traps, both of which produced confident wrong numbers first:

- **The harness was measuring nothing repeatable.** `drive2.py` waited a fixed number of
  seconds between steps, so pressing enter to approve could land *before* the prompt existed —
  a different code path. Identical code measured 1 clear and 89. `drive3.py` waits on observed
  output (`{"wait": "Approve"}`) and is reproducible to within 300 bytes across runs. **Any
  frame-budget number taken with a wall-clock driver is noise.**
- **The first cut of the reprint counted `t.messages`, which `groupTurns` does not return** (it
  is `steps`). The shape never changed, the epoch never bumped, and it measured a clean 0
  clears *while doing nothing at all* — a fix that looks perfect because it is inert. Only the
  reply still being missing caught it.

### Prompt economics

`PromptBuilder` sends the **full system prompt + tool definitions only on turn 0 and every
Nth turn** (`resetPromptState` after `/compact` or `/clear`). This is not an optimization —
resending a large system prompt every turn trips Gemini's repetition/safety
filters and A/B-test modals. Prompt content is also tiered by `modelTier`
(`lite` / `flash` / `pro` — renamed 2026-09-20 to the picker's own words) via
`_getReasoningInstructions`.

**The prompt follows the tab, not the setting (v5.26, `AgentLoop._promptEffort`).** Every build
goes through `_promptConfig()`, which uses the rung whose model is selected in the picker
(`rungForModel`, the reverse of `pickModelFor`, pins included) and falls back to
`modelConfig.effort` when the picker is unread, the selection is a mode, or a switch is in flight.
The setting is never rewritten. The thread is re-taught (`resetPromptState`) only when the
**tier** moves, which `promptBuilder.promptTier` records, so `/effort` no longer resets on its
own. Each reply records `effort`, `promptEffort` and `model`. The first review of the rungs is
in `.agent/artifacts/plans/2026-10-26-effort-review.md`.

**The prompt is versioned (v5.32, `core/prompt-versions.js`, `/prompt`).** Asked 2026-10-28: "we
don't know exactly if newer will be better or not". Every prompt change had replaced the one
before, so "better" was argued from prompt sizes. Now **v1 is frozen**: `prompt-v1-golden.test.js`
hashes 98 shapes (turn 0, short, refresh, redeclare and warm-up for every effort × mode ×
subagents; handovers; a tool batch; subagent wrappers; compaction) against
`test/core/fixtures/prompt-v1-golden.json`, so a change that reaches v1 fails the build — put it
in a newer version. A version is its differences: `dir` overrides prompt files
(`prompts/<dir>/<name>.md`, else the base file — `prompt(name, dir)`), `flags` for builder switches,
`refreshEvery` for the reminder cadence. Per person in `~/.agent/settings.json`, default v1; a
switch re-teaches the chat only when the version changes. Every reply and every
`tool-usage.jsonl` row records `promptVersion` (older rows count as v1, since v1 *is* v5.31's
prompt), and bare `/prompt` and `/logs tools` show turns and rounds per version. The status bar
says `prompt v2` only off the default.
Pty: after `/prompt v2` the next prompt is the full 19,342 characters; 0 clears at 13 and 24 rows.

**v2 is the dedup plan (v5.34, `.agent/artifacts/plans/2026-10-26-prompt-dedup.md`)**, as five
`flags` plus five files in `prompts/v2/`. It cuts lines that cost round trips: no read-back after
every edit (the result already says applied, approved, rejected or mismatch — the handovers say
so too, or they would contradict it); `task.md` ticked in the reply that makes the next call; the
review subagent only past one file or ~30 lines; `walkthrough.md` only after a `task.md`. It also
keeps one copy of each repeated rule. **The plan was wrong once:** it dropped the `edit_file`
mismatch bullet on medium too, but medium gets the terse tool list, which does not say it.
`prompt-v2.test.js` asserts every surviving copy for that reason. Turn 0 is −78 / −148 / −892
characters (low / medium / high): the size is not the point, round trips are. Judge it by
`/prompt` after some days on v2, not by this paragraph.

**Max is a fourth rung: High's prompt on Argon (v5.26).** Argon is a *model* on a few accounts,
labelled `4 Argon` and listed after Pro (seen on the owner's account, 2026-10-26). Under the old
"High = the last model" rule it took High, Medium landed on Pro, and Flash became unreachable.
`byProAnchor` finds Pro by name again; Max is the model named Argon, else the first model after
Pro. With no Pro in the list the positional rule runs unchanged and Max is unavailable, so every
three-model account maps exactly as before (pinned in `model-match.test.js`). `/effort max`
without Argon answers `stays <rung> · Argon is not available on this account` and changes
nothing. `promptRung` folds Max to High at build time, because the system prompt names its rung. The
slider's model line names what the marked stop maps to on this account (`stopModel` in
`ui/effort-slider.js`), dimmed as `not available on this account` for Max without Argon.

**The browser differing from the effort is asked about, and a failed switch steps down (v5.28,
`core/model-fallback.js`).** Under the default policy, `ask`, `handleSubmit` stops before the message
is typed and offers three choices: switch the browser, send on it this time, or set the effort to
match. It asks once per disagreement (`_mismatchAcks`, keyed on setting and tab) and never mid-turn.
`/effort mismatch follow` brings back v5.26's silent following, and `switch` always switches,
inside `handleUserMessage`, so the side panel gets it too; the panel never asks. A switch is
confirmed by the picker's read-back (`switchAndConfirm`: the `requested` and `switchedTo` the bridge
already sent, which nothing used to compare). `ensureRung` walks down from there: Max → High →
Medium → Low, never up. **A quota reply now steps down and re-sends verbatim** (`step_down` in
`reply-recovery.js`, once per turn), answering the "drop to Flash? wait?" the recovery table above had left open. A landing
below the wanted rung is `effortFallback` for the session: the status bar shows `↓ <model>`, nothing
asks again, and `/effort` clears it. Pty: 0 clears at 13 and 24 rows on all three paths.

**Warm start is opt-in (v5.27, `/startup warm|cold`, `AgentLoop.warmUp`).** Warm sends the turn-0
block on its own when the first extension identifies (after `resumeThreadOnConnect`) and after
`/new`, through `_askThread`, so the first message goes out as a short turn. It defaults to cold
(owner: "warm should be not at default"), because it costs one Gemini message per launch. The
prompt is marked seen only on Gemini's answer; a timeout, an error or esc resets it, so the worst
case is a cold start. It is skipped when the chat already has the prompt, when a turn is running,
or when a thread, recap or compaction hand-over is owed. A warm-up's thread is kept off disk until
the first real reply (`_threadUnsaved`), or `--continue` could pair a filed conversation with a
chat that never saw it. The UI learns of it through `onWarm`, not a status message: Chrome usually
connects before App has attached its callbacks. Pty: prompt 0 is the setup, a message typed
meanwhile queues and goes as the short turn, and 0 clears at 13 and 24 rows.

The **tool anchor** (`_buildToolAnchor`) is the exception that rides on *every* turn: tool
names only, 56 tokens against 1,575 for the definitions. The model does not gradually forget
its tools, it forgets them completely — mid-session it answers "I cannot execute local
commands or access your local file system" with total confidence and the turn is lost. Three
detectors in `core/drift-detector.js` back that up, each with a different response:
`looksLikeMultipleDrafts` → bring the refresh forward; `looksLikeCapabilityDenial` → resend the
full definitions and retry the turn once (`requestToolRedeclaration`, **not**
`resetPromptState` — see below); `looksLikeProviderError` → Gemini's own error rather
than an answer, so re-ask (this one used to be written to disk as a PR plan). All three match
prose and will always trail the model's phrasing, which is why the anchor exists: prevention
first, detection as the backstop.

**The repair for tool amnesia used to be the heaviest prompt in the system.** It called
`resetPromptState()`, which does not mean "send the tools again" — it means "pretend this
chat has never seen a prompt", so the next turn was a full turn-0 payload: system
instructions, tool definitions, `AGENT.md`, memory and the skill catalogue. The model had
not forgotten the project; it had forgotten one block. And the reason prompts are tiered at
all is that a large repeated payload trips Gemini's repetition and A/B-test filters — so
the old repair fired the largest prompt available at exactly the moment the session was
already unhealthy, which makes it a plausible *cause* of the next failure. Measured on this
repo: **25,445 characters against 9,991, a 61% cut.** `requestToolRedeclaration()` sends the
condensed reminder plus the full definitions and nothing else. It outranks the periodic
refresh, because that tier sends tool *names* and names are what just failed.

**Saying what would prove you wrong (`pro-hypothesis.md`).** Proposed as a "hypothesis
engine": a falsifiable hypothesis before every search, with `<invalidation_criteria>` and a
1–100 `<confidence_score>`. Measuring the prompts first narrowed it a long way. `standard`
already asks for *"what you expect the next call to show"*, which is most of a hypothesis —
what no rung asked was **what would disprove it**, or what to do when the answer is not clear.
Those two are the whole gap, and they cost **714 characters** rather than a taxonomy rewrite.

Scoped to `standard` and `deep`, because it costs **output** tokens and output is generation
time: `brief` promises "straight to work", and the flash rungs are written for a model that
follows short prompts and ignores long ones. Verified the way the last prompt move was —
**6 of the 10 effort × topology shapes come out byte-identical**, and the four that change do
so by exactly +714. The first attempt was +1 character on `brief` too, from a newline left
outside the conditional.

**The numeric confidence score was declined.** A model asked for a number produces one, and a
fabricated `87` reads as evidence. The instruction is behavioural instead — if you would not
bet on it, ask — which is the part that changes what the agent *does*.

**And the rungs were not as thin as they looked — then they were revisited and there is one.**
An earlier note here claimed the three pro rungs "differ only by `isBrief`". Measured:
21,907 / 25,436 / 26,343 characters, differing by plan-first, a phase-2 analysis, adversarial
self-review and an assumption ledger. What was genuinely thin was `standard` → `deep` at
**+3.6%**, and that is the one that was acted on: **since 2026-09-20 there is a single pro
rung.** `pro` is the old `standard` plus `deep`'s review step; the critical-analysis phase and
the assumption ledger are declined because they are paid in **output** tokens on every pro
turn, which a prompt character count does not show.

**On `deep`, the hostile reviewer is a different model.** `deep` ended with "read the diff as
a hostile reviewer", and a model reviewing its own diff is the weakest reviewer available: it
shares every assumption that produced the code. With a reviewer configured it now calls
`ask_reviewer` instead.

Scoped to `deep` **and** `topology === 'duo'`. On solo the step stays self-review, because
naming `ask_reviewer` in a prompt that does not define it instructs a call to a tool the model
has never been given — the drift `toolCatalogDrift` exists to catch. Verified: 9 of the 10
effort × topology shapes byte-identical, `deep/duo` +111 characters.

**Why this shape and not a multi-agent pipeline.** The current reading of the literature is
that extra agents earn their place when they contribute *intelligence rather than actions* and
writes stay single-threaded — [Cognition's "Don't Build Multi-Agents"](https://cognition.com/blog/dont-build-multi-agents)
reports coordination breakdowns as ~37% of multi-agent production failures, and its core
objection is that summaries lose the implicit decisions behind them. One reviewer with no write
access is that shape; a planner → tech-planner → reviewer chain handing each other summaries is
precisely the failure mode.

It is also the only fan-out that is *real* here. `extension-lock` gives each **tab** a lane —
`main:<model>` for the conversation you are looking at, `sub:<requestId>` for a subagent turn in
a tab opened for it and closed after — so `ask_*` calls genuinely run at once, same model or
not. That was not always true: the extension addressed tabs by URL pattern, so two same-model
requests raced for one tab and could interleave two prompts into one conversation. Tab identity
is what removed that, and it is why a same-model reviewer is now offered at all. Claude Code's
subagents buy *context isolation* rather than speed, and Cursor
3's eight parallel agents are bought with **git worktree isolation** — a separate filesystem per
agent, which this project does not have and would need before parallel *writers* were safe.

**Subagents are not faster here, and the reason is measured.** Each subagent turn opens a tab
that is closed when the turn ends, so turn 2 has never seen turn 1 — **81% of characters
resent** over ten turns. Holding one tab across a subagent's turns is the largest single waste
left in the system, and it is a bridge change rather than a prompt one.

### Tools

`mcp/mcp-server.js` holds a flat `TOOL_DEFINITIONS` array (name, description, parameters,
handler) with handlers in `mcp/tools/`. To add a tool: write the handler, add one entry to that
array, **and one to `core/tool-catalog.js`** — that is what the prompt is rendered from, and
`toolCatalogDrift()` fails the build if the two disagree. The description *is* the contract.

**A name on every turn is not a trigger, and there is now a number for it.** `_buildToolAnchor`
rides every turn — 18 names, 250 characters — and exists because the model does not gradually
forget its tools, it forgets them completely. It works for that. It does **not** make a tool
fire. Across 41 sessions and 529 calls, **eight of the eighteen have never been called once**:

    find_symbol 0 · find_references 0 · open_in_editor 0 · run_background 0
    manage_task 0 · get_editor_state 0 · recall_history 0 · get_diagnostics 0

Some of those are fine — `get_editor_state` needs the companion running, `run_background` is
rare by design. `find_symbol` and `find_references` are not: "who calls this?" comes up
constantly and `grep_search` answers it worse, 58 times. So the lever for an unused tool is
never "name it again" — it is a trigger at the moment of relevance, which a standing list cannot
be. `_turnEvidence` already counts what has run this turn and is the place a nudge belongs.

**And an untagged code fence was parsed as a tool call.** `_extractToolCalls`'s regex made the
language tag optional and asked only that the body open with `[` or `{` and close with `]` or
`}`. Gemini labels an *untagged* fence "Plaintext" in its own UI and writes one whenever it
shows you something that is not code — so a reply illustrating a proposed reminder,
`[SYSTEM REMINDER: …]` … `{user_input}`, matched. Measured: `plaintext`, `text` and `bash` all
escape; **untagged is the one that matches**.

The throw is inside the `replace` callback, so it discarded the **whole reply**, correct prose
included — and the loop then sent *"Please correct the previous JSON formatting error."* into
the thread about a tool call that was never made. Models comply with false premises: it invented
one and spent the turn investigating a question it had already answered. The tag is captured now
— ```` ```json ```` is a claim the model got wrong and still earns a repair round; a bare fence
needs `LOOKS_LIKE_TOOL_CALL`, the `"name"` key the contract requires. A block that yields no call
is also no longer deleted: it returned `''` unconditionally, so a model answering "your config
should be:" had the answer removed from its own reply.

**`find_references` answered 0 for every method in the repo, and said "It may be dead code".**
A method is only ever called as `x.name()`, and `referencesIn` excluded member properties —
correctly, for a *binding*: `fs.readFile` does not use a `readFile` variable. Nothing
distinguished that question from "who calls this method?", so the second one always answered
nothing. Measured through the real tool before the fix: `buildToolResultBatch` **0** against 17
real call sites, `acceptDiff` **0** against 17, `classify` 4 (the standalone function only)
against 14. This is the `semantic_search` failure exactly — the model reaches for the tool, is
told the code is not there, and acts on it — except that here the action it invites is deletion.

`includeMembers` is the second question, and the caller has to say which one it is asking.
Hits found that way are tagged `viaMember`, because `x.name` genuinely cannot be told from a
same-named method on another object; an answer that hides its own ambiguity is the one that
gets acted on wrongly. **It is gated on the name being defined as a method in this repo**, not
on always: measured unconditionally, `find_references("map")` is 165 rows of `Array.prototype`
and `join` 180 — a wall of text about the standard library, every character of which is retyped
into a browser next turn. Neither is defined here, so the gate excludes both.

**And the definition was missing from the answer that promises to list it.** The prompt says
"list the definition too (default true)" and "the definition is marked". For a function, whose
`id` is a real Identifier, that was true; for a method, whose non-computed `MethodDefinition`
key is deliberately never visited, it never was. Added in the handler rather than in
`referencesIn`, so that function goes on answering only the question it is good at.

**`grep_search` answered 0 to `a|b|c`.** `isRegex` defaults to false, which is
`--fixed-strings`, so the most ingrained grep habit a model has searched for the literal string,
pipes included. On this repo `parseToolCall|tool_call|extractToolCalls|handleToolCall` returned
**0** where the regex returned **26**, and in the session that surfaced it the model then read a
131 KB file three times. Identifier-only alternation is searched as alternatives now, and says so
in the result; a literal `a || b` or a shell pipe is still searched as written.

**A running command shows its last five lines (v5.21), like Claude Code's Bash rows.** `run_command`
was silent until it exited. `exec` keeps collecting exactly as before — the model's result cannot
change because the screen watches — and listeners on the child's streams feed `core/output-tail.js`,
which turns chunks into finished lines (a partial line is shown and replaced; `\r` progress bars
show only what a terminal would; ANSI and control bytes stripped) and throttles to 4/s, leading and
trailing edge. The loop sends `tool_output`; the UI keeps it to itself (a side panel that draws
none of it would otherwise wake the service worker four times a second). The row reads
`◌ run_command <cmd> · 12s · +340 lines`, the clock starting when the command does rather than
at `tool_call`, which precedes the approval prompt. **The lines are charged to the live budget in
`runningLayout`** (`format.js`), after the call rows, so a short terminal drops output before a call
and the turn keeps its two rows. Measured under the pty: 0 clears after approval at 10, 13, 16 and
24 rows. The run also showed the approval *decision* row repeating the whole command — a system
row wraps, so a one-line `for` loop drew four rows charged as one — and that row now names only
the decision. **Not done:** moving a running command to the background (`ctrl+b` is the browser
key, and it needs `exec`'s process handed to `TaskManager`). **The approval box fits since
v5.24** (`approvalLayout`, `format.js`): it is drawn where the input was and was charged as the
input's three rows while drawing fifteen with a long command — 15 clears at 16 rows. Every row is
decided and truncated now, the extra rows come out of the live turn, and what gives way is padding,
reason, directory, then the border, never the command; a cut command says so on the title row. 0
clears at 10, 13, 16 and 24 rows.

**Large files and documents (v5.10).** Reported from the work laptop: simple edits in
1,000–2,000-line files went badly, and building a Confluence document from several files
struggled at the highest effort. Measured on this repo: two 800-line reads in one reply (~86k
characters against the 48k batch budget) were cut **by characters in the middle** — App.jsx lost
lines 289–641 while the result still claimed `range: 1–800` — inside minified JSON where every
line break was a `\n` escape. Now: a read goes into the prompt as plain numbered text
(`formatReadResult`); one that does not fit is cut **by whole lines** and names the missing range
with the exact `read_file` call (`fitReadResult`). `edit_file` retries an `oldText` whose every
line carries a copied `  12: ` prefix with the prefixes stripped; a miss names the nearest line
with its neighbours and the range to re-read; and `append` adds to the end without matching, so a
document is built a section at a time instead of rewriting the whole file each round (classified
addition-only, so auto mode does not stop on every section). Edit rows read `edit_file doc.md · +3 −0`
(v5.12 dropped the repeated file name the result first carried).

**A large file is read by a subagent (v6.16, `core/delegated-read.js`, plan Phase 7).** An
unranged `read_file` of a text file over 1,200 lines or 80 KB, with subagents on and `/settings` →
Large files on `subagent`, goes to a `research` tab; the main chat gets a digest (outline, quoted
passages with line numbers, how to get exact text) capped at 6k, headed "read by a subagent; this
is its digest, not the file". A range always reads directly — it is how exact text for an edit is
fetched. Subagents' own reads never pass through `_executeToolCalls`, so it cannot recurse.
Documents and files over 1 MB are not delegated. The session has a **90 s** budget for all its
turns (`runSubAgentSession(..., { timeoutMs })`), and only on a failure, timeout or empty answer
does the main chat get page 1 headed "Read it yourself: continue with startLine=801". Each one
writes a `delegated_read` notice (lines, ms, rounds, outcome). v2 documents `purpose`
(`largeFileDigest`), only while delegation is on. Pty: main prompt 850 characters after a
2,000-line read (43.7k on the fallback, which is page 1); 0 clears at 13 and 24 rows.

**`query_log` reads log exports (v6.20, `mcp/tools/query-log.js` + `log-records.js`, plan
`.agent/artifacts/plans/2026-10-30-log-query.md`).** Asked for Grafana/Datadog exports "to debug
issues". `read_file` pages 800 lines, and `grep_search` is line-based. A Datadog JSON export is
often one line, so a hit is the whole file; a CSV message holds newlines, so a hit is half a record.
`log-records.js` streams NDJSON, JSON arrays and wrappers (Datadog `data[].attributes`, Loki
`data.result[].values`, Grafana columnar frames), CSV/TSV with quoted multi-line fields, and text,
where an indented line joins the record above. Any of them may be `.gz`. Each comes out as a flat
record with dotted keys.

`query_log` finds time, level, message and source by name, and answers in ≤6k characters of text.
- **With only a path**: the levels, a 12-bucket histogram with errors per bucket, and the repeated
  messages, numbers, ids and quoted values replaced, errors first. Then the fields and their top
  values, where values repeat.
- **Narrowing**: `where` (`field=value` … `>=`, a field by its last part, `level`/`message`/`time`
  whatever the file calls them), `text`, `from`/`to`, `groupBy` (counts only, unless `limit` is
  given) and `around` (`#n` or a time, unfiltered, and reading stops after it).
- **Times**: epoch values are read by magnitude. A time with no zone is UTC, so it is shown as
  written; it was local time at first, five and a half hours off.

Measured: 200 MB NDJSON overview 4.0 s; a 248 MB one-line Datadog JSON 5.3 s; RSS under 215 MB.
It is **v2 only** (`logQuery`). A catalog entry's `flag` keeps it out of the frozen v1 tool list,
and the reachability guards hold a gated tool to the version that offers it. On v2, an unranged
`read_file` of a large log (`core/log-read.js`) gets the overview, headed as one. That applies to
`.log`, `.jsonl`, `.ndjson`, `.csv`, `.tsv` and `.gz`, and to a `.json` whose head has a time key
and a message or level key, so `package-lock.json` is not one. It runs before the v6.16 subagent
digest. Pty: a 1.4 MB one-line export read with `read_file` became a 2,370-character prompt; 0
clears at 13 and 24 rows.

**`read_file` reads documents (v5.29, `mcp/tools/documents.js`).** Before it, a PDF was decoded as
UTF-8 and handed to the model as mojibake with no error. Now PDF (`unpdf`, pinned exact,
lazy-imported), `.docx` and `.pptx` (a small zip reader over `zlib`, no dependency) come back as
**Markdown, not JSON**: headings, `- ` lists, pipe tables, a `--- page N ---` / `--- slide N ---`
line each, through the same numbered-text path as any read, so ranges and `fitReadResult` work
unchanged. JSON was asked for and declined — escaping costs the line structure ranges depend on
and ~10–20% more characters typed into the tab. `.doc`, `.rtf` and `.odt` go through macOS
`textutil` (stderr not inherited, like `OSASCRIPT_STDIO`); elsewhere the refusal says to save as
.docx or .pdf. A PDF with no text layer says so in one line instead of returning blank. Anything
else with a NUL in its first 8 KB is **refused**, naming what can be read. Extractions are cached by
path, size and mtime. Pty: one turn reading a PDF, a .docx and a .zip — the prompt log holds the
two as numbered Markdown and the refusal, 0 clears at 13 and 24 rows.

**`/doctor` and `agent doctor` say what is installed (v5.29, `core/doctor.js`).** Asked for for the
work laptop, where an install can miss a package without anything crashing. `dep-recovery.js`
handles the loud case (a startup import is missing: install once, restart); this is the quiet
ones — an **optional** package (`unpdf`, imported only when a PDF is read), a wrong version, a
missing tool (`git`, `rg`, `textutil`). Every package has a tier (`required` / `optional` /
`build` / `test` / `dev` / `unused`) and a **why** in `PACKAGES`; `/doctor <package>` prints it with
what breaks and the files that import it. `doctor.test.js` holds the prose to the code: every
declared package has an entry, `required` is a static import, `optional` only a lazy one, and
`doctor.js` imports **only built-ins** — the bin runs `agent doctor` before looking for `tsx`, and a
missing `tsx` prints the offline report. Latest versions come from `npm outdated`, which uses the
user's npm config (a company registry, proxy and auth); a refusal is reported with npm's reason,
never as "up to date" — empty output with an error parsed as `{}` did exactly that at first. A
missing required/optional package shows one startup row (`✗ unpdf not installed · /doctor fix …`),
and the slash palette now gives way to notice rows: it always offered six, which overflowed 13
rows by one with that row up (2 `ESC[2J`). 0 extra clears at 10, 13, 24 rows. It found
`ink-spinner`, declared and imported by nothing — listed as `unused`, and removed in v5.31.

**v5.31: optional packages can be uninstalled, and ripgrep needs no installer.** An optional
package gets **Uninstall** (`npm uninstall`, out of `package.json` too, so a later `npm install`
does not quietly bring it back); it then stays listed as `removed` — dim, not a fault, no startup
row — with **Install** at `PACKAGES[name].restore.range` (held to the manifest by a test). The home
list has **Remove unused** when anything is. A required package no longer repeats "The agent does
not start" under its tier (`withoutBeyondTier`). **ripgrep:** the work laptop has no Homebrew, and
every VS Code ships rg for its own search (`@vscode/ripgrep-universal/bin/darwin-<arch>/rg`;
Cursor's `@vscode/ripgrep/bin/rg`). `core/find-rg.js` looks in `AGENT_RG`, then PATH, then the
editors' bundles; `grep_search` and `/doctor` both use it, and the tool row reads `from Visual
Studio Code`. `doctor.js` may import local modules now, and the built-ins test follows them down.

**`/doctor` is a menu since v5.30 (`ui/doctor-view.js`, the `doctor` type in `Menus.jsx`).** Tabs
All · Required · Optional · Other · Tools (tab or ←/→). Enter opens a package: why, versions,
importers, then actions: install what `package.json` wants, update to latest, choose a version (`npm
view … versions`), **remove** for the `unused` tier. A missing tool gets its installer (`brew` on
macOS, `winget` on Windows; Linux only names `sudo apt …`). A failed install says one line, and
**Show the error** opens the installer's output. Esc goes back one view; only the list closes. It
opens on disk state with no network, and `npm outdated` fills in behind it. A version install keeps
the range's style (`installArgs`: `^`, `~`, exact). `/doctor report` prints the old table. **A change
that breaks the next start is undone** (`core/doctor-guard.js`): manifests and lockfile are copied to
`~/.agent/doctor-change.json` first; a start up 8 s confirms; a non-zero exit before that makes
`index.js` restore, `npm install` and start again, once. The record holds the changing session's pid,
because that session crashing proves nothing about the change. Not yet driven end to end: the unit
tests fake the install.

**Two things at once (v5.30).** Messages typed during a turn or the warm-up queue; local commands
run beside the turn. Two gaps closed. Overlapping slow commands lowered each other's spinner, and a
turn's: App counts them (`slowCommands`). And two `npm install`s could write one `node_modules`:
`core/local-jobs.js` has one `install` slot, which `/doctor fix`, menu installs and `/update pull` take,
and a second caller is told who holds it, not queued. **Ink 7.1.1 handles a key typed in its first
200 ms twice**: kitty auto-detect adds a `data` listener beside Ink's reader and `unshift`s what it
saw. A warm start at 13 rows (no intro) put the prompt in that window: `/` became `//`, "No such
command: //help", on `main` too. `ui/ink-probe-hold.js` holds keys until the window has closed and
passes the probe's reply through. The palette also lost the spinner's two rows during a turn (4
clears at 13 rows on `/`). Settings rows for Theme and Workspace now open with `returnTo`, so esc
steps back to settings. Pty: 0 clears at 13 and 24 on every path.

`find_symbol` / `find_references` (`context/symbol-index.js`) are the structural half of code
search, on acorn + acorn-jsx + acorn-walk. Two traps, either of which reproduces the failure
that got `ast-chunker` deleted: `acorn-jsx` teaches the *parser* and not the walker, so a `.jsx`
file parses and then throws `No walker function defined for node type JSXElement`; and
`acorn-walk` defines `ImportSpecifier` as `ignore`, so `import { X }` is never visited and "who
imports this?" answers nothing. Built lazily and cached by mtime — 135 ms cold, 3 ms warm on
this repo, 282 of 282 exported symbols.

**Ruby since v6.8 (`context/ruby-symbols.js`), by line patterns, and acorn is loaded on first
use.** `.rb` and `.rake` files are indexed rather than skipped. Definitions come from `def`
(operators and any receiver included), `class`, `module`, constants, `attr_*`, `alias`,
`alias_method`, `define_method :x` and `scope`. References are word matches on code lines, with
comments, `=begin` blocks, heredoc bodies and string contents blanked (`#{}` kept). Checked
against Ripper over the 1,093 `.rb` files macOS ships: **17,628 of 17,641 definitions (99.9%)**,
160 ms cold. The first cut found 92.4% because a heredoc named in a *comment* blanked the rest
of the file. Answers that include Ruby carry `rubyNote` (no run-time methods, no names in
strings, `x.name` is any object's), and a Ruby file in `find_references` is marked `byText`.
`vendor/bundle` is ignored. acorn, acorn-jsx and acorn-walk are `optional` in `/doctor` now;
`loadJsParser()` imports them, and if that fails JavaScript is listed as skipped with the
reason. `find_symbol`'s "JavaScript and JSX only" is v1's frozen text; v2 names Ruby
(`symbolLanguages`), since a tool description is part of the prompt.

**References are precise since v6.19.** Measured against Ripper's lexer over every name defined in
macOS's Ruby stdlib (883 files, 8,570 names): precision **91.8% → 99.5%**, recall **99.1% →
99.96%**. `codeOf` is a literal scanner now: regexes (`/…/` after an operator, keyword, or
`name ` with no space after, as Ruby reads `split /,/`), `%w[] %i[] %q() %r{}` and friends, strings
nested in `#{}`, `?/` one-character strings and heredoc bodies' `#{}`. A literal open at the end
of a line carries into the next, capped at `CARRY_MAX` (40) so a misread start cannot blank a
file — the first run lost forty lines of `fileutils.rb` to `chomp(?/)` read as a regex. A method
named like a keyword (`next`, `class`) matches only after `.`, `:` or `def`; `__END__` ends the
code. Definitions lost by the carry were all inside strings (Ripper's `def` count agrees). Cost:
115 ms for the 883 files against 67 before, cached by mtime; lines with no quote, `/`, `%`, `?`,
`#` or `$` skip the scan. The comparison scripts are `rb/lex.rb` and `rb/compare.mjs` in the
session scratchpad: `ruby lex.rb $(cat files.txt) > lex.json`, then `ALL=1 node compare.mjs lex.json`
from `server/`.

**A partial read of Markdown ends with the headings it did not show (v6.14, `unreadOutline` in
`mcp/tools/read-file.js`).** Asked about this agent's architecture, the model read README lines
1–100 and 90–150 and answered from them; the pointer to this file sat under `## More` at line 258,
and nothing in either read said that section existed. `#`–`###`, fenced code skipped, capped at
40, written `- ## More (line 258)` because `fitReadResult` reads a leading number as a shown line.
`AGENT.md` (in every turn-0 prompt) and README's "How it works" now point here too.

`executeTool` retries transient OS errors (EBUSY/EACCES/EAGAIN/EMFILE/EPERM) with
backoff and rewrites `errno` codes into LLM-readable instructions.

### Workspace

`core/workspaces.js` owns path handling for the workspace: `resolveWorkspaceInput` (`~`
expansion, relative paths, quotes), `validateWorkspace` (exists / is a directory / readable) and
`listWorkspaceCandidates` for the `/set-workspace` picker. `AgentLoop.setWorkspace` is the one
place that rewires the collaborators that hold a copy of the path — `/workspace` and
`/agent-dir` each used to carry their own list and had already drifted. SessionStore is
deliberately *not* rebound: doing so would write the current conversation into another
project's history.

### Approval path

Writes never go straight to disk. `edit_file` / `create_file` produce a `DiffEngine`
(`core/diff-engine.js`) diff with per-hunk accept/reject, backups, atomic writes, and `undo()`.
Commands pass through `core/risk-classifier.js`, which decides whether `App.jsx` must prompt;
persistent allow/block rules live in `commandRules`  (`/allowlist`).

**Rails (v6.19).** Anything aimed at production (`RAILS_ENV=` / `RACK_ENV=production`,
`-e production`, `--environment=production`, `DISABLE_DATABASE_ENVIRONMENT_CHECK=1`) is
`critical`, which is blocked outright in every mode, and says to run it yourself. A task that
drops or rewrites the database (`db:drop`, `db:reset`, `db:purge`, `db:schema:load`, …, through
`rails` or `rake`) stays `risky` — asked about in every mode, auto included — but under its own
reason, where it used to read "Mutating shell command" like `rspec`. Both only for a command that
runs something: `grep RAILS_ENV=production config` is a search.

**Who may run what is `core/tool-policy.js`, not `_executeToolCalls`.** Two pure functions —
`isBlockedOutright` and `requiresApproval` — over the catalog's own `mutates`, `shell` and
`detached` flags. It was decided inline, 487 lines deep in dispatch, and that is precisely how
`run_background` came to skip every gate: the plan-mode branch named the mutating tools
literally, a fourth was added later and not added there, so the mode whose status bar reads
"plan — every edit needs approval" spawned a detached shell process without asking, while auto
mode asked about the same call through the classifier's "Unknown tool" default. **The careful
mode was the permissive one.** The fix is not "add it to the list" — there is no list any more,
so the next tool that writes is gated by declaring itself beside its description.

**And the extraction immediately found a second one of the same shape.** The read-only
exemption — `ls` must not need a keystroke, or the prompt becomes something people dismiss
without reading — was written as *any shell tool the classifier calls safe*, and
`run_background` is a shell tool. So `run_background npm run dev` was exempt on the strength of
a verdict about the **command text**, while the process it spawns is still running after the
turn, the mode, and possibly the session have ended. The classifier reads a string; it cannot
see that. `DETACHED_TOOLS` is the flag that lets the exemption ask. It was invisible while the
policy was a branch inside dispatch and took one test to surface once it was a function.

**The rest of the dispatch loop came apart the same way.** `_executeToolCalls` was 487
lines; it is 240 now, and the two pieces that left are the two that were doing something other
than dispatching.

`core/loop-tools.js` holds the three the loop answers itself — `ask_question`,
`ask_subagent`, `manage_memory`. The catalog has said `dispatch: 'loop'` about them since it
was written, and the chain named them literally with an `else` sending everything else to
`mcpServer.executeTool`: a fourth loop tool would have gone to a server with no handler and
come back to the model as an unknown tool it had just been told it has. `LOOP_TOOLS` is derived
from the catalog now, so the two cannot disagree.

**The drift check caught the move, which is the point of it.** `LOOP_DISPATCHED` in
`tool-catalog.test.js` scrapes the dispatching source rather than deriving from the catalog —
derived, it would be comparing the catalog to itself. It went red the moment the arms left
`agent-loop.js`, and it now reads `loop-tools.js`. **The file it reads must be the file with
the implementation in it.**

`core/diff-approval.js` holds what happens between building a diff and it being on disk. Three
parties have to be told the same thing about that, and each has been the odd one out: the model
(told `pending_approval` about a file already written), the screen (a rejected edit drawn in
green), and the disk (the only one never wrong). Keeping them in one function is the reason it
is one.

**A mechanical extraction tried to drop a line and the comments are why it did not.**
`manage_memory` computes its result and *then* calls `resetPromptState()` — the facts ride
inside `<memory>` in the system prompt, so a changed set is invisible until that prompt is
rebuilt. A regex turning `result = x` into `return x` deletes the call silently, and the tool
goes on reporting "Remembered:" for facts the model will never see. Written by hand instead,
and `loop-tools.test.js` asserts the reset on both paths and its *absence* on a rejected action,
which would otherwise spend a full turn-0 payload to change nothing.

**Three modes since v5.11 (`core/modes.js`): `plan`, `auto`, `strict`.** Asked for on 2026-10-24,
because building a document section by section in plan mode asked for every section. `strict` is
the old plan mode, described below unchanged. `plan` additionally writes Markdown **inside the
workspace** without asking — decided by location, never by extension alone — except the
instruction files (`AGENT.md`, `CLAUDE.md`, `GEMINI.md`), which is the line the paragraph below
was written to hold. The prompt states the exception in plan and not in strict, because the two
disagreeing is the failure recorded below. Tab cycles plan → auto → strict.

**A plan review opens only for a plan still waiting (v6.7, `planWorthReviewing` in
`ui/plan-box.js`).** "hi" on Flash-Lite in plan mode wrote `task.md`, a one-line plan, ticked it,
said hello, and ended on *Plan ready for review* with the editor opened. The review and editor are
skipped when `task.md` was written after the plan with nothing unticked, or the plan has fewer than
two steps and under 200 characters. v2's cheap rungs also lose "ALWAYS proactively create a task.md"
(`answerDirectly`); v1 still says it.

**Plan mode exempts the agent's own artifacts, and nothing else.** *(Now true of `strict`.)* The check was
`path.endsWith('.md')`, beside a comment reading "Creating/Editing Markdown files (like plans)
is harmless". The intent was real — `task.md` and `plan.md` are files the system prompt *tells*
the model to keep current, and it cannot do that if every tick needs a keystroke. But the test
was the **extension**, not the **location**, so in plan mode the agent could silently write any
markdown anywhere: `README.md`, `CLAUDE.md`, and `AGENT.md` — the one file this project promises
"can always be trusted to say what the human wrote" — plus anything outside the workspace,
because these tools accept absolute paths.

Reported from use: `create_file test-agent-cli.md` in plan mode returned `"status":"applied"`.
Meanwhile `prompt-builder.js:362` tells the model *"All file modifications and command
executions require user approval before being applied"* and the status row reads *"plan — every
edit needs approval"*. **The model was told the truth and the enforcement was not doing it** —
which is the worst arrangement of the three, because nothing on screen or in the prompt gives
you any reason to doubt it.

`isAgentArtifact` resolves the path and prefix-checks it against `paths.artifactsDir`, because
the model supplies that string: `task.md`, `./task.md`, an absolute path and
`.agent/artifacts/../../../task.md` are one string test and four different files. It fails
closed — anything unresolvable, or outside, needs approval.

### Subagents

**There is one delegation tool and one switch.** `AgentLoop.topology` is gone — it survives
only in `_loadConfig`'s legacy folding, where a stored `topology: 'duo'` is read and discarded.
What remains is `subagentsEnabled`, derived from `modelConfig.subagents !== false`: absent means
**on**, because a config written before the toggle existed had the subagent tools available and
reading it as "off" would silently take a capability away from every existing workspace.

`ask_reviewer` and `ask_researcher` are gone too. They were the same tool three times —
`buildSubagentWrapper(role)` took the role and ignored it, so all three got one generic wrapper
and only the names implied otherwise. One `ask_subagent` with `role: "review" | "research" |
"task"` replaces them, and `isParallel` is now `call.name === 'ask_subagent'` rather than a list
of three. Calls run **in parallel**, each in a *different browser tab* on its own
`sub:<requestId>` lane. `_runSubAgentSession` gives subagents a restricted tool set.

**A description is a routing rule, not a capability list.** Of the three old descriptions only
`ask_researcher`'s said *when* to reach for it; `ask_subagent`'s said "Delegate a task to a
generic parallel Gemini subagent" — a capability with no trigger, which is the documented reason
auto-delegation never happened. Every role in `tool-catalog.js` now leads with its trigger.
Measured across 41 sessions and 529 tool calls: `read_file` 187, `grep_search` 58,
`ask_subagent` 8, `ask_reviewer` 4 (pre-collapse) — **delegation at 2.3%**. That figure spans
both sides of the rewrite, so split it by date before concluding the triggers did not work.

**Duo is two Gemini tabs, not two models,** since ChatGPT was removed. What the reviewer
contributes is not different weights: it is a reader with **no memory of the conversation that
produced the work**. That is the half that matters for the failure it exists to catch — a model
that reads enough to cite and then reasons from the citation instead of reading on. A cold
reader has nothing to reason from but the file, so it opens the file. The `reviewer !== main`
guard that used to forbid this was written when two same-model requests raced for one tab; tab
identity fixed that, and the guard outlived its reason.

### Context engine

`context/` — `code-minifier`, `context-manager`, `memory-manager`, `symbol-index`. `CodeMinifier.minifyJson` is on the hot
path: `PromptBuilder.buildToolResultBatch` embeds every tool result in the next prompt, and
serialising them compact rather than pretty-printed is ~40% fewer characters there — measured
on a 30-entry `list_directory` shape: 2,456 pretty against 1,424 compact, **42%**.

**Nothing had ever called it from a test, and two things were wrong behind that.** Every
fixture in the suite passed a *string* result, so the branch that serialises an object was
never taken — while real tool results are mostly objects. `undefined` came back as `undefined`
rather than a string, under a `@returns {string}` annotation, and the caller reads `.length`
off it, so the whole prompt build throws and every other result in the batch dies with it.
Worse, **a cycle or a BigInt threw, was caught, and returned `''`** — the model handed a tool
that ran and produced nothing, which is a confident wrong answer where the other is merely a
dead turn. A replacer keeps what can be serialised and marks what cannot.

Neither was reachable from a path traced today — every `ask_question` resolver passes a
`result` — so this is a contract made true rather than a reported bug. The doc already promised
a caller could "pass it anything a tool handler might have produced".

There is no `ast-chunker` and no `skills/` registry any more. Both were written, never wired to
anything, and removed on 2026-09-10: the chunker resolved 24% of this repo's top-level symbols
(it walked only `ast.body`, so every class method and every `export const foo = () => {}` missed,
and plain acorn cannot parse the `.jsx` files at all), and `SkillRegistry` was a second, parallel
way to declare a tool that competed with `mcp/mcp-server.js`'s `TOOL_DEFINITIONS` — which is the
one described above and the one that actually runs. A per-symbol read tool is still a real gap;
it wants `acorn-walk` plus `acorn-jsx`, not that file.
`watcher/file-watcher.js` reports external edits into the history.

**The watcher took the shell down on a large repo (fixed v5.6).** On the work laptop, 2026-10-23,
*every* spawn failed with `spawn EBADF` — nine `run_command`s, `run_background`, the browser-open
at launch, `/update`'s git — so approved Ruby scripts never started and `/update` claimed the
checkout was not one. macOS refuses `posix_spawn` once a process holds a descriptor numbered at or
above `OPEN_MAX` (10,240 — bisected to the descriptor), and chokidar 4 dropped fsevents, so it
holds about one descriptor per watched *file* (852 for 131 directories here). A big repo crossed
the line at startup. On macOS and Windows the watcher is now Node's recursive `fs.watch` —
FSEvents, **zero** extra descriptors on the same tree. chokidar was kept for Linux until v5.31,
then removed (owner: this is a macOS tool); Linux uses the same `fs.watch`, recursive since Node
20, and a tree past `max_user_watches` only turns the announcements off. Ignores are
by path segment (the old regexes silently ignored `distance.rb` as `dist/`) and add `vendor`,
`tmp`, `log`, `coverage`. A spawn `EBADF` is rewritten for the model as "the command never
started, do not retry", and `/update` says git could not run instead of "not a git checkout".
Verified end to end on a 15,000-file tree under the pty: `main` hands the model `EBADF`, this
hands it the command's output. **Any new long-lived resource per file is the same bug.** `semantic_search`
is backed by a local TF-IDF index.

### Where `.agent/` actually is

`workspace` used to mean two things: where state lives, and what the agent works on. In a
monorepo those come apart, so `paths.resolveState(workspace)` walks *up* looking for an
existing `.agent/`, the way git finds `.git`. The first hit is the **root**; the path from it
down to the workspace is the **scope**.

```
/base-repo/.agent/             root — shared by every repo
├── skills/  config.json                            inherited
├── repo-1/   artifacts/ state/ sessions/ logs/     this repo only
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

**The landmine:** `homeDir()` is `~/.agent`. A naive upward walk from any project under `$HOME`
finds it and would adopt the global home as a project root, pooling every project's state and
leaking every project's rules into everyone else's prompt. `resolveState` excludes it and stops
walking at `$HOME`; `paths.test.js` covers it.

| Path | Contents |
| --- | --- |
| `<ws>/.agent/config.json` | topology, `modelConfig`, `commandRules`, `memoryEnabled`, `agentName`, GitHub token |
| `<ws>/.agent/memory.md` | what the agent learned here — scoped, never walked, read back into `<memory>` |
| `<ws>/.agent/artifacts/` | `task.md`, `plan.md`, `walkthrough.md` — written for the user to read |
| `<ws>/.agent/state/` | `editor.json` (VS Code companion), `github.json`, `plan-approval.json` |
| `<ws>/.agent/github-pr-plans/` | GitHub PR agent output |
| `<ws>/.agent/logs/errors.jsonl` | structured failure log — one JSON object per line |
| `<ws>/.agent/logs/commands/<date>.jsonl` | every shell command run, blocked or rejected — an audit trail, never read back into a prompt |
| `<ws>/.agent/backups/`, `context/`, `logs/`, `tmp/` | see `paths.js` |
| `<ws>/.agent/sessions/history.jsonl` | conversation history, local copy |
| `~/.agent/workspaces/<name>-<hash>/history.jsonl` | the durable copy of the same history |

**Resuming has two doors, and one of them used to skip the browser.** The model's memory is not
`history.jsonl` — that is the *human's* record. It is the chat thread in the tab, and Gemini keeps
that thread's id in the URL (`/app/<id>`), which `session-meta.json` stores. `resumeSessionById`
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
from `session-meta.json`; `resumeThreadOnConnect()` drains it when a client **identifies as an
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

**A session with no user turn is not filed.** `watcher/file-watcher.js` appends
`[System Event] File X was modified` turns whenever anything on disk changes, so leaving
the agent open while editing in another window manufactures history containing no prompt.
Filing those put **6 of 19** rows into a real `/history` picker, every one reading
`Untitled` with a turn count and nothing to tell them apart — a third of the list was
watcher noise, in a picker whose only job is choosing. Dropped rather than titled better,
because a better title is still a row offering to restore a transcript of file
notifications.

**`/reset` starts a repo fresh, and moves rather than deletes (v5.6).** Both copies go — the
repo's `.agent/` and `~/.agent/workspaces/<slug>/`, or the reconcile on the next start brings the
history straight back — to `~/.agent/trash/<slug>-<stamp>/`. Only `core/reset.js`'s
`STATE_ENTRIES` move: a monorepo root holds every sibling's scope folder, and this repo's own
`.agent/` held a stray `server/` scope, so an unknown entry is listed and left. `skills/` stays
(a person wrote it); `--keep-settings` also keeps `config.json` and `memory.md`. It restarts,
because the loop would write the old conversation back.

**Issue #68, "output clearing in new subsequent prompts", was this (reproduced 10-24).** Filed
against v5.4: prompts drawn, replies never. Under the pty on v5.4, auto-compaction rewrote the
history at the start of a prompt and every reply after it was answered, saved, and never drawn
— the screen measures what it has drawn by position, and the front had moved. Same scenario on
v5.16: every reply drawn. `test/ui/reply-after-compaction.test.js` pins it, with the v5.4
behaviour as its control.

**Compaction never handed anything over, and ran beside the turn (fixed v5.9).** Found under
the pty by logging every prompt the fake extension received: the first prompt in the fresh chat
had the system prompt and the next message and **no summary**. The summary was a `system` turn,
`pendingRecap` skips those, and nothing else read it — the write-only trap a third time, on the
mechanism that runs exactly when a session is longest. It also fired at the *start* of a turn,
alongside it, and `startNewChat` had no lane check, so the tab could move to an empty chat
mid-round. And the summary came from re-pasting every older turn, results replaced by
placeholders, into a cold tab. Now (`core/compaction.js`):

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
- **Handed over once** as `<compacted_context>`: summary, the archive pointer naming
  `recall_history`, and the kept turns capped (1.5k each, 6k total). The count restarts at **zero**
  — counting the kept turns in full re-triggered it on the next turn (a 335k-character reply).
- **The screen survives the rewrite.** `historyOffset` records how far the front moved;
  `mergeLoopHistory` positions are absolute, or the kept turns are drawn twice. The turn commits
  while compaction runs (`turnInFlight` excludes `isCompacting`): holding a long final reply live
  under the progress row was 8 full clears and 3.1 MB for one compaction; now 0.
- A three-stage progress row (`Compacting ▰▰▱ opening a fresh chat…`, esc cancels with nothing
  changed); the status bar says `N% to auto-compact` within 20 points; every compaction writes a
  `compaction` notice with which path ran.

**Compaction keeps what it promises (v6.15, plan Phase 6).** The fresh chat gets the summary plus
the last **3 exchanges** (`splitForCompaction`: from the third-last user message, however many rows
follow), not the last five rows of any kind — replayed against real history those were empty in 28%
and one row in 41%, filled by watcher and tool rows. Watcher rows (`type: 'fs_event'`) are not
turns for any count a person reads (`countTurns`: `/compact`'s guard, "Compacted N turns",
`/context`, settings, the local summary); storage is unchanged. The agent's own writes are no
longer announced as edits "made externally by the user": `DiffEngine._writeFileAtomic` notes the
path and its temp file in `core/own-writes.js` and the watcher drops events for that path within
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

`core/migrate.js` folds the pre-`.agent` layout (`.gemini/`, `.gemini-agent/`, `~/.gemini-agent/`,
`.agent-github-plans/`, root `setAgentName.json` / `agent.log`) into `.agent/` on startup. It
runs only when `.agent/` is absent, moves rather than copies, and is a no-op on the second run.

**Those three claims are now assertions** (`test/core/migrate-workspace.test.js`), because the
module moves the user's data — config, instructions, backups, logs — on startup, before
anything is on screen, and it sat at **46% line coverage** with one narrow rename tested. Same
combination as `diff-engine.js`, which was 358 lines with no tests and was writing backups
outside the backup directory.

Nothing was wrong: all four behaviours were probed against the real code first and all four
held. What the tests buy is that the failure mode is silent and unrecoverable — a migration
that clobbers has already destroyed the thing it overwrote by the time anyone looks. The one
that would hurt most is `rules.md` → `AGENT.md`, the only move that writes into the user's
*tracked* tree; the test asserts both that a human-written `AGENT.md` survives **and** that
declining to move it does not delete the source instead. Coverage 46% → 70%.

**A wrong fixture made correct code look broken first.** The first probe put sessions in
`.gemini/sessions/`, which never existed — they lived in the *home* directory, and
`migrateHome` handles them. The fixture has to come from the migration's own plan, not from
memory of what the old layout probably was.

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
`chat-queue.jsonl` (append-only; "Add to Agent Chat" selections, drained by `ui/chat-queue.js`),
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

A turn started in the panel runs on the server's callbacks, so the terminal draws it on its
next turn rather than live — the same as the Chrome side panel always has. A turn started in
the terminal reaches the panel live, through the mirror.

**Chrome assigns a command's `suggested_key` only on first install** — reloading an unpacked
extension adds the command with nothing bound, and the shortcut silently does nothing. Reported
the day it shipped. The worker sends `floatingShortcut` on identify (`''` = unbound, `null` =
unreadable) and the server's `shortcutNotice` says to set it at `chrome://extensions/shortcuts`.

**Exit clears and prints `agent --resume <id>` (v5.4, `ui/farewell.js`; kept the transcript in
v5.20–v5.22; since v5.23 it erases back to the shell line that launched it, nothing at all when
there was no conversation).** Startup asks the cursor row (`ESC[6n`) before the first frame and no
longer `console.clear()`s; `ui/screen-span.js` follows every byte written (stdout.write is wrapped)
and moves that row up on each scroll; exit asks again and rewinds only if the two agree — else (the
launch line scrolled off, ctrl+e cleared, no answer) it clears screen and scrollback and puts the
footer at the top. The reports are matched out of stdin before Ink sees them. The pty driver answers
`ESC[6n` from a live pyte screen (`NO_DSR=1` for the fallback). An *exact* Claude Code exit for a
session longer than one screen needs the alternate screen, which costs native scrollback. Every way out — a double ctrl+c, `/exit`, SIGINT, SIGTERM — calls Ink's `clear()`
(erases only the live frame and syncs its log, so the final render on unmount writes nothing),
unmounts, clears screen and scrollback, then prints Claude Code's footer at the top (v5.21: `Resume this session with:` and the command on
a line of its own, dim, flush left, the shell prompt directly under it) — or nothing, when there was
no conversation. Dim is gated on a TTY, not on `NO_COLOR`, as the `mono` palette is. The id is
`SessionStore.liveId()`: allocated on first ask, kept in `session-meta.json`, and used by
`rollover`, so the id at exit is the id in `/history`; `--resume <live id>` before it is filed
behaves as `--continue`, and a resumed conversation keeps its id (`listSessions` keeps the
newest row per id). **ctrl+c is no longer Ink's** (`exitOnCtrlC: false`): Ink's handler
unmounted the app and left the process alive behind a frozen prompt, measured under the pty.
The second press is decided in cli-ui on the raw stream (`interruptGate`), below React, so a
broken render cannot trap anyone; App only clears the prompt and shows the hint where `/help`
sits.

**Two shortcuts reach the panels (v5.3).** `cmd+alt+j` in the editor focuses the chat view —
next to `cmd+alt+l` (Add to Agent Chat), and deliberately not `cmd+esc`, which the Claude Code
extension owns, nor `Ctrl+G`, which Chrome grabs globally for its own Gemini panel before the
editor sees it. In Chrome, `open-floating-panel` is a **global** command (`Ctrl+Shift+1`,
`⌘⇧1`): it fires while Chrome is in the background and focuses the floating window rather than
opening a second. Chrome's Gemini panel itself (`chrome://glic`) is browser UI with no
extension API — it cannot be the bridge, and nothing here tries to reach it.

**And the Chrome side panel's diff buttons had never worked.** `appendDiff` wrote
`onclick="respondToDiff(…)"`, and MV3's default CSP for extension pages refuses inline
handlers — so Accept and Reject did nothing and a diff could not be answered from the panel.
The tool-row expander had the same fault. Listeners now, and `diff-buttons.test.js` runs in
jsdom without `runScripts`, which models the CSP honestly: the old markup fails it.

### Failure logging

**Bare `/logs` is a picker (v5.35, `ui/logs-view.js`)**: Failures · Speed · Tools · Text channel ·
Notices · Clear, each row carrying its one-line answer, enter opening the typed form's full text.
It used to open only once something had failed, so "is it slower?" needed the word `extension`.
Failures is a second view of flows (esc steps back). The old summary is `/logs failures`; `/logs
speed` is new. Traces now record `promptVersion`, so Speed splits reply time by version as Tools
splits rounds. Pty: 0 clears at 13 and 24 rows.

`core/error-log.js` writes every failure to `<ws>/.agent/logs/errors.jsonl`, tagged with the
flow it came from (`bridge`, `extension`, `agent`, `tool`, `github`, `task`, `diff`, `context`,
`ui`). `/logs` reads it back grouped by flow; `/logs <flow>` drills in.

It exists because failures here are spread across processes that cannot see each other — a
content script in a Chrome tab, the bridge, the loop, the tools, the poller — and the symptom
surfaces far from the cause. The console was the only sink, and console output inside an Ink
app is destroyed by the next repaint.

Two properties are load-bearing. It **never throws** (every caller is already on a failure
path). And it **collapses repeats**: identical failures inside a 60s window are counted rather
than written, because a poller failing every tick used to bury everything else. The tally is
written as its own record marked `tally: true` when the window closes or the process exits —
so a storm of 500 shows as 500, not 1, and the tally line is never miscounted as another
occurrence.

**Failures and notices are counted apart, and the number was off by a factor of 25.** Over
09-25 → 09-27 the log held **274 rows**; roughly **ten** were product failures. The largest
single entry was **65 rows** of a background `discover_models` poll declining to open a tab
at connect, before any tab exists — correct behaviour, filed as a failure on every session
forever. While that was true nobody could open `/logs` and see a regression, which is the
only thing the log is for. `logNotice` writes a `level: 'notice'` field; `summarizeErrors`
counts failures and reports notices beside them; `/logs notices` lists them.

The field is present **only** on notices, so every line written before it existed reads as a
failure — the honest reading of history, since those rows were written by call sites that
believed they reported breakage.

**Demote, never drop.** `/logs <flow>` still shows both, marked `✗` and `·`: a notice beside
the failure after it is often the explanation, and one `extension_stale` accounts for the six
selector faults under it. The temporary `picker_trace` instrumentation is what found the
relay-drift bug in one run after five wrong theories had been *shipped*; a log that discards
what is merely expected cannot be used to find out why an expectation was wrong. The bar is
**should a reader act on this**, never whether it is interesting.

**Two ops were one name for two opposite readings, and both needed a discriminator rather
than a verdict.** "No tab" is expected for a background poll and a real fault for an
`/effort` that has already tried `ensureModelTab` and failed — and only the extension knows
which, because `userInitiated` lives in the browser, so `level` travels on the `error`
payload. `stale_response` meant either *you pressed stop*, where discarding the reply is the
feature working, or *a watchdog gave up*, where the deadline was shorter than the work;
`noteUserStop` records the difference and `handleUserMessage` clears it, because a reason
with no clock is a flag that ages into a lie. **Never demote by op name** — the op is what
the two cases share.

**And how loudly something is recorded must not decide what the bridge does about it.** The
`error` case still settles `NON_FATAL_EXTENSION_OPS` and resolves `session_lost` regardless
of level. **It holds the other way too, and 1.41.0 shipped proof:** `menu_left_open` was a
notice on the `error` channel, and the bridge decided fatality by op, so it aborted every lane
including the user's turn. A notice is now never fatal, checked *after* the settle and
`session_lost` branches. An allow-list of the ops that may stay alive cannot enforce this: the
next informational op falls into the same hole. Coupling those is how a demoted row stops settling a watchdog, which is a hung turn
reported as a quiet log.

`writeTally` is one function because it had been two — `flushExpired` and `flushPending` held
a copy each, and deleting the level from one left the whole suite green because every test
reached the other. The storm test could not catch it either: inside the 60s window the tally
is still a number in memory and never reaches disk, so **a test that never advances the clock
does not test the collapse.** `test/core/log-levels.test.js` calls `flushPending` for exactly
that reason, and every demotion there has a negative control naming the case that must stay
loud.

### The command log

`core/command-log.js` appends every `run_command` to `<ws>/.agent/logs/commands/<date>.jsonl`,
whether it ran, was blocked by the risk classifier, or was rejected at the approval prompt.
`/commands` reads it back; the Status tab shows today's count.

Nothing reads it into a prompt and nothing acts on it. It answers "what has this thing actually
been doing on my computer?" for the person whose computer it is, and it is not covered by
anything else here:

- `errors.jsonl` records **failures**, by flow. `git push --force` does not fail, so the one
  command you would most want to find is the one that log never sees.
- `sessions/history.jsonl` has tool calls mixed into the conversation, and `/compact` replaces
  older turns with a summary — the record you would want six weeks from now is the first thing
  compaction throws away.

One file per day, because that is how people look for this ("what did it do on Tuesday"), with
a per-process session id inside so a day can be read back session by session. Append-only, and
`logCommand` never throws: a failure to write the audit log must not fail the command.

**Blocked commands are the most worth keeping, not the least.** What the agent *tried* to do is
the interesting half — a `critical` verdict from the classifier is exactly the line someone
would want to see later.

## Branching and PRs

**Never commit or push to `main` directly. Work lands on a branch and merges through a PR.**

The branches in this repo are deliberate: they are the history. `beta-v1` … `beta-v10`,
`fix/bridge-lock-and-cli`, `v1-stable` are kept on purpose, not left behind. Do not delete
them, and do not squash their history away.

- Branch from `main`, named `vN.M/short-description`. The series reached **v3.27**;
  **v4 opened with `v4.0/honest-log`** — v3 was 34 PRs in six days that did not feel like
  progress, and the reason only became legible once the failure log stopped counting expected
  states as failures. v4 was the production-readiness plan in
  `.agent/artifacts/plans/2026-09-27-production-readiness.md` and closed with #62
  (`v4.2/fixes-from-use`). **v5 opens with `v5.0/clean-slate`**: cleanup, one recovery policy
  for the reply path, then an editor chat panel in the VS Code companion. **v6 opens with
  `v6.0/settings-and-update-fixes`** (owner, 2026-10-30): the open GitHub issues and the
  small UI asks first, then `.agent/artifacts/plans/2026-10-28-plan-by-effort.md` in order.
  `/update` runs git in `server/`, and status names paths from the repo root — any path
  handed back to git there needs `:(top)` (#102).
- Open a PR into `main`. That is the only way work reaches `main`.
- A force-push to `main` is not a merge and is not covered by this: it is a repair, it needs
  the owner to ask for it explicitly, and it breaks every open PR targeting `main` plus every
  existing clone.

A conflict on a PR that *should* be a clean descendant almost always means the two sides no
longer share history — check `git rev-list --left-right --count main...<branch>` locally
before believing GitHub. If local says `0 <n>` and GitHub says conflicts, the remote branches
have diverged (a rewrite that was pushed to one side and not the other), and the fix is to
make both sides share the same base, not to resolve 120 files by hand.

## Product decisions

Standing constraints on this project. These are choices, not limitations to route around:

- **Gemini Web only.** Not "primary target" any more — the only one. ChatGPT was removed on
  2026-09-19 (see `docs/history.md`); a second provider is a decision to re-open, not a
  file to un-delete.
- **Purely local** — no hosted backend, no telemetry, no API keys. Inference happens in the
  user's own browser session, which is the whole point of the extension bridge.
- **Two front-ends** — the terminal CLI and the Chrome side panel are both supported surfaces.
- **One answer per turn** — never emit drafts or A/B alternatives for the user to pick between.
- **One bridge.** This used to read "the two bridges stay separate" — ~600 duplicated lines
  across `gemini-bridge.js` and `chatgpt-bridge.js`, kept apart because collapsing them risked
  breaking both at once, and defended by jsdom tests that ran against *both* files so a
  divergence failed the build. Deleting one settled that argument by removing its subject. The
  jsdom tests still run, against the one bridge, and say in a comment **not** to restore a
  second target to make the comparison mean something again: the comparison was a side-effect
  of having two, never a reason to have two.
- **An API backend is a fork, not a plan.** It would remove the ceiling — structured tool
  calls, real parallelism, caching, and `looksLikeCapabilityDenial` plus half of
  `PromptBuilder`'s economics become dead code — and it contradicts "no API keys" above,
  which is the identity of the project. The framing that preserves the thesis: the browser
  bridge stays the default, an API backend is opt-in for people who already have a key.

### Standing decisions rescued from `HANDOFF.md`, 2026-09-20

That file was a baton — "delete this once the work below is done" — and its work
is done or obsolete: three of its eight open items were GitHub-agent work deleted
in `e375aed`, `/update` has now run against a real merge, `ask_subagent` is
verified (`4b520b9`), and `/logs rates` has its data. What it also held, and
nothing else did, is these. They are decisions, so they belong here.

- **No reply envelope** — asking the model to wrap replies in JSON. Argued from
  measurement, and the price is the case against it: the browser tab stops being
  readable to the person watching it, which is a *supported surface*;
  `gemini_response_stream` can no longer render live, because JSON cannot be
  drawn until it closes and parses; every reply becomes as fragile as
  `_cleanJsonString` already is, since prose is exactly what escaping gets
  wrong; and it is more text typed into a browser every turn, against a prompt
  strategy that exists to avoid exactly that. The three drift detectors look
  like candidates and are not — a provider error is Gemini's own error page
  rather than model output, and a model confused enough to deny its own tools
  will not emit a correct marker saying so. **If it comes back**, the thing
  worth doing instead is a short output-contract line asking for the constructs
  the renderer handles best.
- **The jitter's second half is not happening** — ~20% of the live frame spent
  on the seam that brought the scroll glitches back twice.
- **Terminal failures are opt-in per terminal**, chosen over an age filter.
- **The emoji sweep is not happening.** ~100 glyphs across 16 files were changed
  and then reverted; the only real complaint was the tick on a dark background,
  which is now `✔`. Change a glyph when someone names *that glyph* — `✅` → `✓`
  on the compaction row was right, and re-running the sweep is not.

And two traps that were only written down there:

- **A test can pin the bug.** A list-indent fix failed two tests that asserted
  the broken two-space indent. A test written from observed output describes
  what the code *does*, which is not what it *should* do — and it will defend
  the bug.
- **Do not write a derived number into a document here.** Commit counts and test
  counts both drifted within a day. Print the command instead.

### Measured and discarded

Kept so they are not re-tried.

- **The extension's "address theory" was wrong.** The reconnect, not the address, was the
  whole connectivity problem. With the shipped bundle refusing every handshake: attempts at
  4.7s, 20.7s, 50.7s, 80.7s — steady state **exactly 30.0s**, the `chrome.alarms` clamp
  floor. Headless Chrome reclaims service workers harder than a real browser, so that is a
  lower bound rather than a verdict.
- **The anti-throttling audio hack never worked, and not for the reason three documents
  recorded.** They said the `<audio>` element was created and never appended — true, and not
  the bug, because a detached `<audio>` plays fine in Chrome. The real reason is in its own
  catch block: autoplay policy blocks playback without a user gesture, and the fallback bound
  `click`/`keydown` with `{ once: true }`, which a **backgrounded** tab never receives. So it
  played in tabs that did not need it and stayed silent in the ones it existed for. Deleted;
  the Tab Wakeup Protocol is the mechanism that works.
- **The batch loop's flat re-serialisation was diagnosed as an oversight and was not.** Every
  batch turn opened a fresh tab closed when the turn ended, so turn 2 had never seen turn 1 —
  there was no thread to opt into. Measured at **81% resent** over ten turns (156,140
  characters where 28,943 were new) before the tab was held for the life of the task.

## History

Long-form records of what was removed, measured and decided — the GitHub agent and ChatGPT
removals, the dead-code audits, the Direction phases, P0–P3 and "The fork" — live in
[`docs/history.md`](docs/history.md). They moved out on 2026-10-25 because this file had reached
167.9k characters, past the 150k Claude Code loads. Read that file before re-opening any of those
decisions; this one keeps what governs the code as it is today.

### Search, and why there is still no index

Decided 2026-09-11, revisited deliberately because the next codebase is a large one.

**No embedding index.** Phase 1 deleted `semantic_search` for being broken; this is the
separate question of whether a *working* one should replace it. It should not, and Claude Code —
the benchmark this project is measured against — does not have one either. Four reasons, the
last of which is specific to this architecture:

- Code search is mostly **exact-symbol** search (`getUserById`, `EADDRINUSE`), where lexical
  matching wins outright.
- An index goes **stale on every edit**. Cursor pays for a persistent background service to
  re-index continuously; the alternative is serving the model a confident map of code that no
  longer exists — the same failure phase 1 removed.
- **Chunking destroys structure.** This repo already learned that: the deleted `ast-chunker`
  resolved 24% of its own top-level symbols.
- **Retrieval is single-shot; an agent iterates.** grep → read → grep again with a better term
  beats one shot at the twenty nearest chunks, because the second query knows what the first
  found.

The constraint that settles it: **the context window is a browser chat tab.** Every retrieved
chunk is typed into Gemini by a content script. Twenty 500-token chunks is 10,000 tokens typed
into a browser per query, most of it unread — in a project whose whole prompt strategy exists to
avoid large repeated payloads. Agentic grep→read sends only what the model decided it needed.

**What a large codebase actually needs**, none of which is RAG:

| gap | answer | where |
| --- | --- | --- |
| you don't know the codebase's word for it ("rate limit" vs `throttle`) | multi-pattern `grep_search`, and prompt guidance to try synonyms — the model already knows them, it just burns a browser round-trip per guess | P2 |
| "who calls this?", "what extends this?" | a symbol index (tree-sitter or ctags): exact, invalidates on mtime, needs no model | P3 |
| orientation in an unfamiliar repo | `AGENT.md` — a human-written map beats a generated one because someone vouched for it | done, phase 2 |
| a 50-line unranked hit list is hard to reason from | context lines, grouping by file, ranking | P2 |

This is a decision made from the architecture, not from measurement. If grep genuinely fails on
real questions in the large codebase, that evidence outranks the argument above — and the shape
of the failures says which of the four rows is the one that bites.

### Queued prompts

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

## Gotchas

- **`server/src/index.js` is the bin and does nothing but re-spawn `main.js` under `tsx`** —
  the sources contain JSX, so plain `node src/main.js` fails.
- `App.jsx` is performance-sensitive: it avoids re-rendering during streaming to prevent
  terminal tearing, and uses raw ANSI (`\x1b[1m`) in places because `marked-terminal` mangles
  inline markdown inside list items. It was split into `ui/` modules by moving blocks verbatim
  behind explicit dependency lists; the `<Static>` element, `staticEpoch` and the streaming
  path stayed in `App.jsx` deliberately, and adding memoization to the transcript rows is how
  the scroll glitches came back the last two times.
- **Every slash command is driven once by a test, bare and with arguments.**
  `use-slash-commands.js` was 967 lines at **8.69% line coverage** — the lowest
  in the repo, and the surface almost every bug reported from use has come from.
  `test/ui/slash-command-smoke.test.js` is shallow and total, the same shape as
  the tool smoke sweep and for the same reason: the failure worth guarding is
  "this entry point throws", and a command that crashes takes the turn with it.
  It also asserts no listed command answers *"No such command"* about itself —
  the `/name` bug, which shipped fully implemented and unreachable because the
  dispatcher kept its own copy of the list. **55.5% now, and 92.5% overall.**

  **Use the real collaborators, not stubs.** A first pass with hand-written
  stubs produced three confident false positives, including `getAllMemories is
  not a function` against a method that exists and has three callers. Real
  `MemoryManager`, `ContextManager`, `DiffEngine` and `TaskManager` cost nothing
  in a temp workspace and cannot lie that way.

  Two real faults fell out of the sweep, both the same shape — the interface not
  saying what happened. **A wrong effort word was ignored rather than
  rejected**: `/effort deeep` fell through to the status display, which prints
  the current rung and the ladder and reads exactly like a confirmation, so you
  believe it changed and every later turn goes out on the old rung. And **a bare
  `/` answered "No such command: `/`" followed by "Type `/` on its own to see
  what there is"** — advice to do the thing that had just been done. It lists
  the commands now, and an unknown command says so *and then* lists them.

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
  (`core/slash-commands.js`) is the gate. A set beside the commands rather than
  a literal at the call site, because the literal is what drifts.

  **But a set can only answer for a whole command, and `/update` is two
  commands wearing one name.** Bare `/update` runs `checkForUpdate`, which is
  `git fetch origin` — **1,086ms measured warm, bounded by `FETCH_TIMEOUT_MS`
  at 10s cold** — while `/update done` reads a file. It was in neither the set
  nor anything else, so the input box cleared and nothing happened for up to
  ten seconds: reported as *"/update seems glitched out, its loading is a bit
  late and no loading animation"*. The comment in `use-slash-commands.js` had
  asserted a spinner was "not available, because `SLOW_COMMANDS` is keyed on
  the first word and `/update` on its own answers instantly" — the keying was
  the real obstacle, and the second clause was never measured and is false.
  `isSlowCommand(command, args)` takes the args, so `/update` and
  `/update pull` wait and `/update done` stays instant, which is what keeps the
  stranded row from returning through the new door.

  **Prompt length is not what a turn costs.** Measured over 265 real turns:
  `type` — the synthetic paste, where length is paid — is **23ms median, 410ms
  p90, 2,450ms max**, against a **4,673ms median round trip** (14,913ms p90).
  Even the worst paste of a full 26,268-character turn-0 prompt is half of one
  median round trip, so **splitting a prompt across messages costs 3× the wait
  and saves nothing**: the context is identical when the task arrives, plus the
  model's acknowledgements. Make turn 0 smaller; do not spread it out.

- **A dropped file is a tag too (v5.33, `ui/file-drop.js`).** A terminal has no drop event: a drop
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
- **A file dropped on a side panel is a tag too (v6.17, `onDropFiles` in `side-panel/panel.js`).**
  Chrome gives a page the dropped file but never its path: an image goes in as a pasted one, a
  text file up to 8 KB is sent whole as a `<file name=…>` block after its header, and anything
  larger is refused with "drop it in the terminal, which can send the path". VS Code's webview gets
  `text/uri-list` for a file dragged from the explorer (with shift), so the path is sent with
  `— read it with read_file`, as the terminal does. Order on send is the terminal's: image blocks,
  file headers, message; `foldFiles` also folds the inline blocks so the text is not drawn twice.
  Not driven in a live browser: a real drag cannot be scripted here; jsdom covers the handler.
- **An image is a tag in the prompt, Claude Code's way (v5.24, `ui/image-attach.js`).**
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

- **A setting reply is one line (v5.25, `changed()` in `core/slash-commands.js`).** `⚙ <setting>
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
  `ui/`. When Ink's dynamic output is taller than the terminal, `shouldClearTerminalForFrame`
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

  **The agent's reply was the unbudgeted row, and it was the biggest one.**
  `TranscriptTurn` capped the *action* rows at `liveBudget` and then rendered
  the reply underneath in full, live or not. Reported as "it gave me much more
  output but I received only a portion of it", with a screenshot of an answer
  cut mid-sentence and blank space below. **Nothing was lost** —
  `history.jsonl` held all 5,090 characters and `renderMarkdown` returns all of
  them, both checked before touching anything — but at ~85 rendered rows in a
  ~30-row terminal the frame blew past the viewport, and what survived the
  repaint was its top. `liveMessageText` clamps it while live and says
  `… +N more lines`; the committed copy in `<Static>` is untouched, so the rest
  appears a moment later. It lives in `format.js` rather than beside its only
  caller because a test importing a `.jsx` file cannot run under the repo's
  plain `node --test`.

  **Its first version counted `\n`, which was the same bug again, and it
  shipped looking fixed.** It was reported a second time — extension updated,
  agent restarted, still truncated, still no marker. A 1,450-character reply
  is **18 source lines and 26 rendered rows at 100 columns**, so an 18-line
  clamp against a 14-row budget let the text straight through while the frame
  still overflowed by twelve rows. The rule immediately below had already
  said it. The budget is spent in *wrapped* rows now, at the width the
  terminal actually is. **A clamp measured in the wrong unit reads as a fix
  and behaves as nothing.**

  **A row you draw is a row you budget, and a row that wraps is two.** `/update`'s reload
  notice was ~105 characters, which wraps at 80 columns: charged as one row, drawn as two,
  and 1 `ESC[2J` at 13x80 and 10x80 where there had been none. `wrap="truncate"` on anything
  in the live frame is load-bearing, not tidiness. The arithmetic test caught the first of
  these; only the pty run caught the second.
- **Nothing the user waits for goes in front of the first frame.** Startup was
  2.46s to the prompt box with GitHub enabled, and almost none of it was work:
  `main.js` awaited the 1.5s extension-greeting timeout and then
  `githubHandler.start()` — which authenticates against api.github.com and runs
  a full initial poll, fanning out per PR — before it created the Ink UI.
  Neither answer is something the first frame draws. Moving both behind
  `cli.start()` took the same measurement to **0.53s**, with no behaviour change:
  the start tab still opens, the poller still polls. For scale, every module
  import in the process is 517ms together, 426ms of it ink+react, and `tsx`
  itself is 120ms — so the two waits were larger than the entire program.
  `test/core/startup-order.test.js` pins the ordering, because the regression is
  invisible in review: one more `await` before `cli.start()` reads as ordinary
  sequencing and costs a second every launch, with no failure to notice.

  **Starting GitHub after the WebSocket server also fixed a silence.**
  `poller.start()` emits `auth_rejected`, and its only listener is wired in the
  `WebSocketServer` constructor — which used to run *after* that call. So the
  401 message ("GitHub rejected the stored token… clear it with
  `/github remove-token`") was emitted into an EventEmitter with nobody
  attached, and an expired token produced no GitHub activity and no reason why.
  The later `pollNow()` 401 at `github-poller.js:147` always worked; only the
  startup one was unreachable.

- **The startup look is Look A (v5.22, chosen 2026-10-25 from
  `.agent/artifacts/plans/2026-10-25-startup-look.md`).** A four-row `❯` mark in block characters
  with name, byline, workspace and `/help` beside it (`Banner.jsx` `Header`), replacing six rows of
  figlet — `figfont.js`, `banner-text.js` and `Standard.flf` are deleted. The input is ruled above
  and below with no sides (`borderLeft/Right={false}`), so a drag-select no longer copies `│`; same
  three rows. The mode line carries Claude Code's glyphs (`MODE_GLYPHS`: `⏸` `⏵⏵` `⏹`), which v5.20
  had removed as rendering badly — chosen back knowingly; the plan's M3 set is the fallback. The
  header's text column needs an **explicit width**: inside `<Static>` Yoga sizes it to content and
  `wrap="truncate"` then wraps instead. `/copy` (same release) copies the last reply's markdown.

- **The header draws in on every start, and exit says goodbye (v5.23, `ui/intro.js`,
  `components/Intro.jsx`).** `Root` shows `Intro` — the banner with a `frame`: the mark sweeps in,
  the name types out, the dim lines arrive, ~440 ms — then mounts App, whose `<Static>` writes the
  same header at the same position. On exit `farewell.js` awaits the registered outro (capped at
  `OUTRO_CAP_MS`): App swaps its live frame for `❯ Goodbye.`, then the clear and the footer.
  **App must draw the goodbye itself** — swapping App out for it left Ink laying out the Static App
  had owned, ~90 blank rows a frame, the transcript pushed off screen. TTY only, ≥16 rows for the
  intro, off under `AGENT_CLI_NO_ANIMATION` or `CI`. Pty: 1 `ESC[2J` (the exit's own) at 13, 16, 24.

- **First-start setup runs instead of App, then App mounts (v5.22, `components/Onboarding.jsx`,
  `ui/welcome.js`).** Splash (the mark draws in, the greeting types out), theme (live preview), name (banner preview), Chrome
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
  also wrapped by `fitLines` (`format.js`) now, to the width beside the dot, with bullets hanging
  at their text column — Ink kept the space it broke at and knew nothing of lists. The harness's
  `snap` is the raw stream with escapes stripped and invents blank rows; use `{"screen": file}`,
  pyte's rendered viewport, for anything about layout.

- **`?` as the whole input shows the keys (v6.18, `ui/keys-view.js`).** A grid of `KEY_HINTS`
  (two or three words each; every key must be one `/help`'s `KEY_ROWS` lists) in the `/` palette's
  place, 1–3 columns by width, filled down then across, charged `paletteRoom` rows like the palette;
  short of rows, the last cell is `/help`. Making it found the palette's own overflow: below 13 rows
  `paletteRoom` added 2 for the spinner and its margin, but the margin is shed there, so `/` drew
  one row too many and cleared the screen once at 10 rows (on `main` too). Pty: 0 clears for `/`
  and `?` at 10–13 rows, and at 24 rows × 60 and 120 columns.
- **The status bar is laid out in `ui/status-bar.js` (v6.13, Option A of
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

- **Colour is a role, never a name (v5.15, `ui/theme.js`).** Components write `T.accent`,
  `T.attention`, `T.success`… and the palette picks the colour; `test/ui/theme-tokens.test.js`
  fails on any `color="cyan"` or `'cyan'` in a `ui/` component. About 86 call sites had named
  ANSI colours, and cyan alone meant six things. The only palette so far is `terminal`, which
  maps every role back to its old colour — verified under the pty as the same 19 on-screen
  styles and a byte-identical run. `T` is mutated in place, so a module-level table of colours
  (`DiffRows`' old `COLOUR`) must be read at render, not at import. Still literal, deliberately:
  the markdown renderer's colours (`marked-terminal`, configured once at load) and the banner
  gradient. The plan for the rest is `.agent/artifacts/plans/2026-10-24-ui-redesign.md`.
  **Palettes since v5.16:** `dark`, `light`, `dark-colorblind`, `light-colorblind` (Okabe–Ito
  blue/orange), `mono` (every role `null` — plain text) and `terminal`, still the default. Each
  palette but `terminal`/`mono` names the background it was designed for in `PALETTE_INFO`, and
  a test holds every role to WCAG 4.5:1 against it (3:1 for `muted`). `/theme` previews by
  calling `setTheme` on highlight; esc restores `original`; enter saves to
  `~/.agent/settings.json` (`core/user-settings.js` — per person, not per repo) and reprints the
  transcript, because committed rows cannot be recoloured. `NO_COLOR` beats the saved choice.
- **Every menu is a `Panel` (v5.24, `ui/panel.js`, `components/Panel.jsx`).** Asked for 2026-10-26:
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
- **`/settings` is a list of switches (v5.27, Option C′, `ui/settings-view.js`,
  `components/SettingsList.jsx`).** The owner's pick from `.agent/artifacts/plans/2026-10-27-settings-redesign.md`.
  A row with `control` is a switch (`● on  ○ off`) or a ladder (`◂ high ▸`), and ←/→ set it in place
  through its own `restore` command, run in order (`settingsChain`), so the leaving summary still
  sees every change. ←/→ are spatial and never wrap. The hint is on the selected row and drops below
  70 columns. The filter stays on top, underlined; printable keys go to it, and **tabs are on tab
  only** now. Enter steps a switch or mode in place and opens a chooser only for Effort, Startup and
  Command rules (`OPENS_CHOOSER`). Values are plain except a switch's active state and a read-only
  `attention`; `Choices` no longer recolours the selected row's detail in any menu. Pty: 0 clears at
  13×90, 24×100 and 24×60.
- **A child spawned while Ink is up must not inherit stderr (v5.24).** `execFileSync` passes a
  child's stderr to ours by default, and ours is Ink's terminal. osascript prints `*** Error
  creating a JP2 color space` twice when it reads a screenshot, so ctrl+v stranded the input
  box's top rule in scrollback. `OSASCRIPT_STDIO` in `ui/clipboard-image.js`. The same release
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
- Running the CLI without a TTY fails with Ink's "Raw mode is not supported". That is the
  harness, not a bug — use `script -q /dev/null <cmd>` to test under a pty.
- Content-script DOM selectors break when the chat sites change; `extractLatestResponse` must
  wait for a *new* block before scraping. Gemini's editor only ingests text via a synthetic
  `ClipboardEvent('paste')` — setting `innerHTML` breaks it.
- `AGENT.md` at the repo root is *workspace* context read by `prompt-builder.js`, not
  instructions for you. It belongs to whatever project the agent is pointed at. It was the
  unedited stock template until 2026-09-16 — 740 bytes of `<!-- Describe your project here -->`
  going into every turn-0 prompt as this project's context, because `_loadAgentMd` skips a file
  only when its trimmed body is *empty* and a template full of headings is not. It now says what
  this project is; `instruction-sources.js` flags the template state so the next one cannot sit
  there unnoticed.
- The agent defaults to `--workspace ../`, so running it here makes it operate on its own repo.
  That is why this repo kept accumulating agent state.
