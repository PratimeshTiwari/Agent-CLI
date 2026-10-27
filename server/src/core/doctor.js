/**
 * What the agent needs installed, what is, and what is newer (v5.29).
 *
 * Asked for on 2026-10-27: *"a health check … what all packages should be
 * installed, current version and latest version, and also show if something is
 * not installed, particularly helpful in work laptop case where some package
 * could be missed"* — then *"mention required/optional packages"* and *"entering
 * any package should mention why we're using it"*.
 *
 * `dep-recovery.js` already answers the loud case: a package the startup path
 * imports is missing, the process dies, one `npm install` runs and it restarts.
 * This answers the quiet ones, which that cannot see because nothing crashes:
 *
 * - **an optional package is missing** — `unpdf` is imported only when a PDF is
 *   read, so a pull that added it and an install that never ran leaves an agent
 *   that starts, works, and fails on the first PDF;
 * - **a package is the wrong version** — installed, importable, and not what
 *   `package.json` asks for, which is what a half-finished install on a
 *   locked-down machine leaves behind;
 * - **a tool is missing** — `git` (for `/update`), `rg` (`grep_search` falls
 *   back to a slower scan), `textutil` (`.doc` on macOS).
 *
 * **Built-ins only, and that is load-bearing.** `agent doctor` runs from the bin
 * before `tsx`, so it works on exactly the machine where `node_modules` is
 * broken. `doctor.test.js` fails on a non-builtin import here.
 *
 * Installed versions are read from `node_modules` directly — offline, a few
 * milliseconds, safe at startup. The latest versions come from `npm outdated`,
 * which uses the user's own npm config: a work laptop's registry mirror, proxy
 * and auth are already in it, where a hand-rolled `fetch` to npmjs.org would
 * be blocked or simply wrong.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo root: `server/src/core` → three up. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Tiers, in the order they are printed.
 *
 * `required` is a static import on the startup path — or `tsx`, which runs
 * everything — so without it the agent does not start. `optional` is imported
 * only when its feature is used, so without it that one feature fails.
 * `doctor.test.js` checks both claims against the source, because a tier that
 * says "optional" about a static import is wrong in the way that matters.
 */
export const TIERS = {
  required: 'the agent does not start without it',
  optional: 'one feature stops working without it',
  build: 'only for building the Chrome extension',
  test: 'only for running the tests',
  dev: 'only for editor type hints',
  unused: 'declared, but nothing imports it',
};

const TIER_ORDER = Object.keys(TIERS);

/**
 * Why each package is here. Every package any `package.json` declares has an
 * entry — `doctor.test.js` fails on one that does not, so the answer to "why
 * do we use xyz" cannot quietly go missing for the next dependency added.
 *
 * `why` is what it does for the agent; `without` is what the user would see.
 */
