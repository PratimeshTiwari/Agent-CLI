# The prompt, effort and models

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Prompt economics

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

**The prompt is versioned (v5.32, `core/prompt/prompt-versions.js`, `/prompt`).** Asked 2026-10-28: "we
don't know exactly if newer will be better or not". Every prompt change had replaced the one
before, so "better" was argued from prompt sizes. Now **v1 is frozen**: `prompt-v1-golden.test.js`
hashes 98 shapes (turn 0, short, refresh, redeclare and warm-up for every effort × mode ×
subagents; handovers; a tool batch; subagent wrappers; compaction) against
`test/backend/core/fixtures/prompt-v1-golden.json`, so a change that reaches v1 fails the build — put it
in a newer version. A version is its differences: `dir` overrides prompt files
(`prompts/<dir>/<name>.md`, else the base file — `prompt(name, dir)`), `flags` for builder switches,
`refreshEvery` for the reminder cadence. Per person in `~/.agent/settings.json`, default v1; a
switch re-teaches the chat only when the version changes. Every reply and every
`tool-usage.jsonl` row records `promptVersion` (older rows count as v1, since v1 *is* v5.31's
prompt), and bare `/prompt` and `/logs tools` show turns and rounds per version. The status bar
says the version only off the current one.

**Two versions since v9.9.5: v1 (original) and v7 (current).** Owner: v3 to v6 "are all feature
upgrades that could be written to the initial v1 and v2". A version is now wording only; Jira, MCP
and memory are `FEATURES`, on both, each silent until set up (a site, a usable server, a fact).
v7 is v2's wording plus `lookFirst`; v2 to v6 read as v7 (`LEGACY_VERSIONS`), logged rows keep their
labels. A missing setting is still v1, so nobody is moved; first start writes v7
(`firstRunSettings`). The golden was re-pinned once, for `manage_memory`'s wording alone (54 shapes,
each proved by swapping that line back). Read "v2"…"v6" below as history: a new switch is a v7 flag
or a feature, never a version. `/prompt` is two rows, `current` and `original`.

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

**v3 is v2 plus "look before answering" (v7.9, `lookFirst`).** Reported: asked "how is the
symbol matching done in this node server" on Flash-Lite, the agent answered from `AGENT.md`'s map
with nothing opened. Two halves. The prompt: rule 9 of the terse list on low, a bullet under
Source Code on medium (`LOOK_FIRST_RULE` in `prompt-builder.js`; +240 / +273 characters on turn 0);
high is v2 byte for byte, since Pro plans first. The loop: a reply with no tool call whose last two
sentences promise to look (`looksLikeEmptyPromise`, offers and questions excluded) is asked once
per turn to make the call (`_askToKeepPromise`: 3 lines and the tool names; an `empty_promise`
notice and a `↻` row). The loop half is gated on the version too, so `/prompt` compares what v2
and v3 do. Replayed over the 99 stored replies that ended a turn: 0 hits, against 11 among
replies a tool call followed. `looksLikeCodeQuestion` also learnt "this server" and
`snake_case`/`camelCase` names, so `turn0_no_tools` counts the reported case. Pty: the promise,
the ask, the call, the answer, 0 clears at 13 and 24 rows.

**Max is a fourth rung: High's prompt on Argon (v5.26).** Argon is a *model* on a few accounts,
labelled `4 Argon` and listed after Pro (seen on the owner's account, 2026-10-26). Under the old
"High = the last model" rule it took High, Medium landed on Pro, and Flash became unreachable.
`byProAnchor` finds Pro by name again; Max is the model named Argon, else the first model after
Pro. With no Pro in the list the positional rule runs unchanged and Max is unavailable, so every
three-model account maps exactly as before (pinned in `model-match.test.js`). `/effort max`
without Argon answers `stays <rung> · Argon is not available on this account` and changes
nothing. `promptRung` folds Max to High at build time, because the system prompt names its rung. The
slider's model line names what the marked stop maps to on this account (`stopModel` in
`frontend/menus/effort-slider.js`), dimmed as `not available on this account` for Max without Argon.

**The browser differing from the effort is asked about, and a failed switch steps down (v5.28,
`core/models/model-fallback.js`).** Under the default policy, `ask`, `handleSubmit` stops before the message
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
detectors in `core/turn/drift-detector.js` back that up, each with a different response:
`looksLikeMultipleDrafts` → bring the refresh forward; `looksLikeCapabilityDenial` → resend the
full definitions and retry the turn once (`requestToolRedeclaration`, **not**
`resetPromptState` — see below); `looksLikeProviderError` → Gemini's own error rather
than an answer, so re-ask (this one used to be written to disk as a PR plan). All three match
prose and will always trail the model's phrasing, which is why the anchor exists: prevention
first, detection as the backstop.

**Tool amnesia is repaired with `requestToolRedeclaration()`, never `resetPromptState()`:** the condensed
reminder plus the full definitions (9,991 characters, where a turn-0 reset was 25,445, the payload most
likely to trip Gemini's filters on a session already failing). It outranks the periodic refresh, which
sends only names. Why: [`docs/history.md`](../history.md#moved-from-claudemd-in-v87).

**`pro-hypothesis.md`** asks `pro` what would disprove the expectation (+714
characters; a numeric confidence score was declined): [`docs/history.md`](../history.md#saying-what-would-prove-you-wrong-pro-hypothesismd).

**There is one pro rung (since 2026-09-20):** the old `standard` plus `deep`'s review step. The
critical-analysis phase and the assumption ledger are declined: they are paid in output tokens on
every pro turn, which a prompt character count does not show.

## One Chrome profile

**A locked model does not exist (v9.7, extension 1.63.0).** Read live with Claude in Chrome: an account on
`Gemini Auto` lists 3.1 Pro and 4 Argon with a lock icon and `aria-disabled="false"`, so the icon is the test
(`locked` from `describeModelOption`). `pickModelFor` drops locked entries first, pin included; the switch
refuses one. On that account every rung lands on Auto and the prompt follows the setting, Max reading
High; `/effort max` says `4 Argon is locked on this account` (`lockedReason`). Both accounts tick a thinking
level too, reported as a mode: `selectedModel` is the only reader of the tab's model, because a ticked `Low`
answered for it. Pty (`FAKE_LOCKED`, `FAKE_LEVELS`): no switch sent, 0 clears at 13 and 24 rows.

**Thinking level follows effort (v9.9.3, `core/models/thinking.js`, extension 1.65.0).** Read live (Step 0 of
`2026-11-06-auto-thinking-visuals.md`): Low/Medium/High on every model, kept across a switch, back to Low on a page
load. It is sent when chosen (`set_thinking`) and on every main-lane prompt. The trigger names a level on some accounts
("Pro Medium"), never on Gemini Auto, so the menu's tick is the read-back; a trigger read as Low made every set "fail". `same`, the default, is lightest/middle/heaviest for low/medium/high
and max, stepping down past a lock; `/effort thinking <level>` pins one. A failed set is one `✗` row, not retried until
the setting changes, and the prompt goes anyway. Owner: an account with no levels shows no Thinking anywhere (slider,
`/settings`, panels, status bar). A hand-picked Medium once read as the model "Flash-Lite Medium".
Pty (`FAKE_LEVELS`): 0 clears at 13 and 24 rows, with levels and without.
