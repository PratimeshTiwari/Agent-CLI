/**
 * Which tools the model actually reaches for.
 *
 * **The question this answers has been asked three times and guessed at
 * twice.** CLAUDE.md records a one-off measurement — 41 sessions, 529 calls,
 * eight of the eighteen tools never called once — and draws a real conclusion
 * from it: *"the lever for an unused tool is never 'name it again' — it is a
 * trigger at the moment of relevance."* That measurement was taken by hand and
 * has never been repeatable, so the conclusion cannot be checked and the
 * delegation-nudge decision that depends on it has stayed gated for days.
 *
 * It could not be recovered afterwards either. Tool calls are stripped out of a
 * reply by `_extractToolCalls` before the cleaned text reaches the session
 * history, so counting them from `history.jsonl` finds nothing — a probe that
 * tried returned `0 of 2790`, every one of those 2790 a `"name"` key inside a
 * tool *result*. The data was never written down; it was only ever in flight.
 *
 * So: one row per turn, from the tally `_turnEvidence` is already keeping for
 * the handover audit. Not one row per call — a turn is the unit every other
 * rate here uses, and per-call rows would be the busiest file in `.agent/`.
 *
 * Never throws. Instrumentation that can fail a turn is worse than none.
 */
import fs from 'fs';
import path from 'path';
import * as paths from './paths.js';
import { percentile } from './trace-log.js';

const usagePath = (workspace) => path.join(paths.logsDir(workspace), 'tool-usage.jsonl');

/**
 * Record one turn's tool calls.
 *
 * @param {string} workspace
 * @param {Map<string, number>|Record<string, number>} counts name -> times called
 */
export function logToolUsage(workspace, counts, { rounds, promptVersion } = {}) {
  try {
    const entries = counts instanceof Map ? [...counts.entries()] : Object.entries(counts || {});
    const tools = {};
    for (const [name, n] of entries) {
      const count = Number(n);
      if (typeof name === 'string' && name && Number.isFinite(count) && count > 0) {
        tools[name] = Math.round(count);
      }
    }
    // A turn with no tool calls is a real and interesting outcome — it is what
    // `turn0_no_tools` is about — so it is recorded rather than skipped.
    const file = usagePath(workspace);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const row = { time: new Date().toISOString(), tools };
    /*
     * Browser round trips this turn took. Each tool round is a full
     * inject → think → scrape cycle (~8.5s median), so this — not prompt size —
     * is what a turn costs, and nothing recorded it. "Make it faster" claims
     * were uncheckable without it. Absent on rows written before it existed.
     */
    if (Number.isFinite(rounds) && rounds >= 0) row.rounds = Math.round(rounds);
    // Which prompt version the turn ran on (v5.32), so versions can be compared.
    if (typeof promptVersion === 'string' && promptVersion) row.promptVersion = promptVersion;
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  } catch {
    /* never fail a turn for a counter */
  }
}

/**
 * Read it back: per-tool totals, and how the turns divide.
 *
 * `neverCalled` takes the catalog rather than deriving from what was seen —
 * the whole point is the tools that appear **nowhere**, and a list derived from
 * the log cannot contain them.
 *
 * @param {string} workspace
 * @param {string[]} [catalog] every tool name the model is offered
 */
export function summariseToolUsage(workspace, catalog = []) {
  let lines = [];
  try {
    lines = fs.readFileSync(usagePath(workspace), 'utf8').split('\n').filter(Boolean);
  } catch {
    // Sorted here too: the empty case is the one a fresh workspace hits, and a
    // list that changes order depending on whether anything was logged is a
    // list somebody will eventually diff.
    return { turns: 0, calls: 0, turnsWithNoTools: 0, rows: [], neverCalled: [...catalog].sort(), rounds: null, versions: [] };
  }

  const totals = new Map();
  let turns = 0;
  let calls = 0;
  let turnsWithNoTools = 0;
  const roundSamples = [];
  // Per prompt version (v5.32). Rows written before it existed ran on what is
  // now v1 — the frozen baseline is v5.31's prompt — so they count as v1.
  const byVersion = new Map();
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    turns += 1;
    if (Number.isFinite(row.rounds)) roundSamples.push(row.rounds);
    const version = typeof row.promptVersion === 'string' && row.promptVersion ? row.promptVersion : 'v1';
    const v = byVersion.get(version) || { turns: 0, noTools: 0, rounds: [] };
    v.turns += 1;
    if (!row.tools || Object.keys(row.tools).length === 0) v.noTools += 1;
    if (Number.isFinite(row.rounds)) v.rounds.push(row.rounds);
    byVersion.set(version, v);
    const tools = row.tools && typeof row.tools === 'object' ? row.tools : {};
    const names = Object.keys(tools);
    if (names.length === 0) turnsWithNoTools += 1;
    for (const name of names) {
      const n = Number(tools[name]) || 0;
      calls += n;
      totals.set(name, (totals.get(name) || 0) + n);
    }
  }

  const rows = [...totals.entries()]
    .map(([name, count]) => ({ name, count, share: calls ? count / calls : 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    turns,
    calls,
    turnsWithNoTools,
    rows,
    neverCalled: catalog.filter((name) => !totals.has(name)).sort(),
    // Only over rows that recorded it — older rows are unknown, not zero.
    rounds: roundSamples.length
      ? { samples: roundSamples.length, median: percentile(roundSamples, 50), p90: percentile(roundSamples, 90) }
      : null,
    versions: [...byVersion.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([version, v]) => ({
      version,
      turns: v.turns,
      turnsWithNoTools: v.noTools,
      rounds: v.rounds.length
        ? { samples: v.rounds.length, median: percentile(v.rounds, 50), p90: percentile(v.rounds, 90) }
        : null,
    })),
  };
}