export const PACKAGES = {
  tsx: {
    tier: 'required',
    why: 'Runs the server. The sources contain JSX, which plain node cannot load, so the bin starts main.js under tsx.',
    without: 'The agent does not start: the bin prints "tsx not found".',
  },
  ink: {
    tier: 'required',
    why: 'The terminal UI: React rendered to the terminal. Every row, menu and the live frame is an Ink component.',
    without: 'The agent does not start.',
  },
  react: {
    tier: 'required',
    why: 'Ink is React for terminals; the UI components and their state are React.',
    without: 'The agent does not start.',
  },
  'ink-text-input': {
    tier: 'required',
    why: 'The prompt box and every text field in a menu.',
    without: 'The agent does not start.',
  },
  'ink-select-input': {
    tier: 'required',
    why: 'The pick-one lists on the first-start setup screens.',
    without: 'The agent does not start.',
  },
  'ink-spinner': {
    tier: 'unused',
    why: 'Was the thinking spinner; the spinner is drawn by the agent itself now and nothing imports this.',
    without: 'Nothing. It can be removed from server/package.json.',
  },
  marked: {
    tier: 'required',
    why: 'Parses the model\'s Markdown replies so they can be drawn in the terminal.',
    without: 'The agent does not start.',
  },
  'marked-terminal': {
    tier: 'required',
    why: 'Turns parsed Markdown into terminal text: headings, lists, code blocks and tables in colour.',
    without: 'The agent does not start.',
  },
  ws: {
    tier: 'required',
    why: 'The WebSocket server the Chrome extension, the side panel and the VS Code chat panel connect to. It is the bridge to Gemini.',
    without: 'The agent does not start.',
  },
  zod: {
    tier: 'required',
    why: 'Checks the arguments of every tool call the model writes before the tool runs, so a malformed call gets a readable error.',
    without: 'The agent does not start.',
  },
  diff: {
    tier: 'required',
    why: 'Builds the diffs for edit_file and create_file: the hunks you approve or reject, and undo.',
    without: 'The agent does not start.',
  },
  'fast-glob': {
    tier: 'required',
    why: 'Finds files for search_files and for the symbol index, honouring ignores.',
    without: 'The agent does not start.',
  },
  acorn: {
    tier: 'required',
    why: 'Parses JavaScript for find_symbol and find_references.',
    without: 'The agent does not start.',
  },
  'acorn-jsx': {
    tier: 'required',
    why: 'Teaches acorn JSX, so .jsx files can be indexed too.',
    without: 'The agent does not start.',
  },
  'acorn-walk': {
    tier: 'required',
    why: 'Walks the parsed tree to find definitions and every reference to them.',
    without: 'The agent does not start.',
  },
  unpdf: {
    tier: 'optional',
    why: 'Extracts the text of a PDF so read_file can hand it to the model as Markdown, page by page.',
    without: 'read_file fails on PDFs. Word, PowerPoint and text files still read.',
  },
  chokidar: {
    tier: 'optional',
    why: 'Notices files changed outside the agent, on Linux. macOS and Windows use Node\'s own fs.watch instead.',
    without: 'On Linux, edits made in another window are not reported to the agent. Elsewhere, nothing.',
  },
  '@types/react': {
    tier: 'dev',
    why: 'Type hints for React in an editor. Nothing runs it.',
    without: 'Nothing at run time.',
  },
  esbuild: {
    tier: 'build',
    why: 'Bundles extension/src/background into service-worker.js, the file Chrome loads.',
    without: '`npm run build --workspace=extension` fails. The committed bundle still works.',
  },
  jsdom: {
    tier: 'test',
    why: 'A browser DOM in Node, so the extension\'s content-script tests run against a Gemini-shaped page.',
    without: 'The extension tests fail. The agent is unaffected.',
  },
};

/**
 * Packages declared by more than one manifest with a different job in each.
 * `marked` is a run-time dependency of the server and a test dependency of the
 * extension (the Markdown round-trip test); the server's entry above wins for
 * the server, this one for the extension.
 */
const PER_WORKSPACE = {
  extension: {
    marked: {
      tier: 'test',
      why: 'The extension\'s Markdown round-trip test renders with it.',
      without: 'That test fails. The agent is unaffected.',
    },
  },
};

/** Tools outside npm. `need` is a tier from above. */
export const TOOLS = [
  {
    name: 'node', need: 'required', args: ['--version'],
    why: 'Runs everything.',
    without: 'Nothing runs.', short: 'nothing runs',
    manual: { all: 'https://nodejs.org' },
  },
  {
    name: 'npm', need: 'required', args: ['--version'],
    why: 'Installs the packages above, and `/update` runs it after a pull.',
    without: 'Packages cannot be installed or updated.', short: 'packages cannot be installed',
    manual: { all: 'it comes with Node: https://nodejs.org' },
  },
  {
    name: 'git', need: 'optional', args: ['--version'],
    why: '`/update` pulls the agent\'s own repo with it.',
    without: '`/update` cannot check for or pull updates.', short: '/update cannot run',
    install: { darwin: ['brew', ['install', 'git']], win32: ['winget', ['install', '--id', 'Git.Git', '-e']] },
    manual: { darwin: 'xcode-select --install', linux: 'sudo apt install git', win32: 'https://git-scm.com' },
  },
  {
    name: 'rg', need: 'optional', args: ['--version'],
    why: 'ripgrep: grep_search uses it when present.',
    without: 'grep_search falls back to a slower scan in Node.', short: 'search is slower',
    install: { darwin: ['brew', ['install', 'ripgrep']], win32: ['winget', ['install', '--id', 'BurntSushi.ripgrep.MSVC', '-e']] },
    manual: { darwin: 'https://brew.sh, then brew install ripgrep', linux: 'sudo apt install ripgrep', win32: 'https://github.com/BurntSushi/ripgrep' },
  },
  {
    name: 'textutil', need: 'optional', platform: 'darwin', path: '/usr/bin/textutil',
    why: 'macOS\'s converter: read_file uses it for .doc, .rtf and .odt.',
    without: 'Those three are refused with "save it as .docx or .pdf".', short: '.doc, .rtf, .odt refused',
  },
];

