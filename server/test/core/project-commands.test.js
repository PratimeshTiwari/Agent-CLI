import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProjectCommands, commandsFromAgentMd, describeCommands } from '../../src/core/project-commands.js';
import { PromptBuilder } from '../../src/core/prompt-builder.js';

function project(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'cmds-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) {
    if (name.endsWith('/')) { mkdirSync(join(root, name), { recursive: true }); continue; }
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), body);
  }
  return root;
}
const detect = (root, agentMd) => detectProjectCommands(root, { agentMd }).commands;

test('JavaScript: scripts by lockfile, and npm\'s placeholder test is not a test', (t) => {
  assert.deepEqual(detect(project(t, { 'package.json': JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .', build: 'vite build' } }) })),
    { test: 'npm test', lint: 'npm run lint', build: 'npm run build' });
  assert.deepEqual(detect(project(t, { 'package.json': '{"scripts":{"test":"jest"}}', 'pnpm-lock.yaml': '' })), { test: 'pnpm run test' });
  assert.deepEqual(detect(project(t, { 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' })), {});
  assert.deepEqual(detect(project(t, { 'package.json': '{ not json' })), {}, 'a broken file is no answer, not a throw');
});

test('Ruby: rspec, Rails tests and rubocop', (t) => {
  assert.deepEqual(detect(project(t, { Gemfile: "gem 'rubocop'\n", 'spec/': '' })), { test: 'bundle exec rspec', lint: 'bundle exec rubocop' });
  assert.deepEqual(detect(project(t, { Gemfile: "gem 'rails'\n", 'bin/rails': '', 'test/': '' })), { test: 'bin/rails test' });
});

test('Go, Java, Python, Rust, C++ and a Makefile', (t) => {
  assert.deepEqual(detect(project(t, { 'go.mod': 'module x\n' })), { test: 'go test ./...', lint: 'go vet ./...', build: 'go build ./...' });
  assert.equal(detect(project(t, { 'go.mod': '', '.golangci.yml': '' })).lint, 'golangci-lint run');
  assert.deepEqual(detect(project(t, { 'pom.xml': '<project/>', mvnw: '' })), { test: './mvnw test', build: './mvnw package' });
  assert.deepEqual(detect(project(t, { 'build.gradle.kts': '', gradlew: '' })), { test: './gradlew test', build: './gradlew build' });
  assert.deepEqual(detect(project(t, { 'pyproject.toml': '[tool.ruff]\n' })), { test: 'pytest', lint: 'ruff check .' });
  assert.equal(detect(project(t, { 'Cargo.toml': '' })).lint, 'cargo clippy');
  assert.deepEqual(detect(project(t, { 'CMakeLists.txt': '' })), { test: 'ctest --test-dir build', build: 'cmake --build build' });
  // A Makefile fills only what is still missing.
  assert.deepEqual(detect(project(t, { 'go.mod': '', Makefile: 'lint:\n\tgolint\n' })).lint, 'go vet ./...');
  assert.deepEqual(detect(project(t, { Makefile: 'build:\n\tcc\nlint:\n\tx\n' })), { lint: 'make lint', build: 'make build' });
  // Control: nothing at the root, nothing said.
  assert.deepEqual(detect(project(t, { 'README.md': '# x' })), {});
});

test('AGENT.md wins, in the forms people write it', (t) => {
  assert.deepEqual(commandsFromAgentMd('Test: pnpm vitest\n- **Lint**: `pnpm lint`\nnot a command: x\n'),
    { test: 'pnpm vitest', lint: 'pnpm lint' });
  const root = project(t, { 'package.json': '{"scripts":{"test":"jest","build":"tsc"}}' });
  const found = detectProjectCommands(root, { agentMd: 'Test: pnpm vitest' });
  assert.deepEqual(found.commands, { test: 'pnpm vitest', build: 'npm run build' });
  assert.deepEqual(found.sources, { test: 'AGENT.md', build: 'package.json' });
  assert.equal(describeCommands(found), 'test `pnpm vitest` · build `npm run build`');
});

test('the turn-0 prompt names them on v2 only, and only when something was found', (t) => {
  const root = project(t, { Gemfile: '', 'spec/': '' });
  const build = (version, ws = root) => {
    const pb = new PromptBuilder(ws, ws);
    pb.promptVersion = version;
    return pb.buildPrompt({ userMessage: 'hi', mode: 'plan', subagents: true, modelConfig: { effort: 'high' } });
  };
  assert.match(build('v2'), /<project_commands>\ntest `bundle exec rspec`\n/);
  assert.doesNotMatch(build('v1'), /project_commands/, 'v1 is frozen');
  assert.doesNotMatch(build('v2', project(t, { 'notes.txt': '' })), /project_commands/, 'nothing found, no block');
});
