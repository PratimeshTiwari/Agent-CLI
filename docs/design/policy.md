# Approvals, modes and who may run what

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Approval path

Writes never go straight to disk. `edit_file` / `create_file` produce a `DiffEngine`
(`core/edits/diff-engine.js`) diff with per-hunk accept/reject, backups, atomic writes, and `undo()`.
Commands pass through `core/commands/risk-classifier.js`, which decides whether `App.jsx` must prompt;
persistent allow/block rules live in `commandRules`  (`/allowlist`).

**Rails (v6.19).** Anything aimed at production (`RAILS_ENV=` / `RACK_ENV=production`,
`-e production`, `--environment=production`, `DISABLE_DATABASE_ENVIRONMENT_CHECK=1`) is
`critical`, which is blocked outright in every mode, and says to run it yourself. A task that
drops or rewrites the database (`db:drop`, `db:reset`, `db:purge`, `db:schema:load`, …, through
`rails` or `rake`) stays `risky` — asked about in every mode, auto included — but under its own
reason, where it used to read "Mutating shell command" like `rspec`. Both only for a command that
runs something: `grep RAILS_ENV=production config` is a search.

**Who may run what is `core/policy/tool-policy.js`, not `_executeToolCalls`.** Two pure functions —
`isBlockedOutright` and `requiresApproval` — over the catalog's own `mutates`, `shell` and
`detached` flags. It was decided inline, 487 lines deep in dispatch, and that is precisely how
`run_background` came to skip every gate: the plan-mode branch named the mutating tools
literally, a fourth was added later and not added there, so the mode whose status bar reads
"plan — every edit needs approval" spawned a detached shell process without asking, while auto
mode asked about the same call through the classifier's "Unknown tool" default. **The careful
mode was the permissive one.** The fix is not "add it to the list" — there is no list any more,
so the next tool that writes is gated by declaring itself beside its description.

`DETACHED_TOOLS` makes the read-only exemption ask about `run_background`, whose process outlives
the turn: [`docs/history.md`](../history.md#moved-from-claudemd-in-v991).

**The rest of the dispatch loop came apart the same way.** `_executeToolCalls` was 487
lines; it is 240 now, and the two pieces that left are the two that were doing something other
than dispatching.

`core/turn/loop-tools.js` holds the three the loop answers itself — `ask_question`,
`ask_subagent`, `manage_memory`. The catalog has said `dispatch: 'loop'` about them since it
was written, and the chain named them literally with an `else` sending everything else to
`mcpServer.executeTool`: a fourth loop tool would have gone to a server with no handler and
come back to the model as an unknown tool it had just been told it has. `LOOP_TOOLS` is derived
from the catalog now, so the two cannot disagree.

`core/edits/diff-approval.js` holds what happens between building a diff and it being on disk. Three
parties have to be told the same thing about that, and each has been the odd one out: the model
(told `pending_approval` about a file already written), the screen (a rejected edit drawn in
green), and the disk (the only one never wrong). Keeping them in one function is the reason it
is one.

**Three modes since v5.11 (`core/policy/modes.js`): `plan`, `auto`, `strict`.** Asked for on 2026-10-24:
plan mode asked for every section of a document. `strict` is the old plan mode, below. `plan` also
writes Markdown **inside the workspace** without asking (by location, never extension) except the
instruction files (`AGENT.md`, `CLAUDE.md`, `GEMINI.md`), the line the paragraph below holds. The
prompt states the exception in plan and not in strict, as their disagreeing is the failure below.
Shift+tab cycles plan → auto → strict, at an approval box too (v9.9.6, `loop.mode` notifies
`onModeChange` and the panels); mid-turn, the next tool-results prompt says so (v7 `modeNote`).

**A plan review opens only for a plan still waiting (v6.7, `planWorthReviewing` in
`frontend/transcript/plan-box.js`).** "hi" on Flash-Lite in plan mode wrote `task.md`, a one-line plan, ticked it,
said hello, and ended on *Plan ready for review* with the editor opened. The review and editor are
skipped when `task.md` was written after the plan with nothing unticked, or the plan has fewer than
two steps and under 200 characters. v2's cheap rungs also lose "ALWAYS proactively create a task.md"
(`answerDirectly`); v1 still says it.

**`strict` exempts the agent's own artifacts, and nothing else**, decided by location, never by
extension. `isAgentArtifact` resolves the path and prefix-checks it against `paths.artifactsDir`:
`task.md`, `./task.md`, an absolute path and `.agent/artifacts/../../../task.md` are one string test
and four files. It fails closed. It used to be `path.endsWith('.md')`, which let plan mode silently
write `README.md`, `CLAUDE.md` and `AGENT.md` while the prompt and status bar said every edit needed
approval.
