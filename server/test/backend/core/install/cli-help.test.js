import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HELP_TEXT } from '../../../../src/backend/core/install/cli-help.js';

// v8.5, owner: "agent doctor — how do I even know? it should be documented".
test('--help names every flag main.js parses and every shell command the bin answers', () => {
  const main = readFileSync(new URL('../../../../src/main.js', import.meta.url), 'utf8');
  const flags = [...main.matchAll(/case '(--[a-z-]+)':/g)].map((m) => m[1]);
  assert.ok(flags.length >= 7, 'the flag scrape found the parser');
  for (const flag of flags) assert.ok(HELP_TEXT.includes(flag), `--help does not mention ${flag}`);
  for (const cmd of ['agent doctor', 'agent doctor --test', 'agent atlassian login']) assert.ok(HELP_TEXT.includes(cmd), cmd);
  // Control: a flag nothing parses is not offered.
  assert.doesNotMatch(HELP_TEXT, /--no-ci-watch/);
});
