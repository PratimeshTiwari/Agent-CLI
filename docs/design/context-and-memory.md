# Context engine, memory and search

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Context engine

`context/` — `code-minifier`, `context-manager`, `memory-manager`, `memory-store`, `symbol-index`. `CodeMinifier.minifyJson` is on the hot
path: `PromptBuilder.buildToolResultBatch` embeds every tool result in the next prompt, and
serialising them compact rather than pretty-printed is ~40% fewer characters there — measured
on a 30-entry `list_directory` shape: 2,456 pretty against 1,424 compact, **42%**.

**`minifyJson` always returns a string.** A replacer keeps what can be serialised and marks what
cannot (a cycle, a BigInt). It used to return `undefined`, which threw inside the prompt build, or
`''`, a tool that ran and seemed to produce nothing.

There is no `ast-chunker` and no `skills/` registry any more. Both were written, never wired to
anything, and removed on 2026-09-10: the chunker resolved 24% of this repo's top-level symbols
(it walked only `ast.body`, so every class method and every `export const foo = () => {}` missed,
and plain acorn cannot parse the `.jsx` files at all), and `SkillRegistry` was a second, parallel
way to declare a tool that competed with `mcp/mcp-server.js`'s `TOOL_DEFINITIONS` — which is the
one described above and the one that actually runs. A per-symbol read tool is still a real gap;
it wants `acorn-walk` plus `acorn-jsx`, not that file.
`watcher/file-watcher.js` reports external edits into the history.

**Memory is a folder (v9.4, `context/memory-store.js`, prompt v6).** Before it: one `memory.md`, no facts
saved here, 0 `manage_memory` calls logged, and each call on v1–v5 re-sends turn 0 (`resetPromptState`). One
file per fact, with author, session, time and why stamped by the harness. **One store for every version:** v1's
words are frozen, its storage is not, so `memory.md` is imported (`importLegacy`, moved aside, a later note is
still picked up) and only v1's past-the-cap line changed. v6 lists an index and reads a fact when needed, and
leaves the prompt state alone. A write is checked against the hash this process last showed the model (`seen`,
inside a per-fact lock), so eight racing processes get one winner; a person's `/memory forget` is forced. The
nudge (`core/prompt/standing-rule.js`) adds one line to a turn that sets a rule. **Narrow on purpose:** most of
the owner's messages are one-off requests shaped like rules; over 195 real ones it fires on 2. Judge it by
`/logs tools`, "Asked to save a fact", not by this paragraph. Pty: `run-memory.sh`, two launches, 0 added clears.

**The file watcher holds no descriptor per file (v5.6).** chokidar held one per watched file, and
past macOS's `OPEN_MAX` (10,240) every `posix_spawn` failed with `EBADF`: no command, no `/update`,
no browser. It is Node's recursive `fs.watch` everywhere (FSEvents on macOS); a Linux tree past
`max_user_watches` only turns announcements off. Ignores are by path segment and add `vendor`,
`tmp`, `log`, `coverage`. A spawn `EBADF` reaches the model as "the command never started, do not
retry". **Any new long-lived resource per file is the same bug.**

## Search, and why there is still no index

**No embedding index** (decided 2026-09-11): code search is mostly exact symbols, an index goes
stale on every edit, chunking destroys structure, and every retrieved chunk would be typed into a
browser tab. grep → read → grep, plus `find_symbol`, is the answer; evidence that grep fails on real
questions outranks the argument. The full reasoning and the gap table:
[`docs/history.md`](../history.md#moved-from-claudemd-in-v994).
