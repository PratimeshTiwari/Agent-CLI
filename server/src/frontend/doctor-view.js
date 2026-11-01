/**
 * The `/doctor` menu (v5.30): the rows, the package page and its actions, as
 * plain values, so the row arithmetic is tested without a terminal.
 *
 * Asked 2026-10-27: *"health should be a menu where the user can up and down
 * arrow … on a package, where info is shown and an option to update to latest
 * or downgrade to a specified version, and back should take to the health
 * home instead of the main home"*. Three views of one menu: `home` (every
 * package and tool), `package` (why it is here, versions, actions) and
 * `versions` (every release, to pick one). Esc walks back one view at a time.
 *
 * No mouse: the app never turns on mouse tracking (it would take the
 * terminal's own scroll and copy), so "click" is ↑↓ and enter.
 */

import { TIERS, withoutBeyondTier, firstSentence, compareVersions, satisfies, newerCount, problems, clip } from '../backend/core/doctor.js';
import { wrapLines } from './panel.js';

const MARK = { ok: '✔', missing: '✗', mismatch: '✗', 'n/a': '·', removed: '·' };

/** Not ok, and not by choice: an uninstalled optional package is neither red nor counted. */
const isFault = (p) => p.status !== 'ok' && p.status !== 'removed';

/**
 * The list's tabs (asked 2026-10-27: "maybe create tabs like required,
 * optional, all"). `All` leaves out a fine `dev` package, as the report does;
 * `Other` is where the build, test, dev and unused ones are listed in full.
 */
export const HEALTH_TABS = [
  { id: 'all', label: 'All' },
  { id: 'required', label: 'Required' },
  { id: 'optional', label: 'Optional' },
  { id: 'other', label: 'Other' },
  { id: 'tools', label: 'Tools' },
];

const inTab = (tab, p) => (tab === 'all' ? p.status !== 'ok' || p.tier !== 'dev'
  : tab === 'required' || tab === 'optional' ? p.tier === tab
    : tab === 'other' ? p.tier !== 'required' && p.tier !== 'optional'
      : false);

/** Every package worth a row on `tab`. */
function listed(report, tab = 'all') {
  return report.groups.flatMap((g) => g.packages
    .filter((p) => inTab(tab, p))
    .map((p) => ({ ...p, workspace: g.workspace })));
}

/** The tab `step` away from `tab`, wrapping. */
export function nextHealthTab(tab, step) {
  const at = Math.max(0, HEALTH_TABS.findIndex((t) => t.id === tab));
  return HEALTH_TABS[(at + step + HEALTH_TABS.length) % HEALTH_TABS.length].id;
}

/** Rows per tab, for the tab bar; a tab holding a fault says so. */
export function tabCounts(report) {
  const out = {};
  for (const { id } of HEALTH_TABS) {
    const rows = id === 'tools' ? report.tools : listed(report, id);
    const bad = id === 'tools'
      ? rows.filter((t) => t.status === 'missing' && t.tier === 'required').length
      : rows.filter(isFault).length;
    out[id] = { count: id === 'all' ? rows.length + report.tools.length : rows.length, bad };
  }
  return out;
}

function latestNote(p, registry) {
  if (!registry) return 'latest …';
  if (!registry.ok || !p.latest || !p.installed) return '';
  // Only what is newer: a column reading `latest` on every row says nothing.
  return compareVersions(p.installed, p.latest) < 0 ? `latest ${p.latest}` : '';
}

/**
 * The home list. Problems lead with a "fix" row; each package names its tier
 * in the second column, because required-or-optional is what decides whether
 * a ✗ matters.
 */