/** The entry for a package as `workspace` uses it. */
export function packageInfo(name, workspace = 'server') {
  return PER_WORKSPACE[workspace]?.[name] || PACKAGES[name] || null;
}

/* ------------------------------------------------------------------ semver */

function parseVersion(v) {
  const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-([0-9A-Za-z.-]+))?/.exec(String(v ?? '').trim());
  if (!m) return null;
  const n = (s) => (s === undefined || s === 'x' || s === '*' ? 0 : Number(s));
  return { major: n(m[1]), minor: n(m[2]), patch: n(m[3]), pre: m[4] || '' };
}

export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  // A release outranks its own prerelease.
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * Whether `version` satisfies `range`, for the range shapes this repo's
 * manifests use: `^`, `~`, exact, and the comparison operators. Anything
 * richer (`||`, hyphen ranges, tags, URLs) answers `null` — not judged — so an
 * odd range is never reported as a wrong install.
 */
export function satisfies(version, range) {
  const r = String(range ?? '').trim();
  if (r === '' || r === '*' || r === 'latest') return true;
  if (/\|\||\s-\s|\s/.test(r)) return null;
  const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(r);
  const want = parseVersion(m[2]);
  const have = parseVersion(version);
  if (!want || !have) return null;
  const c = compareVersions(version, m[2]);
  switch (m[1] || '=') {
    case '=': return c === 0;
    case '>=': return c >= 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    case '<': return c < 0;
    case '~': return c >= 0 && have.major === want.major && have.minor === want.minor;
    case '^':
      if (c < 0) return false;
      if (want.major > 0) return have.major === want.major;
      if (want.minor > 0) return have.major === 0 && have.minor === want.minor;
      return have.major === 0 && have.minor === 0 && have.patch === want.patch;
    default: return null;
  }
}

/* --------------------------------------------------------------- manifests */

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Every manifest's declared packages: the root, its npm workspaces, and the
 * VS Code companion, which is not a workspace but ships from this repo.
 */
export function readManifests(root = REPO_ROOT) {
  const rootPkg = readJson(path.join(root, 'package.json')) || {};
  const dirs = ['.', ...(rootPkg.workspaces || []), 'vscode-companion'];
  const out = [];
  for (const rel of [...new Set(dirs)]) {
    const dir = path.join(root, rel);
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg) continue;
    const workspace = rel === '.' ? 'root' : rel;
    const declared = [
      ...Object.entries(pkg.dependencies || {}).map(([name, range]) => ({ name, range, dev: false })),
      ...Object.entries(pkg.devDependencies || {}).map(([name, range]) => ({ name, range, dev: true })),
    ];
    if (declared.length) out.push({ workspace, dir, declared });
  }
  return out;
}

/**
 * The version installed where `dir` would resolve `name`: its own
 * `node_modules`, then each parent's, up to `root` — npm hoists to the root,
 * and a workspace keeps its own copy only when versions conflict. Read from
 * the package's `package.json` directly, so a package whose `exports` hides it
 * is still found.
 */
