import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logTrace } from '../../src/core/trace-log.js';
import { browserTimings } from '../../src/ui/hooks/use-slash-commands.js';

// v7.2 (#104): recorded and read in one change — a field with no view is the
// write-only trap this repo has fallen into before.
test('/logs speed shows typing by path once the tab reports it', (t) => {
  const ws = mkdtempSync(join(tmpdir(), 'timings-'));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  logTrace(ws, { stages: { type: 400 }, chars: 1000 });
  assert.doesNotMatch(browserTimings(ws), /Typing the prompt/, 'control: nothing to split yet');
  logTrace(ws, { stages: { type: 35000 }, chars: 28000, typed: 'inserted', hidden: true });
  const out = browserTimings(ws);
  assert.match(out, /\*\*Typing the prompt\*\* — by path/);
  assert.match(out, /inserted · hidden\s+n=1\s+35\.0s/);
  assert.match(out, /per 1k chars/);
});
