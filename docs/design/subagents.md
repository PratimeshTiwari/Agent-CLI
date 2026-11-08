# Subagents

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Prompt economics

**On `pro`, the review goes to a second tab.** A model reviewing its own diff shares every
assumption that produced it. With subagents on, step 5 sends the diff to `ask_subagent` with
`role: "review"` (v2+: only past one file or ~30 lines). With them off it stays self-review,
because naming a tool the prompt does not define instructs a call to it.

**Why one reviewer and not a pipeline** (extra agents should add intelligence, not writes): see
[`docs/history.md`](../history.md#why-one-reviewer-and-not-a-multi-agent-pipeline).

It is also the only fan-out that is *real* here. `extension-lock` gives each **tab** a lane —
`main:<model>` for the conversation you are looking at, `sub:<requestId>` for a subagent in
a tab of its own, kept for its session — so `ask_subagent` calls genuinely run at once, same model or
not. That was not always true: the extension addressed tabs by URL pattern, so two same-model
requests raced for one tab and could interleave two prompts into one conversation. Tab identity
is what removed that, and it is why a same-model reviewer is now offered at all. Claude Code's
subagents buy *context isolation* rather than speed, and Cursor
3's eight parallel agents are bought with **git worktree isolation** — a separate filesystem per
agent, which this project does not have and would need before parallel *writers* were safe.

**A subagent session holds one tab (`core/subagents/subagent-session.js`).** Each round sends only what
that tab has not seen; a fresh tab per round resent **81% of characters** over ten turns. The
tab closes when the session ends (v8.1 fixed it closing after round 1). A failure of its tab is
named as the subagent's in the log, the side panel and the `ask_subagent` row (v8.4, extension 1.58.1).

## Subagents

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
