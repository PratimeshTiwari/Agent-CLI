/**
 * `/update` (v9.5): the rows and the words. Pure, like `chrome-view.js`.
 */
import { isOutdated } from '../../backend/core/install/editors.js';

/** The title row: what the check found. `sub` is shed at short heights, so a fault goes here. */
export function checkStatus(check) {
  if (!check) return 'checking…';
  if (check.reason) return 'could not check';
  if (!check.available) return `up to date${check.version ? ` · ${check.version}` : ''}`;
  return 'update available';
}

function updateDetail(check) {
  const span = check.version && check.latest && check.version !== check.latest ? `${check.version} → ${check.latest}` : '';
  const count = check.releases > 0
    ? `${check.releases} release${check.releases === 1 ? '' : 's'}`
    : `${check.behind} update${check.behind === 1 ? '' : 's'}`;
  return [span, count].filter(Boolean).join(' · ');
}

/** The Editor companion row's right-hand side. */
export function companionDetail(editors, vsix) {
  if (!editors) return 'reading…';
  if (!editors.length) return 'no editor found · choose for the command';
  const old = editors.filter((e) => isOutdated(e, vsix.version));
  if (old.length) return old.map((e) => `${e.name} ${e.version}`).join(' · ') + ` → ${vsix.version}`;
  const have = editors.filter((e) => e.version).length;
  return have ? `${vsix.version} · current in ${have} of ${editors.length}` : `${vsix.version} · not installed yet`;
}

export function homeItems({ check, blocked = [], editors, vsix, pending }) {
  const items = [];
  if (check?.available) {
    items.push({
      label: 'Update',
      value: 'pull',
      detail: blocked.length ? 'uncommitted changes · commit or stash first' : updateDetail(check),
      tone: blocked.length ? 'attention' : undefined,
    });
  }
  if (vsix) {
    const old = editors?.some((e) => isOutdated(e, vsix.version));
    items.push({ label: 'Editor companion', value: 'editors', detail: companionDetail(editors, vsix), tone: old ? 'attention' : undefined });
  }
  if (pending) items.push({ label: 'Dismiss reminder', value: 'dismiss', detail: pending.steps.map((s) => s.what).join(' · ') });
  return items;
}

function editorDetail(editor, version) {
  if (!editor.read) return 'could not read it';
  if (!editor.version) return 'not installed';
  return isOutdated(editor, version) ? `${editor.version} → ${version}` : `${editor.version} · current`;
}

/** What starts ticked: what is behind. Installing somewhere new is a choice to make. */
export const startingPicks = (editors, version) => new Set(editors.filter((e) => isOutdated(e, version)).map((e) => e.id));

export function editorItems(editors, version, picks) {
  return [
    ...editors.map((e) => ({
      label: e.name,
      value: e.id,
      glyph: picks.has(e.id) ? '●' : '○',
      glyphTone: picks.has(e.id) ? 'accent' : undefined,
      detail: editorDetail(e, version),
    })),
    { label: 'Other editor', value: 'other', glyph: ' ', detail: 'show the command' },
  ];
}

export const otherCommand = (vsixPath) => `<editor> --install-extension "${vsixPath}" --force`;

/** What the transcript keeps: one line for what landed, one for each that did not. */
export function installLines(results, version) {
  const done = results.filter((r) => r.ok).map((r) => r.name);
  const failed = results.filter((r) => !r.ok).map((r) => `✗ ${r.name}: ${r.error}`);
  const lines = done.length ? [`✔ Companion ${version} · ${done.join(', ')} · reload ${done.length === 1 ? 'its window' : 'each window'} to start it`] : [];
  return [...lines, ...failed].join('\n');
}
