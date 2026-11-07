/**
 * Which of a repo's MCP servers this person has allowed (v9.6).
 *
 * A `.mcp.json` arrives with a clone, so nothing in it may start a process or be
 * sent a header until the person who runs the agent says so. The answer is kept
 * in `~/.agent/settings.json`, never in the repo: a checkout must not arrive
 * already approved.
 *
 * Keyed on the folder and the entry's whole fingerprint. The folder, because
 * `./server.sh` is a different program in another checkout. The whole entry and
 * not only its command, because `"env": {"NODE_OPTIONS": "--require ./x.js"}` or a
 * changed `url` is a different thing to have agreed to. So any edit asks again.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadUserSettings, saveUserSettings } from '../../core/workspace/user-settings.js';

function folderKey(workspace) {
  try {
    return realpathSync(workspace);
  } catch {
    return resolve(workspace);
  }
}

/** What this person allowed for that name here, or null. */
export function allowedFingerprint(workspace, name, settings = loadUserSettings()) {
  return settings?.mcpRepoApprovals?.[folderKey(workspace)]?.[name] ?? null;
}

export function allowRepoServer(workspace, name, fingerprint) {
  const all = loadUserSettings().mcpRepoApprovals || {};
  const key = folderKey(workspace);
  return saveUserSettings({ mcpRepoApprovals: { ...all, [key]: { ...all[key], [name]: fingerprint } } });
}

export function forgetRepoServer(workspace, name) {
  const all = loadUserSettings().mcpRepoApprovals || {};
  const key = folderKey(workspace);
  const { [name]: _gone, ...rest } = all[key] || {};
  return saveUserSettings({ mcpRepoApprovals: { ...all, [key]: rest } });
}
