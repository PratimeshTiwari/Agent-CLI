# Failure log and command log

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Failure logging

**Bare `/logs` is a picker (v5.35, `frontend/menus/logs-view.js`)**: Failures · Speed · Tools · Text channel ·
Notices · Clear, each row carrying its one-line answer, enter opening the typed form's full text.
It used to open only once something had failed, so "is it slower?" needed the word `extension`.
Failures is a second view of flows (esc steps back). The old summary is `/logs failures`; `/logs
speed` is new. Traces now record `promptVersion`, so Speed splits reply time by version as Tools
splits rounds. Pty: 0 clears at 13 and 24 rows.

`core/logs/error-log.js` writes every failure to `<ws>/.agent/logs/errors.jsonl`, tagged with the
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

**Failures and notices are counted apart.** `logNotice` writes `level: 'notice'`; `summarizeErrors`
counts failures and reports notices beside them; `/logs notices` lists them. The field is present
only on notices, so a row written before it existed reads as a failure. (Over three days the log
once held 274 rows and about ten real failures.)

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

## The command log

`core/logs/command-log.js` appends every `run_command` to `<ws>/.agent/logs/commands/<date>.jsonl`,
whether it ran, was blocked by the risk classifier, or was rejected at the approval prompt.
`/commands` reads it back; the Status tab shows today's count.

Nothing reads it into a prompt and nothing acts on it. It answers "what has this thing actually
been doing on my computer?" for the person whose computer it is, and it is not covered by
anything else here:

- `errors.jsonl` records **failures**, by flow. `git push --force` does not fail, so the one
  command you would most want to find is the one that log never sees.
- the conversation file has tool calls mixed into the conversation, and `/compact` replaces
  older turns with a summary — the record you would want six weeks from now is the first thing
  compaction throws away.

One file per day, because that is how people look for this ("what did it do on Tuesday"), with
a per-process session id inside so a day can be read back session by session. Append-only, and
`logCommand` never throws: a failure to write the audit log must not fail the command.

**Blocked commands are the most worth keeping, not the least.** What the agent *tried* to do is
the interesting half — a `critical` verdict from the classifier is exactly the line someone
would want to see later.
