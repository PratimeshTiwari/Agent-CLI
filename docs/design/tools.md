# Tools

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Tools

`mcp/mcp-server.js` holds a flat `TOOL_DEFINITIONS` array (name, description, parameters,
handler) with handlers in `mcp/tools/`. To add a tool: write the handler, add one entry to that
array, **and one to `core/prompt/tool-catalog.js`** — that is what the prompt is rendered from, and
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

**A running command shows its last five lines (v5.21), like Claude Code's Bash rows.** `run_command`
was silent until it exited. `exec` keeps collecting exactly as before — the model's result cannot
change because the screen watches — and listeners on the child's streams feed `core/commands/output-tail.js`,
which turns chunks into finished lines (a partial line is shown and replaced; `\r` progress bars
show only what a terminal would; ANSI and control bytes stripped) and throttles to 4/s, leading and
trailing edge. The loop sends `tool_output`; the UI keeps it to itself (a side panel that draws
none of it would otherwise wake the service worker four times a second). The row reads
`◌ run_command <cmd> · 12s · +340 lines`, the clock starting when the command does rather than
at `tool_call`, which precedes the approval prompt. **The lines are charged to the live budget in
`runningLayout`** (`live-layout.js`), after the call rows, so a short terminal drops output before a call
and the turn keeps its two rows. Measured under the pty: 0 clears after approval at 10, 13, 16 and
24 rows. The run also showed the approval *decision* row repeating the whole command — a system
row wraps, so a one-line `for` loop drew four rows charged as one — and that row now names only
the decision. **Not done:** moving a running command to the background (`ctrl+b` is the browser
key, and it needs `exec`'s process handed to `TaskManager`). **The approval box fits since
v5.24** (`approvalLayout`, `live-layout.js`): it is drawn where the input was and was charged as the
input's three rows while drawing fifteen with a long command — 15 clears at 16 rows. Every row is
decided and truncated now, the extra rows come out of the live turn, and what gives way is padding,
reason, directory, then the border, never the command; a cut command says so on the title row. 0
clears at 10, 13, 16 and 24 rows. The diff box: `diffBoxLayout` (v9.9.6).

**A Canvas is a file request (v9.9.4, `canvasTitles`, `_askForCanvasFile`).** Gemini writes
documents and "interactive visuals" into its Canvas (read live: ~31 s behind the stop button). The
chip is scraped as `[Gemini Canvas: "<title>" — …]` (`canvasMarker`); a reply with it and no
call is asked once per turn for `create_file`. v7 says not to
(`noCanvas`, v9.9.6). **An append
hidden in an edit is run as one** (`appendHiddenInEdit`): an `oldText` of 40+ characters that ends
the file and that `newText` starts with; the classifier counts only the added lines, so auto mode
does not stop on a section added by rewriting the tail.

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

**A large file is read by a subagent (v6.16, `core/subagents/delegated-read.js`, plan Phase 7).** An
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

**Project commands are detected (v7.4, `core/prompt/project-commands.js`).** Asked by the codebase-support
findings: the model opened `package.json` or `Gemfile` to learn how to run tests, a round trip each,
and guessed `npm test` in Ruby repos. Root marker files give test, lint and build (`package.json` by
lockfile, `Gemfile` → rspec / Rails / rubocop, `go.mod`, `pyproject.toml`, Maven, Gradle, Cargo,
CMake, then a `Makefile` for what is missing); a `Test: …` line in `AGENT.md` wins. v2 says it in a
`<project_commands>` block on turn 0 (`projectCommands`; nothing found, no block); `/context` shows
each with its source. Pty: `/context` in a Gemfile repo at 13 and 24 rows, 0 clears.

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
`read_file` of a large log (`core/turn/log-read.js`) gets the overview, headed as one. That applies to
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

**Every other language comes from one table since v6.21 (`context/pattern-symbols.js`).** Asked
"can't we make it generic?": a row per language (TypeScript, Python, Go, Java, Kotlin, C#, Swift,
Scala, Rust, PHP, C/C++, Elixir, Lua, shell) gives comments, string forms (raw, triple, interpolated,
char) and definition patterns. One scanner blanks literals and one matcher finds names. C-like
rows also pass `definitionShape`, which follows the parameters across lines, rejects a call inside
an expression, and needs a body, `throws`, `:` or `->` after the `)`. Measured against each
language's own parser, as definitions / references, recall/precision:

| oracle | files | definitions | references |
| --- | --- | --- | --- |
| Python `ast`, stdlib | 626 | 99.80 / 99.99 | 100 / 100 |
| `go/ast`, every 3rd GOROOT file | 1,501 | 99.96 / 100 | 100 / 100 |
| TypeScript compiler, `.d.ts` | 108 | 99.11 / 99.98 | 99.98 / 100 |
| `javac` + its scanner, JDK 23 `java.util/io/net/sql/http` | 410 | 99.31 / 99.97 | 100 / 100 |
| clang AST + raw lexer, googletest/spirv-tools/glslang (v6.23) | 325 | 98.50 / 97.90 | 100 / 100 |
| TypeScript compiler, Radix UI's React `.tsx` (v6.23) | 149 | 99.35 / 99.22 | 99.53 / 100 |

C++ counts only definitions with a body (`bodyOnly`) and skips multi-line `#define` bodies; ALL-CAPS
names before `(` are macro calls. **Kotlin, C#, Swift, Scala, Rust, PHP, Elixir, Lua and shell
have fixtures, not an oracle.** The index skips files over 2 MB as generated, plus `vendor`,
`.venv`, `site-packages`, `target`, `Pods`, `.gradle`, `.next` and `*.d.ts`. Answers carry
`patternNote` and mark such files `byText`. v2's `find_symbol` names the languages; v1 keeps
"JavaScript and JSX only". What each oracle found: [`docs/history.md`](../history.md#moved-from-claudemd-in-v87).

**A partial read of Markdown ends with the headings it did not show (v6.14, `unreadOutline` in
`mcp/tools/read-file.js`).** Asked about this agent's architecture, the model read README lines
1–100 and 90–150 and answered from them; the pointer to this file sat under `## More` at line 258,
and nothing in either read said that section existed. `#`–`###`, fenced code skipped, capped at
40, written `- ## More (line 258)` because `fitReadResult` reads a leading number as a shown line.
**Code gets the same since v7.6 (`codeOutline`):** a partial read ends with `Defined outside lines
1–800:` and `- method total (line 840)`, from the `find_symbol` engines (acorn, Ruby, the pattern
table), so the next read is aimed rather than paged. Silent on a whole read, an unknown language, a
file over 2 MB or a parse error. Pty: a scripted ranged read of a Ruby file put `method charge (line
32)` in the next prompt; 0 clears at 13 and 24 rows.
`AGENT.md` (in every turn-0 prompt) and README's "How it works" now point here too.

`executeTool` retries transient OS errors (EBUSY/EACCES/EAGAIN/EMFILE/EPERM) with
backoff and rewrites `errno` codes into LLM-readable instructions.
