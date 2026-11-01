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
  new URL('../../src/frontend/components/TranscriptTurn.jsx', import.meta.url), 'utf8',
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
  assert.match(src, /if \(NOT_WORTH_EXPANDING\.has\(toolName\)\) return \{ lines: 6, chars: 400, hint: '' \}/);
  assert.match(src, /if \(!verbose\) return \{ lines: 6, chars: 400, hint: 'ctrl\+e to expand' \}/);
});

// The marker names the key only where the key shows more. A retrieval does not
// expand, so offering ctrl+e there would be a promise ctrl+e does not keep.
test('the expand hint is offered only where ctrl+e expands', () => {
  const NOT = /if \(NOT_WORTH_EXPANDING\.has\(toolName\)\) return \{[^}]*hint: '' \}/;
  assert.match(src, NOT, 'a read would offer ctrl+e and then not expand');
  assert.ok(src.indexOf('NOT_WORTH_EXPANDING.has(toolName)) return') < src.indexOf("if (!verbose) return"),
    'the retrieval rule must run before the collapsed rule, or reads get the hint');
  assert.doesNotMatch(src, /clampForDisplay\(act\.\w+, limit\.lines, limit\.chars\)(?!,)/,
    'a clamp site that does not pass the hint keeps the old silent marker');
});
