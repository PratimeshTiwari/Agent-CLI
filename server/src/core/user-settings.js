/**
 * `~/.agent/settings.json`: settings that follow the person, not the repo.
 *
 * Per-repo settings live in `<ws>/.agent/config.json`. A theme is about the
 * terminal you sit at, so it would be wrong there — you would get a different
 * look in every project, and a teammate's choice could arrive with a checkout.
 *
 * Best-effort both ways. A missing or unreadable file reads as `{}`; a failed
 * write is reported and nothing else happens. Unknown keys are preserved on
 * write, the same rule `_saveConfig` follows for the project config.
 */
import fs from 'node:fs';
import path from 'node:path';
import { userSettingsPath } from './paths.js';

export function loadUserSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(userSettingsPath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the file. Returns whether it was written. */
export function saveUserSettings(patch) {
  try {
    const file = userSettingsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const next = { ...loadUserSettings(), ...patch };
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}
