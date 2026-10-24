/**
 * The first-start card: shown once to a new person, never to an existing
 * install, and every step names something that exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstRunState, welcomeSteps, extensionDir, tildify } from '../../src/ui/welcome.js';
import { SLASH_COMMANDS } from '../../src/ui/constants.js';

const here = dirname(fileURLToPath(import.meta.url));

test('a new person sees it once, and is marked so they do not see it again', () => {
  const home = mkdtempSync(join(tmpdir(), 'welcome-'));
  const workspacesDir = join(home, 'workspaces');
  mkdirSync(workspacesDir);
  assert.deepEqual(firstRunState({ settings: {}, workspacesDir }), { show: true, mark: true });
  assert.deepEqual(firstRunState({ settings: { welcomed: true }, workspacesDir }), { show: false, mark: false });
});

test('an install from before the card is marked without being shown anything', () => {
  const home = mkdtempSync(join(tmpdir(), 'welcome-'));
  const workspacesDir = join(home, 'workspaces');
  mkdirSync(join(workspacesDir, 'Gemini-Agent-abc123'), { recursive: true });
  assert.deepEqual(firstRunState({ settings: { theme: 'dark' }, workspacesDir }), { show: false, mark: true },
    'a long-time user greeted as a stranger after /reset empties workspaces/');
  // Control: a dotfile (.DS_Store) is not history.
  const fresh = join(mkdtempSync(join(tmpdir(), 'welcome-')), 'workspaces');
  mkdirSync(fresh);
  mkdirSync(join(fresh, '.DS_Store'));
  assert.equal(firstRunState({ settings: {}, workspacesDir: fresh }).show, true);
});

test('a missing or unreadable workspaces folder reads as new, and never throws', () => {
  assert.equal(firstRunState({ settings: {}, workspacesDir: '/nonexistent/workspaces' }).show, true);
  assert.equal(firstRunState({ settings: {}, workspacesDir: 'x', readdir: () => { throw new Error('EACCES'); } }).show, true);
});

test('every step names a real thing: the commands exist and the folder is the extension', () => {
  const steps = welcomeSteps({ themeLabel: 'Terminal', extensionPath: extensionDir() });
  assert.deepEqual(steps.map((s) => s.key), ['theme', 'name', 'chrome']);
  for (const cmd of ['theme', 'name']) {
    assert.ok(SLASH_COMMANDS.some((c) => c.name === cmd), `/${cmd} is offered and does not exist`);
  }
  assert.ok(existsSync(join(extensionDir(), 'manifest.json')), 'Load unpacked would be pointed at the wrong folder');
  assert.ok(steps[2].lines.includes(extensionDir()));
  assert.match(steps[0].lines[0], /now: Terminal/);
  assert.doesNotMatch(steps[1].lines[0], /now:/, 'no name set, nothing to say about it');
  assert.match(welcomeSteps({ agentName: 'Argon', extensionPath: 'x' })[1].lines[0], /now: Argon/);
});

test('paths under home read as ~', () => {
  assert.equal(tildify('/Users/p/code/ext', '/Users/p'), '~/code/ext');
  assert.equal(tildify('/Users/pat/x', '/Users/p'), '/Users/pat/x', 'a sibling that shares a prefix is not home');
});

test('main decides before the loop exists, and before the UI starts', () => {
  const src = readFileSync(join(here, '../../src/main.js'), 'utf8');
  const decide = src.indexOf('firstRunState(');
  assert.ok(decide > 0);
  assert.ok(decide < src.indexOf('new AgentLoop('),
    "the loop's session store creates workspaces/<slug>, so deciding after it never shows the card");
  assert.ok(decide < src.indexOf('new CliUI('));
});