export function installedVersion(name, dir, root = REPO_ROOT) {
  let at = path.resolve(dir);
  const stop = path.resolve(root);
  for (;;) {
    const pkg = readJson(path.join(at, 'node_modules', name, 'package.json'));
    if (pkg?.version) return { version: pkg.version, location: path.join(at, 'node_modules', name) };
    if (at === stop) return null;
    const up = path.dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/* ----------------------------------------------------------------- checks */

/**
 * Offline: every declared package, installed or not, the right version or not.
 * Fast enough for startup — a handful of small file reads.
 */
export function checkInstalled(root = REPO_ROOT) {
  const groups = [];
  for (const { workspace, dir, declared } of readManifests(root)) {
    const packages = declared.map(({ name, range, dev }) => {
      const info = packageInfo(name, workspace);
      const tier = info?.tier || (dev ? 'dev' : 'required');
      const found = installedVersion(name, dir, root);
      const ok = found ? satisfies(found.version, range) : false;
      return {
        name, range, tier,
        why: info?.why || null,
        without: info?.without || null,
        installed: found?.version || null,
        location: found?.location || null,
        status: !found ? 'missing' : ok === false ? 'mismatch' : 'ok',
      };
    });
    packages.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.name.localeCompare(b.name));
    groups.push({ workspace, dir, packages });
  }
  return groups;
}

/** What needs fixing: missing or wrong-version packages that something uses. */
export function problems(groups) {
  return groups.flatMap((g) => g.packages
    .filter((p) => p.status !== 'ok' && p.tier !== 'unused' && p.tier !== 'dev')
    .map((p) => ({ ...p, workspace: g.workspace })));
}

/**
 * One line for the startup row, or null when everything that matters is there.
 * Short, and the names and the command first: a live row is truncated from the
 * right, so whatever must survive a narrow terminal goes on the left.
 */
export function startupWarning(groups) {
  const bad = problems(groups).filter((p) => p.tier === 'required' || p.tier === 'optional');
  if (bad.length === 0) return null;
  const names = bad.slice(0, 3).map((p) => p.name).join(', ') + (bad.length > 3 ? ` +${bad.length - 3}` : '');
  const what = bad.every((p) => p.status === 'missing') ? 'not installed' : 'not installed or the wrong version';
  return `✗ ${names} ${what} · /doctor fix installs, /doctor says why it matters`;
}

function run(cmd, args, { cwd, timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      cwd, timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8',
      // npm is a .cmd shim on Windows, which execFile cannot start without a shell.
      shell: process.platform === 'win32',
      windowsHide: true,
    }, (error, stdout, stderr) => resolve({ error, stdout: stdout || '', stderr: stderr || '' }));
  });
}

/** The tools outside npm, each with a version or a reason it has none. */
export async function checkTools({ platform = process.platform, runner = run, root = REPO_ROOT } = {}) {
  const engines = readJson(path.join(root, 'package.json'))?.engines?.node || null;
  return Promise.all(TOOLS.map(async (t) => {
    const row = {
      name: t.name, tier: t.need, why: t.why, without: t.without, short: t.short, version: null, status: 'ok', note: null,
      // How the menu offers to install it here: a command it can run, or one
      // it can only name (sudo wants a password the menu cannot ask for).
      install: t.install?.[platform] || null,
      manual: t.manual?.[platform] || t.manual?.all || null,
    };
    if (t.platform && t.platform !== platform) {
      return { ...row, status: 'n/a', note: 'macOS only' };
    }
    if (t.name === 'node') {
      const ok = engines ? satisfies(process.versions.node, engines) : true;
      return { ...row, version: process.versions.node, range: engines, status: ok === false ? 'mismatch' : 'ok' };
    }
    if (t.path) return { ...row, status: existsSync(t.path) ? 'ok' : 'missing', version: existsSync(t.path) ? 'present' : null };
    const r = await runner(t.name, t.args);
    if (r.error) return { ...row, status: 'missing' };
    const v = /(\d+\.\d+(?:\.\d+)?)/.exec(r.stdout)?.[1] || r.stdout.trim().split('\n')[0];
    return { ...row, version: v };
  }));
}

/**
 * The newest version of each declared package, from `npm outdated`.
 *
 * It lists only packages that are behind (and missing ones), so absence from
 * its output means "installed is latest". It exits 1 whenever anything is
 * behind, which is the normal case — so the exit code is ignored and the JSON
 * is the answer. When there is no JSON, the first line of npm's error is the
 * reason: on a work laptop that is typically an auth or proxy error from the
 * company registry, and saying so beats a blank column.
 *
 * @returns {Promise<{ok: true, latest: Map<string, string>} | {ok: false, reason: string}>}
 */
