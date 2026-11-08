# Tests and the pty harness

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Tests

```bash
npm test                                       # -> server: node --test "test/**/*.test.js"
node --test server/test/backend/core/commands/risk-classifier.test.js   # single file
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
(`prompt-loader.test.js` reads `../../../../src/backend/prompts`).

**The suite runs against a throwaway home.** `test/setup-home.js` is preloaded by the `test`
script and points `AGENT_CLI_HOME` at a temp dir. Without it every test that built an
`AgentLoop` against a temp workspace wrote that workspace's durable history into the real
`~/.agent/workspaces/` — 3,238 folders by 2026-10-19, twelve more per run, failing nothing. A
test that sets its own home must **restore** the previous value on teardown, never `delete`
it, or every later test in that file falls back to the real one; `test-home.test.js` names
any file that does. Running a single file with bare `node --test` skips the preload — use
`node --import ./test/setup-home.js --test <file>` for anything that touches sessions.
**Nor does it write into the repo (v9.9.4).** The v1-golden negative control edited a shipped
prompt file in place, and a running agent's watcher showed it as "modified externally". It copies
`SHIPPED_PROMPTS_DIR` to a temp dir and points `usePromptsDir` there, restoring it on teardown.

**Expected state: all tests pass.** They used to be 34/10/24 red: the tests described designs
the code had replaced — `plan-generator` writes one file per comment under `PR-<n>/` rather than
one `PR-<n>.md` per PR, and `comment-classifier` stopped categorising by keyword once the AI
took that over. Both test files were rewritten against the shipped behaviour, so a failure now is
a real regression.

**CI runs the suite on every push (v8.7, `.github/workflows/ci.yml`)**: macOS and Linux, Node 22
and 24, after `agent --help` and `agent doctor --offline`. Three tests guard what used to ship stale:
`extension/test/bundle-fresh.test.js` (the committed `service-worker.js` is the build of its sources),
`vscode-companion/test/vsix-fresh.test.js` (the one committed `.vsix` holds the current companion and
side panel) and `server/test/docs-size.test.js` (this file stays under 145,000 characters).

There is no lint script; `package.json` holds `eslintConfig` (eslint:recommended) and
`prettier` (100 cols, single quotes, trailing commas) for editors.

## The pty harness — how anything user-visible gets measured

Most of the numbers in this file came from a harness that drives the **real CLI under a pty**
with a fake extension answering prompts from a script, so a full turn — inject, reply, tool
call, tool result, next prompt — runs with no browser and no Gemini account. It lives in
`.agent/artifacts/harness/`, not the repo. Rebuild it from this:

- **`drive.py`** — `pty.fork()` the CLI with `--workspace <scratch> --port <p> --editor <shim>`.
  `PATH` is prefixed with a `bin/` of shims for `open`, `code`, `xdg-open` and
  `cursor` that log their argv instead of launching anything, which is how "did it open the
  editor" became checkable. Steps are a JSON list: type text, send a key, resize the window
  (`{"resize": [rows, cols]}`), or write a file into `.agent/state/` to stand in for the VS
  Code companion. It counts bytes, `ESC[2J`, `ESC[3J` and erase-lines per step — which is what
  makes a frame regression visible at all.
- **`fake-extension.js`** — connects with a `chrome-extension://` origin, sends
  `{type:'identify', payload:{clientType:'extension'}}` (`clientType`, not `client`), and
  answers each `inject_prompt` from a scripted list. It logs every prompt it is given, which
  is where the per-turn character counts come from.
- **`tabrig/`** — the real CLI and the real extension in headless Chrome against a Gemini-shaped
  page. Branded Chrome ignores `--load-extension`: CDP pipe, `Extensions.loadUnpacked`,
  `--host-resolver-rules`, the port patched in a scratch copy, a fresh profile per run.
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

`test/backend/mcp/tool-smoke.test.js` is the answer that generalises: every registered tool called once
on its happy path, plus a membership assertion so a tool added later cannot slip past by simply
not being in the map. It asserts almost nothing about *what* comes back — the per-tool suites
do that — only that the call the agent makes does not throw. A tool that cannot run at all is
the failure that costs a whole turn, and the model has been told by the prompt that it exists.

## From Gotchas

- **Every slash command is driven once by a test, bare and with arguments.**
  `use-slash-commands.js` was 967 lines at **8.69% line coverage** — the lowest
  in the repo, and the surface almost every bug reported from use has come from.
  `test/frontend/slash-command-smoke.test.js` is shallow and total, the same shape as
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

  The two faults the sweep found (`/effort deeep`, a bare `/`) are in `docs/history.md`.

- Running the CLI without a TTY fails with Ink's "Raw mode is not supported". That is the
  harness, not a bug — use `script -q /dev/null <cmd>` to test under a pty.
