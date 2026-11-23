/**
 * The last model list the browser reported, kept across launches (v9.9.9.4).
 *
 * Owner, 2026-11-23: "on first start, the agent does not load the model names
 * and efforts". The list lives only in memory and is read from a tab, and at
 * launch there is usually no tab — 414 `discover_models` notices in this
 * repo's log say "no tab open yet" — and since v9.9.9.2 exit closes the tab,
 * so the next start never has one. Until the first prompt, `/effort` showed
 * the generic names and offered Max on accounts without it.
 *
 * **For display only.** It is what the slider, settings and panels show until
 * the tab answers; every decision — a switch, a mismatch, a fallback — reads
 * the live list. `selected` is stripped, so a stale tick can never look like a
 * tab disagreeing with the effort. Kept per Chrome profile (the bound install,
 * or `default`), since two accounts offer different models.
 */
import fs from 'fs';
import path from 'path';
import { homeDir } from '../workspace/paths.js';

export const savedModelsPath = () => path.join(homeDir(), 'models.json');

/** A list worth keeping: at least one labelled model that is not a mode. */
function usable(models) {
  return Array.isArray(models) && models.some((m) => m && m.label && !m.isMode);
}

const strip = (models) => models
  .filter((m) => m && m.label)
  .map(({ selected, ...rest }) => rest); // eslint-disable-line no-unused-vars

export function loadSavedModels(key = 'default', { file = savedModelsPath() } = {}) {
  try {
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entry = all?.[key];
    return usable(entry?.models) ? strip(entry.models) : [];
  } catch {
    return []; // none yet, or unreadable: the generic names, as before
  }
}

/** Returns the stripped list that was saved, or null when nothing was. */
export function saveModels(models, key = 'default', { file = savedModelsPath(), now = Date.now } = {}) {
  if (!usable(models)) return null;
  const kept = strip(models);
  try {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { all = {}; }
    all[key] = { at: now(), models: kept };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    // Display only: failing to remember costs the generic names next launch.
  }
  return kept;
}