export async function lookupLatest({ root = REPO_ROOT, runner = run, timeout = 25_000 } = {}) {
  const r = await runner('npm', ['outdated', '--json', '--workspaces', '--include-workspace-root'], { cwd: root, timeout });
  let parsed = null;
  // Empty output with an error is a failure, not "nothing is behind": parsing
  // it as `{}` reported a registry that refused auth as everything up to date.
  const body = r.stdout.trim() || (r.error ? '' : '{}');
  try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || parsed.error) {
    const reason = parsed?.error?.summary
      || r.stderr.split('\n').map((l) => l.trim()).find(Boolean)
      || (r.error?.killed ? `no answer in ${Math.round(timeout / 1000)}s` : r.error?.message)
      || 'no answer';
    return { ok: false, reason: reason.replace(/^npm (ERR!|error)\s*/i, '') };
  }
  const latest = new Map();
  for (const [name, entry] of Object.entries(parsed)) {
    const first = Array.isArray(entry) ? entry[0] : entry;
    if (first?.latest) latest.set(name, first.latest);
  }
  return { ok: true, latest };
}

/**
 * The whole report. `latest: false` skips the registry — instant and offline.
 */
export async function checkHealth({ root = REPO_ROOT, latest = true, runner = run, platform = process.platform } = {}) {
  const groups = checkInstalled(root);
  const [tools, registry] = await Promise.all([
    checkTools({ platform, runner, root }),
    latest ? lookupLatest({ root, runner }) : Promise.resolve(null),
  ]);
  return applyLatest({ root, groups, tools, registry: null }, registry);
}

/**
 * The registry's answer laid over a report, as a new report. Split out so the
 * menu can open on what is installed and fill this in a second later.
 * Absent from `npm outdated` means installed is latest.
 */
export function applyLatest(report, registry) {
  if (!registry?.ok) return { ...report, registry };
  const groups = report.groups.map((g) => ({
    ...g,
    packages: g.packages.map((p) => ({ ...p, latest: registry.latest.get(p.name) || p.installed || null })),
  }));
  return { ...report, groups, registry };
}

/* ----------------------------------------------------------------- output */

const MARK = { ok: '✔', missing: '✗', mismatch: '✗', 'n/a': '·' };

/** A missing optional tool degrades one feature; it is not a fault. */
const toolMark = (t) => (t.status === 'missing' && t.tier !== 'required' ? '·' : MARK[t.status]);

