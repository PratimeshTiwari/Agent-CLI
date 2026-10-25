/**
 * First-start setup: shown to a new person until they finish or skip it,
 * never to an existing install, and every screen fits the terminal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  firstRunState, extensionDir, extensionStatus, tildify, progressBar, revealColumns, onboardingLayout, STEPS,
} from '../../src/ui/welcome.js';

const here = dirname(fileURLToPath(import.meta.url));
const emptyWorkspaces = () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'welcome-')), 'workspaces');
  mkdirSync(dir);
  return dir;
};

test('a new person gets setup, marked pending until it ends', () => {
  assert.deepEqual(firstRunState({ settings: {}, workspacesDir: emptyWorkspaces() }), { show: true, write: 'pending' });
});

test('ctrl+c halfway brings it back, even though the loop has created workspaces/<slug> by then', () => {
  const dir = emptyWorkspaces();
  mkdirSync(join(dir, 'proj-abc'));
  assert.deepEqual(firstRunState({ settings: { welcomed: 'pending' }, workspacesDir: dir }), { show: true, write: null });
});

test('finished or skipped is final', () => {
  assert.deepEqual(firstRunState({ settings: { welcomed: true }, workspacesDir: emptyWorkspaces() }), { show: false, write: null });
});

test('an install from before setup existed is marked done without being shown anything', () => {
  const dir = emptyWorkspaces();
  mkdirSync(join(dir, 'Gemini-Agent-abc123'));
  assert.deepEqual(firstRunState({ settings: { theme: 'dark' }, workspacesDir: dir }), { show: false, write: true },
    'a long-time user greeted as a stranger after /reset empties workspaces/');
  // Control: a dotfile is not history.
  const fresh = emptyWorkspaces();
  mkdirSync(join(fresh, '.DS_Store'));
  assert.equal(firstRunState({ settings: {}, workspacesDir: fresh }).show, true);
});

test('a missing or unreadable workspaces folder reads as new, and never throws', () => {
  assert.equal(firstRunState({ settings: {}, workspacesDir: '/nonexistent/workspaces' }).show, true);
  assert.equal(firstRunState({ settings: {}, workspacesDir: 'x', readdir: () => { throw new Error('EACCES'); } }).show, true);
});

test('the Chrome step points Load unpacked at the real extension folder', () => {
  assert.ok(existsSync(join(extensionDir(), 'manifest.json')));
});

test('connected means an extension client, not the editor panel', () => {
  const ws = (clients) => ({ clients: new Map(clients.map((c, i) => [i, c])) });
  assert.deepEqual(extensionStatus(ws([{ type: 'editor' }])), { connected: false, version: null });
  assert.deepEqual(extensionStatus(ws([{ type: 'editor' }, { type: 'extension', extensionVersion: '1.49.0' }])),
    { connected: true, version: '1.49.0' });
  assert.deepEqual(extensionStatus(null), { connected: false, version: null });
});

test('the bar fills towards its step, one cell a tick, at a fixed width', () => {
  assert.equal(progressBar(0, 0), '▱'.repeat(12));
  assert.equal(progressBar(0), '▰'.repeat(4) + '▱'.repeat(8));
  assert.equal(progressBar(1, 2), '▰'.repeat(6) + '▱'.repeat(6), 'mid-animation from step 1 to 2');
  assert.equal(progressBar(STEPS.length - 1), '▰'.repeat(12));
  for (let s = 0; s < STEPS.length; s += 1) {
    for (let t = 0; t < 10; t += 1) assert.equal([...progressBar(s, t)].length, 12);
  }
});

test('the splash reveal stops at the full width', () => {
  assert.equal(revealColumns(0, 49), 0);
  assert.equal(revealColumns(5, 49), 20);
  assert.equal(revealColumns(100, 49), 49);
});

test('decoration is dropped as the terminal gets shorter, spacing last of all', () => {
  const tall = onboardingLayout(40);
  assert.deepEqual([tall.compact, tall.themePreview, tall.namePreview], [false, true, true]);
  assert.equal(tall.themeSample, false, 'the box already shows it');
  const mid = onboardingLayout(20);
  assert.equal(mid.themePreview, false, 'the theme screen with its preview is 21 rows');
  assert.equal(mid.themeSample, true, 'too short for the box still gets a sample');
  assert.equal(mid.namePreview, true);
  assert.equal(onboardingLayout(13).themeSample, true, 'compact: 10 rows plus two, under 13');
  assert.equal(onboardingLayout(12).themeSample, false, '12 rows leave 11, and that is one short');
  const short = onboardingLayout(12);
  assert.equal(short.compact, true);
});

test('main decides before the loop exists, and before the UI starts', () => {
  const src = readFileSync(join(here, '../../src/main.js'), 'utf8');
  const decide = src.indexOf('firstRunState(');
  assert.ok(decide > 0);
  assert.ok(decide < src.indexOf('new AgentLoop('),
    "the loop's session store creates workspaces/<slug>, so deciding after it never shows setup");
  assert.ok(decide < src.indexOf('new CliUI('));
});

test('paths under home read as ~', () => {
  assert.equal(tildify('/Users/p/code/ext', '/Users/p'), '~/code/ext');
  assert.equal(tildify('/Users/pat/x', '/Users/p'), '/Users/pat/x');
});
