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
 *   prompt files (`backend/prompts/<dir>/<name>.md`, else `backend/prompts/<name>.md`), `flags`
 *   switch builder behaviour, `refreshEvery` is the reminder cadence. A third
 *   version is one more entry.
 * - **Every reply and every turn's tool row record the version**, so `/logs
 *   tools` and `/prompt` can show rounds per turn side by side.
 *
 * Per person, in `~/.agent/settings.json` — the same kind of choice as the
 * theme. A version is wording only since v9.9.5: v1, frozen, and v7, current.
 * Features (Jira, MCP, memory) are on for both (`FEATURES`). A new install
 * starts on v7; a setting that was never written stays v1.
 */

export const PROMPT_VERSIONS = {
  v1: {
    id: 'v1',
    summary: 'the wording as of v5.31, unchanged; Jira, MCP and memory as on current',
    hint: 'original prompt, frozen', // the settings row: a few words, not the summary
    label: 'original',
    refreshEvery: 20,
    dir: null,
    flags: {},
  },
  /*
   * v7 (v9.9.5): the one current prompt. Owner, 2026-11-08, on a `/prompt` menu
   * of six: "v3, v4, v5, v6 are all feature upgrades that could be written to
   * the initial v1 and v2". They were. v4 added Jira, v5 MCP and v6 memory, each
   * a version only because a prompt change went into a new one; that made a
   * version per feature and a menu where two rows were real choices.
   *
   * Now a version is wording only, and a feature is on wherever it is set up
   * (`FEATURES`, on v1 too). v7 is v2's wording (the dedup plan,
   * `.agent/artifacts/plans/2026-10-26-prompt-dedup.md`) plus v3's "look before
   * answering" on the low and medium rungs. v2 to v6 are read as v7
   * (`LEGACY_VERSIONS`); rows logged under them keep their labels.
   * v2's prompt files: `dir` falls back to the base file, not to another folder.
   */
  v7: {
    id: 'v7',
    summary: 'fewer round trips, and a question about the project is answered from files opened this turn',
    hint: 'fewer round trips, looks before answering',
    label: 'current',
    refreshEvery: 20,
    dir: 'v2',
    flags: {
      trustEditResult: true,     // no read-back after every edit; the result says whether it landed
      gateReview: true,          // a review subagent only past one file or ~30 lines
      walkthroughWithTask: true, // walkthrough.md only after a task.md; the plan files say what each is for
      tickWithNextCall: true,    // tick task.md in the reply that makes the next call
      oneCopy: true,             // a repeated rule is kept once, nearest its use
      answerDirectly: true,      // lite/flash: a greeting gets no task.md and no plan (v6.7)
      symbolLanguages: true,     // find_symbol names every language it reads (v6.8, v6.21)
      subagentEffortWords: true, // ask_subagent's effort is low | medium | high | max (v6.15)
      largeFileDigest: true,     // read_file says a large unranged read comes back as a digest (v6.16)
      logQuery: true,            // query_log is offered: log files and exports, however large (v6.20)
      projectCommands: true,     // turn 0 says how this project tests, lints and builds (v7.4)
      lookFirst: true,           // low/medium: open the code before explaining it; a promised call is made (v7.9)
    },
  },
};

/**
 * Features, on every version (v9.9.5). Each changes the prompt only once it is
 * set up — a Jira site, a usable MCP server, a saved fact or a message that
 * sets a rule — except `memoryFolder`, which also words `manage_memory` for
 * named facts. So v1 with nothing set up is its old bytes but that one tool
 * line, and the golden file says so.
 */
export const FEATURES = Object.freeze({
  jira: true,         // jira_issue, once a site is set up (v8.1)
  customMcp: true,    // mcp_describe and mcp_tool, once a server is usable (v9.1)
  memoryFolder: true, // <memory> is an index; facts are named, read and updated (v9.4)
  saveNudge: true,    // a message that sets a rule carries one line asking to save it (v9.4)
});

/** Versions that were, read as the current one; their logged rows keep their labels. */
export const LEGACY_VERSIONS = Object.freeze(['v2', 'v3', 'v4', 'v5', 'v6']);

/** The one current prompt; what a new install gets. */
export const CURRENT_PROMPT_VERSION = 'v7';

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
  symbolLanguages: 'find_symbol names every language it reads, not only JavaScript',
  subagentEffortWords: 'ask_subagent takes the /effort words, max included',
  largeFileDigest: 'read_file says a large file comes back as a subagent\'s digest',
  logQuery: 'query_log reads log files and Grafana/Datadog exports',
  projectCommands: 'Turn 0 names the project\'s test, lint and build commands',
  lookFirst: 'A question about the project is answered from files opened this turn',
  jira: 'jira_issue works with Jira issues once a site is set up; every write asks you',
  customMcp: 'mcp_tool calls the servers you added; /mcp sets each tool to ask, auto or block',
  memoryFolder: 'The prompt lists saved facts by name; the model reads one when it needs it',
  saveNudge: 'A message that corrects the agent or sets a rule asks it to save that',
};

/** What a version changes from v1, one line per switch that is on. */
export function versionChanges(id) {
  const v = resolvePromptVersion(id);
  return Object.entries(v.flags || {}).filter(([, on]) => on).map(([flag]) => FLAG_NOTES[flag] || flag);
}

export const PROMPT_VERSION_IDS = Object.keys(PROMPT_VERSIONS);

/**
 * What a version adds to the one before it (v8.1). The cumulative list grew
 * to thirteen lines by v4, so the menu cut it to "… +6 more" and v4's one new
 * switch — Jira — was among the hidden ones.
 *
 * @returns {{from: string|null, lines: string[]}}
 */
export function versionAdds(id) {
  const v = resolvePromptVersion(id);
  const prev = PROMPT_VERSIONS[PROMPT_VERSION_IDS[PROMPT_VERSION_IDS.indexOf(v.id) - 1]];
  if (!prev) return { from: null, lines: [] };
  const lines = Object.entries(v.flags || {})
    .filter(([flag, on]) => on && !prev.flags?.[flag])
    .map(([flag]) => FLAG_NOTES[flag] || flag);
  return { from: prev.id, lines };
}
/**
 * What a missing or unreadable setting means: v1, so a person who never chose
 * is not moved (owner, 2026-11-08). A new install is given v7 at first start.
 */
export const DEFAULT_PROMPT_VERSION = 'v1';

/** The id a typed or stored name stands for: `current`/`original`, a legacy id, or null. */
export function promptVersionId(id) {
  const key = String(id ?? '').toLowerCase().trim();
  if (Object.hasOwn(PROMPT_VERSIONS, key)) return key;
  if (LEGACY_VERSIONS.includes(key) || key === 'current' || key === 'newest' || key === 'latest') {
    return CURRENT_PROMPT_VERSION;
  }
  if (key === 'original' || key === 'baseline') return 'v1';
  return null;
}

export function isPromptVersion(id) {
  return promptVersionId(id) != null;
}

/** The version's entry; anything unknown (an old or hand-edited setting) is the default. */
export function resolvePromptVersion(id) {
  return PROMPT_VERSIONS[promptVersionId(id) || DEFAULT_PROMPT_VERSION];
}
