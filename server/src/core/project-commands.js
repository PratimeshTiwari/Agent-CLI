/**
 * How this project runs its tests, its linter and its build (v7.4).
 *
 * The model used to find out by opening `package.json` or `Gemfile`, a full
 * inject → think → scrape round trip each time, and then guessed `npm test` in
 * a Ruby repo often enough to be noticed. The answer is in marker files at the
 * workspace root, so it is read once and said in one line of the turn-0
 * prompt (prompt v2). `AGENT.md` wins: a `Test: …` line there is a person
 * saying what is true, which beats any guess made from files.
 *
 * Read-only, root only, and never throws: a project this cannot read simply
 * gets no line, which is what every project had before.
 */
import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['test', 'lint', 'build'];

const NO_TEST_SCRIPT = /no test specified/;

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}
const has = (root, name) => fs.existsSync(path.join(root, name));

/** npm, pnpm, yarn or bun, by lockfile. */
function packageRunner(root) {
  if (has(root, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(root, 'yarn.lock')) return 'yarn';
  if (has(root, 'bun.lockb') || has(root, 'bun.lock')) return 'bun';
  return 'npm';
}

function fromPackageJson(root) {
  const text = readText(path.join(root, 'package.json'));
  if (!text) return null;
  let scripts;
  try { scripts = JSON.parse(text).scripts || {}; } catch { return null; }
  const run = packageRunner(root);
  const cmd = (name) => (name === 'test' && run === 'npm' ? 'npm test' : `${run} run ${name}`);
  const out = {};
  if (scripts.test && !NO_TEST_SCRIPT.test(scripts.test)) out.test = cmd('test');
  if (scripts.lint) out.lint = cmd('lint');
  if (scripts.build) out.build = cmd('build');
  return { file: 'package.json', commands: out };
}

function fromGemfile(root) {
  const gemfile = readText(path.join(root, 'Gemfile'));
  if (gemfile === null) return null;
  const lock = readText(path.join(root, 'Gemfile.lock')) || '';
  const gems = `${gemfile}\n${lock}`;
  const out = {};
  if (has(root, 'spec') || /\brspec\b/.test(gems)) out.test = 'bundle exec rspec';
  else if (has(root, 'bin/rails') && has(root, 'test')) out.test = 'bin/rails test';
  else if (has(root, 'test') || has(root, 'Rakefile')) out.test = 'bundle exec rake test';
  if (/\brubocop\b/.test(gems)) out.lint = 'bundle exec rubocop';
  return { file: 'Gemfile', commands: out };
}

function fromGoMod(root) {
  if (!has(root, 'go.mod')) return null;
  const lint = has(root, '.golangci.yml') || has(root, '.golangci.yaml') ? 'golangci-lint run' : 'go vet ./...';
  return { file: 'go.mod', commands: { test: 'go test ./...', lint, build: 'go build ./...' } };
}

function fromPython(root) {
  const pyproject = readText(path.join(root, 'pyproject.toml'));
  const markers = ['pyproject.toml', 'setup.cfg', 'pytest.ini', 'tox.ini'];
  const file = markers.find((m) => has(root, m));
  if (!file) return null;
  const out = { test: 'pytest' };
  if (pyproject && /\bruff\b/.test(pyproject)) out.lint = 'ruff check .';
  else if (pyproject && /\bflake8\b/.test(pyproject)) out.lint = 'flake8';
  return { file, commands: out };
}

function fromMaven(root) {
  if (!has(root, 'pom.xml')) return null;
  const mvn = has(root, 'mvnw') ? './mvnw' : 'mvn';
  return { file: 'pom.xml', commands: { test: `${mvn} test`, build: `${mvn} package` } };
}

function fromGradle(root) {
  const file = ['build.gradle.kts', 'build.gradle'].find((f) => has(root, f));
  if (!file) return null;
  const gradle = has(root, 'gradlew') ? './gradlew' : 'gradle';
  return { file, commands: { test: `${gradle} test`, build: `${gradle} build` } };
}

function fromCargo(root) {
  if (!has(root, 'Cargo.toml')) return null;
  return { file: 'Cargo.toml', commands: { test: 'cargo test', lint: 'cargo clippy', build: 'cargo build' } };
}

function fromCMake(root) {
  if (!has(root, 'CMakeLists.txt')) return null;
  return { file: 'CMakeLists.txt', commands: { test: 'ctest --test-dir build', build: 'cmake --build build' } };
}

/** A Makefile's own targets, as the last word for whatever is still missing. */
function fromMakefile(root) {
  const text = readText(path.join(root, 'Makefile'));
  if (text === null) return null;
  const out = {};
  for (const kind of KINDS) if (new RegExp(`^${kind}\\s*:`, 'm').test(text)) out[kind] = `make ${kind}`;
  return { file: 'Makefile', commands: out };
}

const DETECTORS = [fromPackageJson, fromGemfile, fromGoMod, fromPython, fromMaven, fromGradle, fromCargo, fromCMake, fromMakefile];

/**
 * `Test: bundle exec rspec`, `- **Lint**: \`npm run lint\``: the person's word.
 * @returns {Record<string, string>}
 */
export function commandsFromAgentMd(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(?:[-*]\s+)?\**(test|lint|build)\**\s*:\**\s*`?([^`\n]+?)`?\s*$/i);
    if (m && !out[m[1].toLowerCase()]) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/**
 * What runs the tests, the linter and the build here.
 *
 * @param {string} root the workspace
 * @param {{agentMd?: string}} [opts]
 * @returns {{commands: Record<string, string>, sources: Record<string, string>}}
 *   each kind's command, and where it came from (`AGENT.md` or a marker file)
 */
export function detectProjectCommands(root, { agentMd = '' } = {}) {
  const commands = {};
  const sources = {};
  const take = (kind, command, source) => {
    if (!commands[kind] && command) { commands[kind] = command; sources[kind] = source; }
  };
  for (const [kind, command] of Object.entries(commandsFromAgentMd(agentMd))) take(kind, command, 'AGENT.md');
  for (const detect of DETECTORS) {
    let found = null;
    try { found = detect(root); } catch { found = null; }
    if (!found) continue;
    for (const kind of KINDS) take(kind, found.commands[kind], found.file);
  }
  return { commands, sources };
}

/** `test \`npm test\` · lint \`npm run lint\``, or '' when nothing was found. */
export function describeCommands({ commands }) {
  return KINDS.filter((k) => commands[k]).map((k) => `${k} \`${commands[k]}\``).join(' · ');
}
