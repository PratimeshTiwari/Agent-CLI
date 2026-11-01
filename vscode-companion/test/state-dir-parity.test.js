/**
 * The companion finds the agent's state directory exactly where the CLI does.
 *
 * Ported from `server/src/core/workspace/paths.js` because the companion cannot import
 * from the server; compared against the real thing here, for the ordinary
 * repo and for the monorepo layout where the two used to disagree.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { agentStateDir } = require('../chat-panel-html.js');

test('agentStateDir matches paths.stateDir', async (t) => {
  const paths = await import('../../server/src/backend/core/workspace/paths.js');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'state-parity-')));

  await t.test('an ordinary repo: <ws>/.agent/state', () => {
    const ws = path.join(base, 'plain');
    fs.mkdirSync(ws);
    paths.clearPathCache();
    assert.equal(agentStateDir(ws), paths.stateDir(ws));
    assert.equal(agentStateDir(ws), path.join(ws, '.agent', 'state'));
  });

  await t.test('a repo under a shared .agent: the scoped state dir', () => {
    const mono = path.join(base, 'mono');
    const repo = path.join(mono, 'repo-1');
    fs.mkdirSync(path.join(mono, '.agent'), { recursive: true });
    fs.mkdirSync(repo);
    paths.clearPathCache();
    assert.equal(agentStateDir(repo), paths.stateDir(repo));
    assert.equal(agentStateDir(repo), path.join(mono, '.agent', 'repo-1', 'state'),
      'the old rule answered <repo>/.agent/state, where the CLI never looks');
  });

  await t.test("the agent's own home is never adopted as a project root", () => {
    const fakeHome = path.join(base, 'home');
    const ws = path.join(fakeHome, 'code', 'app');
    fs.mkdirSync(path.join(fakeHome, '.agent'), { recursive: true });
    fs.mkdirSync(ws, { recursive: true });
    assert.equal(agentStateDir(ws, { home: fakeHome }), path.join(ws, '.agent', 'state'));
  });
});
