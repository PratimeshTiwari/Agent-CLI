/**
 * What `ctrl+e` will and will not expand.
 *
 * A committed step draws with **no cap**, deliberately — it is `<Static>`
 * output, ordinary scrollback, and capping it is why expanding a step that
 * finished ten minutes ago used to end in `... [truncated]`.
 *
 * That is right for output that exists nowhere else, and wrong for a copy of
 * something you already have. Expanding `read_file` on CLAUDE.md printed
 * **2,046 lines and 136.9 KB** into the transcript, pushing the turn that
 * mattered off the screen.
 *
 * Asked for in those words: *"never expand file_reads, no edits — we should
 * show things like edit, or things that make sense, like a command run."*
 *
 * The line is between **retrieval** and **consequence**: a read, a listing or
 * a search can be run again and its result is on disk; an edit, a command or a
 * background job leaves output that is the only record it happened.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(
  new URL('../../src/ui/components/TranscriptTurn.jsx', import.meta.url), 'utf8',
);

const listed = new Set(
  [.../const NOT_WORTH_EXPANDING = new Set\(\[([\s\S]*?)\]\)/.exec(src)[1]
    .matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
);

test('retrieval is never expanded', () => {
  for (const tool of ['read_file', 'list_directory', 'grep_search', 'search_files']) {
    assert.ok(listed.has(tool), `${tool} still dumps its whole output into the transcript`);
  }
});

/*
 * The negative control, and the more important half. If this list grew to
 * cover everything, `ctrl+e` would silently stop working and look fine.
 */
test('consequence still is', () => {
  for (const tool of ['edit_file', 'create_file', 'run_command', 'run_background']) {
    assert.ok(!listed.has(tool),
      `${tool} is no longer expandable — its output is the only record it ran`);
  }
});

test('the rule is applied, not merely declared', () => {
  // The definition is `limitsFor = (…)`, not `limitsFor(…)` — the first draft
  // of this assertion looked for the call form and failed against correct code.
  assert.match(src, /const limitsFor = \(isLive, verbose, toolName\) =>/,
    'limitsFor does not take the tool name, so the list cannot be consulted');
  assert.match(src, /NOT_WORTH_EXPANDING\.has\(toolName\)/);
  assert.match(src, /limitsFor\(isLive, verbose, act\.toolName\)/,
    'the caller does not pass the tool name');
});

// Collapsed rows were already short; the change must not have touched them,
// or every summary line in the transcript grows.
test('collapsed output is unchanged', () => {
  assert.match(src, /if \(!verbose \|\| NOT_WORTH_EXPANDING\.has\(toolName\)\) return \{ lines: 6, chars: 400 \}/);
});
