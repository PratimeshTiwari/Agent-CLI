/**
 * Prompt v4 (v8.1) is v3 plus `jira_issue` — and only once a site is set up,
 * because a tool the model is told about and cannot use costs a turn.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptBuilder } from '../../../src/backend/core/prompt-builder.js';
import { PROMPT_VERSIONS, FLAG_NOTES, versionChanges } from '../../../src/backend/core/prompt-versions.js';

const ws = mkdtempSync(join(tmpdir(), 'v4-'));

function defs(version, jira, effort = 'standard') {
  const pb = new PromptBuilder(ws, ws);
  pb.promptVersion = version;
  pb.jiraAvailable = jira;
  return { text: pb._buildToolDefinitions(true, { effort }), anchor: pb._buildToolAnchor(true, { effort }) };
}

describe('prompt v4', () => {
  it('is v3 plus one switch', () => {
    const { jira, ...rest } = PROMPT_VERSIONS.v4.flags;
    assert.equal(jira, true);
    assert.deepEqual(rest, PROMPT_VERSIONS.v3.flags);
    assert.equal(PROMPT_VERSIONS.v4.dir, PROMPT_VERSIONS.v3.dir);
    assert.ok(FLAG_NOTES.jira);
    assert.ok(versionChanges('v4').some((l) => /Jira/.test(l)));
  });

  it('offers jira_issue when a site is set up, in the definitions and the anchor', () => {
    for (const effort of ['low', 'medium', 'high']) {
      const { text, anchor } = defs('v4', true, effort);
      assert.ok(text.includes('## jira_issue'), effort);
      assert.match(anchor, / jira_issue /);
    }
  });

  it('without a site, v4 is v3 byte for byte', () => {
    for (const effort of ['low', 'medium', 'high']) {
      assert.equal(defs('v4', false, effort).text, defs('v3', false, effort).text, effort);
      assert.equal(defs('v4', false, effort).anchor, defs('v3', false, effort).anchor, effort);
    }
  });

  it('no earlier version offers it, set up or not', () => {
    for (const v of ['v1', 'v2', 'v3']) assert.ok(!defs(v, true).text.includes('jira_issue'), v);
  });

  it('the anchor follows a sign-in made mid-session', () => {
    const pb = new PromptBuilder(ws, ws);
    pb.promptVersion = 'v4';
    pb.jiraAvailable = false;
    const before = pb._buildToolAnchor(true, { effort: 'low' });
    pb.jiraAvailable = true;
    const after = pb._buildToolAnchor(true, { effort: 'low' });
    assert.ok(!before.includes('jira_issue'));
    assert.ok(after.includes('jira_issue'), 'not stuck on the cached list');
  });

  it('both forms say every write asks, not to retry a rejection, and how to hand off', () => {
    for (const effort of ['low', 'high']) {
      const t = defs('v4', true, effort).text;
      const start = t.indexOf('## jira_issue');
      const block = t.slice(start, t.indexOf('## ', start + 3));
      assert.match(block, /asks\s+the\s+user\s+first|only\s+sent\s+if\s+they\s+approve/, effort);
      assert.match(block, /do\s+not\s+retry/, effort);
      assert.match(block, /HANDED OFF/, effort);
      assert.match(block, /never\s+say\s+(it\s+was\s+done|it\s+happened)/, effort);
    }
  });
});
