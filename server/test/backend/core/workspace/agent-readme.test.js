import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAgentReadme, README_TEXT, README_MARKER } from '../../../../src/backend/core/workspace/agent-readme.js';
import * as paths from '../../../../src/backend/core/workspace/paths.js';
import { STATE_ENTRIES } from '../../../../src/backend/core/install/reset.js';

function repo({ withAgent = true } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'agent-readme-'));
  if (withAgent) mkdirSync(join(ws, '.agent', 'sessions'), { recursive: true });
  paths.clearPathCache();
  return ws;
}

test('written into the folder, then left alone while it is current', () => {
  const ws = repo();
  assert.equal(writeAgentReadme(ws), 'written');
  assert.equal(readFileSync(join(ws, '.agent', 'README.md'), 'utf8'), README_TEXT);
  assert.equal(writeAgentReadme(ws), 'current');
});

test('it never creates the .agent folder', () => {
  const ws = repo({ withAgent: false });
  assert.equal(writeAgentReadme(ws), 'no-folder');
  assert.equal(existsSync(join(ws, '.agent')), false, 'a README must not be what makes a .agent');
});

test('an old one of ours is refreshed; one without the marker is the person\'s', () => {
  const ws = repo();
  const file = join(ws, '.agent', 'README.md');
  writeFileSync(file, `${README_MARKER}\nan older layout\n`);
  assert.equal(writeAgentReadme(ws), 'refreshed');
  assert.equal(readFileSync(file, 'utf8'), README_TEXT);
  writeFileSync(file, '# my notes about this folder\n');
  assert.equal(writeAgentReadme(ws), 'theirs');
  assert.equal(readFileSync(file, 'utf8'), '# my notes about this folder\n');
});

test('in a monorepo it goes to the shared root, not into a repo', () => {
  const base = mkdtempSync(join(tmpdir(), 'agent-readme-mono-'));
  mkdirSync(join(base, '.agent'), { recursive: true });
  mkdirSync(join(base, 'repo-1'));
  paths.clearPathCache();
  assert.equal(writeAgentReadme(join(base, 'repo-1')), 'written');
  assert.ok(existsSync(join(base, '.agent', 'README.md')));
  assert.equal(existsSync(join(base, 'repo-1', '.agent')), false);
});

test('it names the folders docs/agent-folder.md names, and /reset moves it', () => {
  const doc = readFileSync(new URL('../../../../../docs/agent-folder.md', import.meta.url), 'utf8');
  const tree = doc.slice(doc.indexOf('## `<repo>/.agent/`'), doc.indexOf('### What each one answers'));
  const top = [...tree.matchAll(/^├── ([a-z.-]+\/?)|^└── ([a-z.-]+\/?)/gm)].map((m) => m[1] || m[2]);
  assert.ok(top.length >= 8, `the doc's tree was not read: ${top}`);
  for (const name of top) assert.ok(README_TEXT.includes(`\`${name}\``), `README.md does not mention ${name}`);
  assert.ok(STATE_ENTRIES.includes('README.md'), '/reset should take it with the rest');
});

test('main.js writes it at startup, after the migrations', () => {
  const main = readFileSync(new URL('../../../../src/main.js', import.meta.url), 'utf8');
  const at = main.indexOf('writeAgentReadme(');
  assert.ok(at > 0, 'never called');
  assert.ok(at > main.indexOf('runMigrations(config.workspace)'), 'before the migrations, it could land in a stray');
});
