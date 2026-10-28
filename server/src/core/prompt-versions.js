/**
 * Prompt versions (v5.32): the prompt as a setting, not a single moving target.
 *
 * Asked 2026-10-28: *"we don't know exactly if newer will be better or not, so
 * in settings we will give option like prompt version v1, v2"*. Every prompt
 * change so far replaced the one before, so "is it better?" was argued from
 * prompt sizes and never measured: there was nothing left to compare with.
 *
 * - **v1 is frozen.** `prompt-v1-golden.test.js` hashes every shape the builder
 *   produces under v1; a change to v1's bytes fails the build. It is the
 *   baseline, and a baseline that drifts with every edit compares nothing.
 * - **A newer version is a set of differences, not a copy.** `dir` overrides
 *   prompt files (`prompts/<dir>/<name>.md`, else `prompts/<name>.md`), `flags`
 *   switch builder behaviour, `refreshEvery` is the reminder cadence. A third
 *   version is one more entry.
 * - **Every reply and every turn's tool row record the version**, so `/logs
 *   tools` and `/prompt` can show rounds per turn side by side.
 *
 * Per person, in `~/.agent/settings.json` — the same kind of choice as the
 * theme. Default v1 until the numbers say otherwise (owner, 2026-10-28).
 */

export const PROMPT_VERSIONS = {
  v1: {
    id: 'v1',
    summary: 'the prompt as of v5.31, frozen as the baseline',
    refreshEvery: 20,
    dir: null,
    flags: {},
  },
  v2: {
    id: 'v2',
    // Filled in by the dedup work (plan phase 4). Until then it is v1 under
    // another name, which is what proves the switch and the recording alone.
    summary: 'the candidate: same text as v1 for now',
    refreshEvery: 20,
    dir: 'v2',
    flags: {},
  },
};

export const PROMPT_VERSION_IDS = Object.keys(PROMPT_VERSIONS);
export const DEFAULT_PROMPT_VERSION = 'v1';

export function isPromptVersion(id) {
  return Object.hasOwn(PROMPT_VERSIONS, String(id ?? '').toLowerCase().trim());
}

/** The version's entry; anything unknown (an old or hand-edited setting) is the default. */
export function resolvePromptVersion(id) {
  const key = String(id ?? '').toLowerCase().trim();
  return PROMPT_VERSIONS[key] || PROMPT_VERSIONS[DEFAULT_PROMPT_VERSION];
}