export function homeItems(report, { T = {}, tab = 'all', job = null } = {}) {
  const items = [];
  if (job?.state === 'failed' && job.output?.length) {
    items.push({ key: 'error', label: 'Show the error', detail: `what ${job.cmd || 'npm'} printed`, value: { kind: 'error' }, colour: T.danger, tone: 'danger' });
  }
  if (problems(report.groups).length && tab !== 'tools') {
    items.push({
      key: 'fix', label: 'Install what is missing', detail: 'npm install', value: { kind: 'fix' }, colour: T.attention,
    });
  }
  // Owner, 2026-10-28: "remove the unused packages" — all of them, one choice per workspace.
  if (tab === 'all' || tab === 'other') {
    for (const g of report.groups) {
      const names = g.packages.filter((p) => p.tier === 'unused' && p.installed).map((p) => p.name);
      if (!names.length) continue;
      items.push({
        key: `remove-unused:${g.workspace}`, label: 'Remove unused',
        detail: `npm uninstall ${names.join(' ')}${g.workspace === 'server' ? '' : ` · ${g.workspace}`}`,
        value: { kind: 'remove-unused', workspace: g.workspace, names }, colour: T.attention,
      });
    }
  }
  const tools = tab === 'all' || tab === 'tools' ? report.tools : [];
  const width = Math.max(10, ...listed(report, tab).map((p) => p.name.length), ...tools.map((t) => t.name.length));
  for (const p of listed(report, tab)) {
    const bad = isFault(p);
    const removed = p.status === 'removed';
    const have = p.status === 'missing' ? 'missing' : removed ? 'removed' : p.installed;
    const where = p.workspace === 'server' ? '' : ` · ${p.workspace}`;
    items.push({
      key: `${p.workspace}:${p.name}`,
      label: `${MARK[p.status]} ${p.name.padEnd(width)}`,
      detail: `${String(have).padEnd(9)} ${`${p.tier}${where}`.padEnd(18)} ${bad ? '' : removed ? 'enter to install it' : latestNote(p, report.registry)}`.trimEnd(),
      value: { kind: 'package', name: p.name, workspace: p.workspace },
      colour: bad ? T.danger : removed ? T.muted : undefined,
      tone: bad ? 'danger' : undefined,
    });
  }
  for (const t of tools) {
    const missing = t.status === 'missing';
    const required = t.tier === 'required';
    const have = missing ? 'missing' : t.status === 'n/a' ? '—' : t.version;
    items.push({
      key: `tool:${t.name}`,
      label: `${missing && !required ? '·' : MARK[t.status]} ${t.name.padEnd(width)}`,
      detail: `${String(have).padEnd(9)} ${`${t.tier} tool`.padEnd(18)} ${missing ? t.short || '' : t.via ? `from ${t.via}` : ''}`.trimEnd(),
      value: { kind: 'tool', name: t.name },
      colour: missing && required ? T.danger : undefined,
      tone: missing ? (required ? 'danger' : 'muted') : undefined,
    });
  }
  return items;
}

/** Where the cursor starts: the first thing that is wrong, else the top. */
export function homeCursor(items) {
  const at = items.findIndex((it) => it.tone === 'danger' || it.key === 'fix');
  return Math.max(0, at);
}

/** The title's status: the verdict, then what the registry said. */
export function homeStatus(report) {
  const bad = problems(report.groups);
  const verdict = bad.length ? `✗ ${bad.length} to fix` : '✔ all installed';
  const reg = report.registry;
  const latest = !reg ? 'asking npm for the latest…'
    : !reg.ok ? 'latest unknown'
      : newerCount(report) ? `${newerCount(report)} with a newer release` : 'all on their latest';
  return `${verdict} · ${latest}`;
}

/** The entry a `package` or `versions` view is about, looked up fresh in the report. */
export function findEntry(report, value) {
  if (!value) return null;
  if (value.kind === 'tool') {
    const t = report.tools.find((x) => x.name === value.name);
    return t ? { ...t, kind: 'tool' } : null;
  }
  const g = report.groups.find((x) => x.workspace === value.workspace);
  const p = g?.packages.find((x) => x.name === value.name);
  return p ? { ...p, workspace: g.workspace, kind: 'package' } : null;
}

/**
 * The package page's text, fitted to `rows`. It gives way in a fixed order —
 * the importers, then "without it", then the reason shortened to one line —
 * and never drops the versions, which is what the actions under it act on.
 *
 * @returns {string[]}
 */
export function packageLines(entry, { width = 80, rows = 8, importers = [], registry = null } = {}) {
  const w = Math.max(20, width - 2);
  const label = (name) => name.padEnd(12);
  const wrapped = (name, text, max) => wrapLines(String(text || ''), w - 12, max)
    .map((line, i) => `${i ? ' '.repeat(12) : label(name)}${line}`);

  const versions = entry.kind === 'tool'
    ? `${label('Installed')}${entry.status === 'missing' ? 'no' : entry.status === 'n/a' ? entry.note : entry.version}${entry.via ? ` · the copy inside ${entry.via}` : ''}`
      + (entry.status === 'missing' && !entry.install && entry.manual ? ` · install it with ${entry.manual}` : '')
    : `${label('Versions')}installed ${entry.installed || (entry.status === 'removed' ? 'no, uninstalled' : 'no')} · wants ${entry.range}`
      + (entry.latest ? ` · latest ${entry.latest}` : registry && !registry.ok ? ' · latest unknown' : !registry ? ' · latest …' : '');
  const tier = `${label('Tier')}${entry.tier}${entry.kind === 'tool' ? ' tool' : entry.workspace !== 'server' ? ` in ${entry.workspace}` : ''} — ${TIERS[entry.tier] || ''}`;
  const used = importers.length
    ? clip(`${label('Imported by')}${importers.slice(0, 3).join(', ')}${importers.length > 3 ? ` +${importers.length - 3}` : ''}`, w)
    : null;

  for (const [whyMax, withoutMax, withImporters] of [[3, 2, true], [2, 2, true], [2, 1, false], [1, 1, false], [1, 0, false]]) {
    const lines = [
      clip(tier, w),
      ...wrapped('Why', entry.why || 'no reason recorded', whyMax),
      ...(withoutMax && withoutBeyondTier(entry) ? wrapped('Without it', withoutBeyondTier(entry), withoutMax) : []),
      clip(versions, w),
      ...(withImporters && used ? [used] : []),
    ];
    if (lines.length <= rows) return lines;
  }
  return [clip(versions, w)];
}

