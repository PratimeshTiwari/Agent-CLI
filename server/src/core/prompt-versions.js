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
    hint: 'original prompt', // the settings row: a few words, not the summary
    refreshEvery: 20,
    dir: null,
    flags: {},
  },
  /*
   * v2 (v5.34): the dedup plan, `.agent/artifacts/plans/2026-10-26-prompt-dedup.md`.
   * Fewer lines that cost a round trip, and one copy of each repeated rule.
   * The files in `prompts/v2/` carry the same changes for the prompt files.
   */
  v2: {
    id: 'v2',
    summary: 'fewer round trips: trusts the edit result, reviews only big changes, one copy of each rule',
    hint: 'fewer round trips',
    refreshEvery: 20,
    dir: 'v2',
    flags: {
      trustEditResult: true,     // no read-back after every edit; the result says whether it landed
      gateReview: true,          // a review subagent only past one file or ~30 lines
      walkthroughWithTask: true, // walkthrough.md only after a task.md; the plan files say what each is for
      tickWithNextCall: true,    // tick task.md in the reply that makes the next call
      oneCopy: true,             // a repeated rule is kept once, nearest its use
      answerDirectly: true,      // lite/flash: a greeting gets no task.md and no plan (v6.7)
      symbolLanguages: true,     // find_symbol names Ruby as well as JavaScript (v6.8)
      subagentEffortWords: true, // ask_subagent's effort is low | medium | high | max (v6.15)
      largeFileDigest: true,     // read_file says a large unranged read comes back as a digest (v6.16)
      logQuery: true,            // query_log is offered: log files and exports, however large (v6.20)
      projectCommands: true,     // turn 0 says how this project tests, lints and builds (v7.4)
    },
  },
};

/**
 * Each switch in a version's `flags`, in a few words, for the `/prompt` menu's
 * "what changes" list (v6.11). A flag with no entry here fails a test, so a new
 * switch cannot ship with nothing to say about it.
 */
export const FLAG_NOTES = {
  trustEditResult: 'No read-back after an edit: the result says if it landed',
  tickWithNextCall: 'task.md is ticked in the reply that makes the next call',
  gateReview: 'A review subagent only past one file or ~30 lines',
  walkthroughWithTask: 'walkthrough.md only after a task.md',
  oneCopy: 'Each repeated rule is said once, nearest its use',
  answerDirectly: 'A greeting gets an answer, not a task.md and a plan',
  symbolLanguages: 'find_symbol says it reads Ruby as well as JavaScript',
  subagentEffortWords: 'ask_subagent takes the /effort words, max included',
  largeFileDigest: 'read_file says a large file comes back as a subagent\'s digest',
  logQuery: 'query_log reads log files and Grafana/Datadog exports',
  projectCommands: 'Turn 0 names the project\'s test, lint and build commands',
};

/** What a version changes from v1, one line per switch that is on. */
export function versionChanges(id) {
  const v = resolvePromptVersion(id);
  return Object.entries(v.flags || {}).filter(([, on]) => on).map(([flag]) => FLAG_NOTES[flag] || flag);
}

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