function pad(s, n) {
  const str = String(s ?? '');
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

const firstSentence = (text) => (String(text || '').match(/^.*?[.!?](?=\s|$)/) || [String(text || '')])[0];

function latestNote(p) {
  if (!p.latest || !p.installed) return '';
  return compareVersions(p.installed, p.latest) < 0 ? `latest ${p.latest}` : 'latest';
}

/** A quiet tier (dev, unused) that is fine is noise in the table. */
function worthAListing(p) {
  return p.status !== 'ok' || !['dev'].includes(p.tier);
}

/**
 * The report as plain lines — the CLI prints them, `/doctor` puts them in a
 * code block. No colour here; the caller decides.
 *
 * Grouped by workspace, then by tier, because "what does it mean that this is
 * missing" is the tier, and the tier heading says it once instead of on every
 * row. A row that is not fine says what breaks, so the fix and the stakes are
 * on the same screen.
 */
export function formatReport(report, { width = Infinity } = {}) {
  const lines = [];
  const nameWidth = Math.max(10, ...report.groups.flatMap((g) => g.packages.map((p) => p.name.length)));
  const W = { name: nameWidth + 2, have: 10, want: 10 };

  for (const g of report.groups) {
    lines.push(`${g.workspace === 'root' ? 'repo root' : g.workspace}/package.json`);
    let tier = null;
    for (const p of g.packages.filter(worthAListing)) {
      if (p.tier !== tier) {
        tier = p.tier;
        lines.push(`  ${tier} — ${TIERS[tier]}`);
      }
      const have = p.status === 'missing' ? 'missing' : p.installed;
      // The first sentence only: the table has to fit a terminal, and
      // `/doctor <package>` has the rest.
      const breaks = firstSentence(p.without);
      const tail = p.status === 'ok' ? latestNote(p)
        : p.status === 'missing' ? breaks
          : `wants ${p.range} · ${breaks}`;
      lines.push(`    ${MARK[p.status]} ${pad(p.name, W.name)}${pad(have, W.have)}${pad(p.range, W.want)}${tail}`.trimEnd());
    }
    lines.push('');
  }

  lines.push('tools');
  for (const t of report.tools) {
    const have = t.status === 'missing' ? 'missing' : t.status === 'n/a' ? '—' : t.version;
    const tail = t.status === 'missing' ? (t.short || firstSentence(t.without))
      : t.status === 'mismatch' ? `needs ${t.range}`
        : t.status === 'n/a' ? t.note : '';
    lines.push(`    ${toolMark(t)} ${pad(t.name, W.name)}${pad(have, W.have)}${pad(t.tier, W.want)}${tail}`.trimEnd());
  }
  lines.push('');

  // One line, not a paragraph: what the registry said, or why it said nothing.
  const reg = report.registry;
  if (reg && !reg.ok) lines.push(`latest unknown: ${reg.reason}`);
  if (reg?.ok) {
    const n = newerCount(report);
    lines.push(n ? `${n} with a newer release` : 'all on their latest release');
  }
  while (lines.at(-1) === '') lines.pop();
  // A wrapped row lands at column 0 and reads as a new entry; cut it instead.
  return lines.map((l) => clip(l, width));
}

/** Distinct packages with a release newer than the one installed. */
export function newerCount(report) {
  const behind = report.groups.flatMap((g) => g.packages)
    .filter((p) => p.installed && p.latest && compareVersions(p.installed, p.latest) < 0);
  return new Set(behind.map((p) => p.name)).size;
}

/** Cut to `width` columns with an ellipsis; a no-op without a width. */
export function clip(text, width = Infinity) {
  const s = String(text ?? '');
  return Number.isFinite(width) && s.length > width ? `${s.slice(0, Math.max(1, width - 1))}…` : s;
}

/** The one-line verdict, with the command that fixes it. */
export function summaryLine(report) {
  const bad = problems(report.groups);
  const tools = report.tools.filter((t) => t.tier === 'required' && t.status !== 'ok' && t.status !== 'n/a');
  if (bad.length === 0 && tools.length === 0) return '✔ Everything the agent needs is installed.';
  const parts = [];
  const missing = bad.filter((p) => p.status === 'missing').length;
  const wrong = bad.filter((p) => p.status === 'mismatch').length;
  if (missing) parts.push(`${missing} missing`);
  if (wrong) parts.push(`${wrong} the wrong version`);
  if (tools.length) parts.push(`${tools.map((t) => t.name).join(', ')} not usable`);
  const fix = bad.length ? ` · run \`npm install\` in ${report.root}` : '';
  return `✗ ${parts.join(', ')}${fix}`;
}

/**
 * Everything about one package: why it is here, what breaks without it, the
 * versions, and the files that import it — the last one counted from the
 * source, so "why do we use this" is answered by the code as well as the prose.
 */
export function describePackage(name, report, { importers = [] } = {}) {
  const rows = report.groups.flatMap((g) => g.packages.filter((p) => p.name === name).map((p) => ({ ...p, workspace: g.workspace })));
  const tool = report.tools.find((t) => t.name === name);
  if (rows.length === 0 && !tool) return null;
  const lines = [];
  if (tool) {
    lines.push(`${name} · ${tool.tier} tool — ${TIERS[tool.tier]}`);
    lines.push(`Why: ${tool.why}`);
    lines.push(`Without it: ${tool.without}`);
    lines.push(`Installed: ${tool.status === 'missing' ? 'no' : tool.status === 'n/a' ? tool.note : tool.version}`);
    return lines;
  }
  for (const p of rows) {
    lines.push(`${name} · ${p.tier} in ${p.workspace} — ${TIERS[p.tier]}`);
    lines.push(`Why: ${p.why || 'no reason recorded — add one to PACKAGES in server/src/core/doctor.js'}`);
    if (p.without) lines.push(`Without it: ${p.without}`);
    lines.push(`Wanted: ${p.range} · installed: ${p.installed || 'no'}${p.status === 'mismatch' ? ' (does not satisfy the range)' : ''}`
      + (p.latest ? ` · latest: ${p.latest}` : ''));
    lines.push('');
  }
  if (importers.length) {
    lines.push(`Imported by ${importers.length} file${importers.length === 1 ? '' : 's'}:`);
    for (const f of importers.slice(0, 8)) lines.push(`  ${f}`);
    if (importers.length > 8) lines.push(`  … +${importers.length - 8} more`);
  } else if (rows.some((p) => p.tier === 'required' || p.tier === 'optional')) {
    lines.push('Imported by no file under server/src.');
  }
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

/** The source files under `dir` that import `name`, statically or lazily. */
export function findImporters(name, dir = path.join(REPO_ROOT, 'server', 'src'), readDir, readText) {
  const list = readDir || ((d) => {
    try { return readdirSync(d, { withFileTypes: true }); } catch { return []; }
  });
  const read = readText || ((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } });
  const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`(?:from\\s+|import\\s*\\(\\s*)['"]${esc}(?:/[^'"]*)?['"]`);
  const out = [];
  (function walk(d) {
    for (const e of list(d)) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?jsx?|cjs)$/.test(e.name) && re.test(read(p))) out.push(path.relative(path.join(dir, '..'), p));
    }
  })(dir);
  return out.sort();
}