/**
 * What can be done to a package from its page.
 *
 * Install-what-is-wanted only when it is missing or the wrong version; update
 * only when the registry names something newer; a version list always, which
 * is how a downgrade is chosen. A tool gets none — npm does not install them.
 */
export function packageActions(entry, { job = null } = {}) {
  const out = [];
  // A failed install says one line; what the installer printed is a choice.
  if (job?.state === 'failed' && job.name === entry.name && job.output?.length) {
    out.push({ key: 'error', label: 'Show the error', detail: `${job.output.length} line${job.output.length === 1 ? '' : 's'}`, value: { kind: 'error' }, colour: undefined, tone: 'danger' });
  }
  if (entry.kind === 'tool') {
    if (entry.status === 'missing' && entry.install) {
      const [cmd, args] = entry.install;
      out.push({ key: 'tool', label: `Install ${entry.name}`, detail: [cmd, ...args].join(' '), value: { kind: 'tool-install' } });
    }
    return out;
  }
  if (entry.status === 'removed') {
    out.push({ key: 'reinstall', label: 'Install', detail: `npm install ${entry.name}@${entry.range} · back into ${entry.workspace}/package.json`, value: { kind: 'install', version: entry.range } });
  } else if (entry.status !== 'ok') {
    out.push({ key: 'fix', label: 'Install what package.json wants', detail: `npm install · ${entry.range}`, value: { kind: 'fix' } });
  }
  if (entry.latest && entry.installed && compareVersions(entry.installed, entry.latest) < 0) {
    const leaves = satisfies(entry.latest, entry.range) === false;
    out.push({
      key: 'latest', label: 'Update to latest', value: { kind: 'install', version: entry.latest },
      detail: `${entry.latest}${leaves ? ' · outside the current range' : ''}`,
    });
  }
  if (entry.tier === 'unused') {
    out.push({ key: 'remove', label: 'Remove it', detail: `npm uninstall · out of ${entry.workspace}/package.json`, value: { kind: 'remove' } });
  } else if (entry.tier === 'optional' && entry.installed) {
    // Owner, 2026-10-28: "if something is optional, also give option to install/uninstall".
    out.push({ key: 'remove', label: 'Uninstall', detail: `npm uninstall · ${firstSentence(entry.without || '') || 'out of package.json'}`, value: { kind: 'remove' } });
  }
  out.push({ key: 'versions', label: 'Choose a version…', detail: 'every release, to go up or down', value: { kind: 'versions' } });
  return out;
}

/** One row per release, marked installed / wanted / latest; enter installs it. */
export function versionItems(versions, entry) {
  return versions.map((v) => {
    const notes = [];
    if (v === entry.installed) notes.push('installed');
    if (entry.latest && v === entry.latest) notes.push('latest');
    if (v !== entry.installed && satisfies(v, entry.range)) notes.push('in range');
    return {
      key: v, label: v, value: { kind: 'install', version: v },
      detail: notes.join(' · ') || undefined, current: v === entry.installed,
    };
  });
}

/** The cursor in the version list: the installed one, else the newest. */
export function versionCursor(versions, entry) {
  return Math.max(0, versions.indexOf(entry.installed));
}

/** The line under the package page while an install runs, and after. */
export function jobLine(job) {
  if (!job) return null;
  if (job.state === 'running') {
    if (job.removing) return `◌ Removing ${job.name} — npm uninstall`;
    return job.cmd ? `◌ Installing ${job.name} — ${job.cmd}, this can take a few minutes`
      : job.version ? `◌ Installing ${job.name}@${job.version} — npm install, this can take a minute`
        : '◌ npm install — this can take a minute';
  }
  if (job.state === 'busy') return `! ${job.holder} is still running — try again when it finishes`;
  if (job.text) return job.text;
  if (job.state === 'done') return `✔ ${job.name} ${job.installed} installed · /restart to load it`;
  if (job.state === 'removed') return `✔ ${job.name} removed · /restart to load it`;
  const first = String(job.error || 'it failed').split('\n').map((l) => l.trim()).filter(Boolean);
  const why = first[first.length - 1] || 'it failed';
  return job.name === 'npm install' ? `✗ npm install failed: ${why}` : `✗ ${job.name} did not install: ${why}`;
}

/**
 * The "Show the error" page: the last lines that fit, newest at the bottom
 * where the cause usually is, each cut to the width.
 */
export function errorLines(output, { width = 80, rows = 10 } = {}) {
  const w = Math.max(10, width - 2);
  const room = Math.max(1, rows - 1);
  const shown = output.slice(-room).map((l) => clip(l, w));
  const note = output.length > room ? `the last ${room} of ${output.length} lines` : `${output.length} line${output.length === 1 ? '' : 's'}`;
  return { note, lines: shown };
}