/**
 * `agent doctor [package] [--offline]`, run by the bin before tsx — so it
 * answers on the machine whose install is broken. Exit 1 when something the
 * agent needs is missing, so a setup script can gate on it.
 */
export async function runDoctorCli(argv, { out = process.stdout, root = REPO_ROOT } = {}) {
  const offline = argv.includes('--offline');
  const name = argv.find((a) => !a.startsWith('-') && a !== 'doctor');
  const tty = Boolean(out.isTTY) && !process.env.NO_COLOR;
  const paint = (line) => (!tty ? line
    : line.replace(/^(\s*)✔/, '$1\x1b[32m✔\x1b[0m').replace(/^(\s*)✗/, '$1\x1b[31m✗\x1b[0m')
      .replace(/^(  )(\w+ — .*)$/, '$1\x1b[2m$2\x1b[0m'));
  if (!offline) out.write('Checking installed packages and asking npm for the latest versions…\n\n');
  const report = await checkHealth({ root, latest: !offline });
  if (name) {
    const lines = describePackage(name, report, { importers: findImporters(name) });
    out.write((lines ? lines.join('\n') : `${name} is not a package or tool this repo declares.`) + '\n');
    return lines ? 0 : 1;
  }
  const width = out.columns || Infinity;
  out.write(formatReport(report, { width }).map(paint).join('\n') + '\n\n' + paint(summaryLine(report)) + '\n');
  out.write(clip('agent doctor <package>: why it is used', width) + '\n');
  return problems(report.groups).some((p) => p.tier === 'required') ? 1 : 0;
}

/* ------------------------------------------------------- versions, install */

/**
 * Every published version of `name`, newest first — from the user's registry,
 * through npm, for the same reason as `lookupLatest`. Prereleases are left out
 * unless one is installed: a version list is for choosing a release.
 *
 * @returns {Promise<{ok: true, versions: string[]} | {ok: false, reason: string}>}
 */
export async function listVersions(name, { root = REPO_ROOT, runner = run, timeout = 25_000, installed = null } = {}) {
  const r = await runner('npm', ['view', name, 'versions', '--json'], { cwd: root, timeout });
  let parsed = null;
  try { parsed = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { parsed = null; }
  if (!parsed || parsed.error) {
    const reason = parsed?.error?.summary
      || r.stderr.split('\n').map((l) => l.trim()).find(Boolean)
      || (r.error?.killed ? `no answer in ${Math.round(timeout / 1000)}s` : r.error?.message) || 'no answer';
    return { ok: false, reason: reason.replace(/^npm (ERR!|error)\s*/i, '') };
  }
  const all = Array.isArray(parsed) ? parsed : [parsed];
  const keepPre = Boolean(parseVersion(installed)?.pre);
  const versions = all.filter((v) => keepPre || !parseVersion(v)?.pre)
    .sort((a, b) => compareVersions(b, a));
  return { ok: true, versions };
}

/**
 * What a failed command said, for the menu's "Show the error" page: stderr
 * then stdout, colour codes stripped, the last `max` lines. Hidden until
 * asked for — the page itself says one line.
 */
export function errorOutput({ stdout = '', stderr = '', error = null } = {}, max = 200) {
  const text = [stderr, stdout].filter((x) => x && x.trim()).join('\n') || error?.message || '';
  // eslint-disable-next-line no-control-regex
  const lines = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.slice(-max);
}

/**
 * Install a tool npm does not manage, with the platform's package manager —
 * Homebrew on macOS, winget on Windows. Judged by running the tool afterwards.
 * A package manager that is not there is said in words, with the way to do it
 * by hand.
 *
 * @returns {Promise<{ok: boolean, version?: string|null, error?: string, output?: string[]}>}
 */
export async function installTool(tool, { runner = run, timeout = 600_000 } = {}) {
  if (!tool?.install) return { ok: false, error: `no installer here — ${tool?.manual || 'install it by hand'}` };
  const [cmd, args] = tool.install;
  const r = await runner(cmd, args, { timeout });
  const spec = TOOLS.find((t) => t.name === tool.name);
  const after = await runner(tool.name, spec?.args || ['--version']);
  if (!after.error) return { ok: true, version: after.stdout.match(/\d+\.\d+(\.\d+)?/)?.[0] || 'present' };
  if (r.error?.code === 'ENOENT') {
    return { ok: false, error: `${cmd} is not installed — ${tool.manual || 'install it by hand'}`, output: [] };
  }
  const output = errorOutput(r);
  const line = output.find((l) => /error|fail/i.test(l)) || output[output.length - 1]
    || (r.error?.killed ? `no answer in ${Math.round(timeout / 1000)}s` : r.error?.message) || `${cmd} finished, and ${tool.name} still does not run`;
  return { ok: false, error: line.replace(/^(Error|npm (ERR!|error)):?\s*/i, ''), output };
}

/**
 * Take a package out of a workspace's `package.json` and `node_modules` —
 * offered only for the `unused` tier, where nothing imports it. Judged by the
 * manifest afterwards, not by npm's exit code.
 *
 * @returns {Promise<{ok: boolean, error?: string, output?: string[]}>}
 */
export async function uninstallPackage({ name, workspace = 'server' }, { root = REPO_ROOT, runner = run, timeout = 300_000 } = {}) {
  const args = ['uninstall', name];
  if (workspace && workspace !== 'root') args.push(`--workspace=${workspace}`);
  const r = await runner('npm', args, { cwd: root, timeout });
  const manifest = readJson(path.join(workspace && workspace !== 'root' ? path.join(root, workspace) : root, 'package.json')) || {};
  const still = Boolean(manifest.dependencies?.[name] || manifest.devDependencies?.[name]);
  if (!still) return { ok: true };
  const output = errorOutput(r);
  return { ok: false, error: output.find((l) => /error|ERR!/i.test(l))?.replace(/^npm (ERR!|error)\s*/i, '') || `${name} is still in package.json`, output };
}

/**
 * The `npm install` arguments that put `version` into `workspace` while keeping
 * the range's style: `^` stays `^`, `~` stays `~`, an exact pin stays exact.
 * `unpdf` is pinned exactly on purpose, and an update must not quietly turn
 * that into a caret.
 */
export function installArgs({ name, version, workspace = 'server', range = '' }) {
  const args = ['install', `${name}@${version}`];
  if (workspace && workspace !== 'root' && workspace !== 'vscode-companion') args.push(`--workspace=${workspace}`);
  const style = String(range).trim();
  if (style.startsWith('~')) args.push('--save-prefix=~');
  else if (!style.startsWith('^') && /^\d/.test(style)) args.push('--save-exact');
  return args;
}

/**
 * Install one package at one version. It rewrites `package.json` and the
 * lockfile — a change to the agent, which is why it is only ever run from a
 * choice someone made in the menu. Output is captured, never inherited: Ink
 * owns the terminal.
 *
 * @returns {Promise<{ok: boolean, installed?: string|null, error?: string}>}
 */
export async function installPackage(spec, { root = REPO_ROOT, runner = run, timeout = 300_000 } = {}) {
  const r = await runner('npm', installArgs(spec), { cwd: root, timeout });
  const dir = spec.workspace && spec.workspace !== 'root' ? path.join(root, spec.workspace) : root;
  const after = installedVersion(spec.name, dir, root)?.version || null;
  if (r.error && after !== spec.version) {
    const line = (r.stderr || r.error.message || '').split('\n').map((l) => l.trim()).filter(Boolean)
      .find((l) => /error|ERR!/i.test(l)) || r.error.message;
    return { ok: false, installed: after, error: String(line).replace(/^npm (ERR!|error)\s*/i, ''), output: errorOutput(r) };
  }
  return { ok: after === spec.version, installed: after, ...(after === spec.version ? {} : { error: `npm finished, and ${after || 'nothing'} is installed` }) };
}
