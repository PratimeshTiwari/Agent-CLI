import fs from 'fs';
import path from 'path';
import * as paths from './paths.js';

/**
 * How long a turn spent in the browser, per stage.
 *
 * The extension's own logging is `console.log` in two contexts nobody has open.
 * P2 added `op`/`stage`/`targetModel` to *errors*, which is why `/logs
 * extension` can say `find_input` rather than "failed" — but there has never
 * been any record of a **successful** turn's timings. So "the connection is
 * slower than it used to be" was unanswerable from inside the product, and any
 * claim about a regression was a feeling.
 *
 * Deliberately not `errors.jsonl`. That log collapses repeats inside a 60s
 * window, which is exactly wrong for something you want every sample of, and
 * mixing routine successes into the failure log would bury the failures.
 *
 * What is reported is a **distribution**, not a list. "Is it slower?" is a
 * question about the middle and the tail; twenty individual numbers do not
 * answer it and one average hides the tail that people actually notice.
 */

/** Stages, in the order they happen. Unknown ones are kept but sort last. */
export const STAGES = [
  // Between turns (v6.6, #104), before the tab has the prompt. `round_wait`
  // is the loop parked on the person — an approval, a question — and is not
  // latency; `round_work` is the rest of reply → next send on the server
  // (tools, building the prompt); `deliver` is that send → the tab starting
  // to type (the worker, the tab coming forward, the bridge handshake).
  'round_wait',
  'round_work',
  'deliver',
  'find_input',
  'type',
  'send',
  // The Stop button appearing: the honest "the model started", one observer
  // tick ahead of `first_token`, which fires on the first *scraped text*.
  'generating_start',
  'first_token',
  // The Stop button gone after it was there. A trace with a start and no end
  // is a reply that was still being written when the scrape lost it.
  'generating_end',
  'complete',
];

const tracePath = (workspace) => path.join(paths.logsDir(workspace), 'traces.jsonl');

/**
 * Record one turn's timings.
 *
 * Never throws: this is instrumentation, and instrumentation that can fail a
 * turn is worse than no instrumentation.
 *
 * @param {string} workspace
 * @param {{model?: string, stages?: Record<string, number>}} trace
 */
export function logTrace(workspace, trace) {
  try {
    if (!trace || typeof trace !== 'object') return;
    const stages = {};
    for (const [name, ms] of Object.entries(trace.stages || {})) {
      const n = Number(ms);
      if (Number.isFinite(n) && n >= 0) stages[name] = Math.round(n);
    }
    if (Object.keys(stages).length === 0) return;

    /*
     * The rung rides along, because without it these numbers cannot answer the
     * question people actually ask of them.
     *
     * The record was `{time, model, stages}` — and `model` is always `gemini`,
     * since that is the only provider. So a whole log of round-trip timings
     * could not be split by *which model in the picker ran*, which makes
     * "is Flash cheaper per round trip than Pro?" unanswerable from the one
     * file that has every other part of the answer. It was asked on
     * 2026-09-24 as the basis for routing cheap work to a Flash tab, and the
     * honest reply was that nobody had measured it.
     *
     * Written only when known, so old rows stay valid and a turn with no rung
     * attached is simply not counted in the per-rung split.
     */
    /*
     * `outcome` separates a turn that finished from one that timed out.
     *
     * Traces used to be written only on completion, so the log described the
     * turns that worked and was silent about the ones anybody wanted
     * explained. Recording both is only useful if they can be told apart —
     * otherwise a timeout's partial timings are averaged into the healthy
     * ones and make everything look slightly worse for no visible reason.
     *
     * Written only when given, so rows from before this stay valid and simply
     * do not appear in a split by outcome.
     */
    const line = JSON.stringify({
      time: new Date().toISOString(),
      model: trace.model || 'gemini',
      ...(trace.effort ? { effort: String(trace.effort) } : {}),
      ...(trace.outcome ? { outcome: String(trace.outcome) } : {}),
      ...(trace.promptVersion ? { promptVersion: String(trace.promptVersion) } : {}),
      // How long the prompt was, so a slow `type` can be told from a long one.
      ...(Number.isFinite(Number(trace.chars)) ? { chars: Math.round(Number(trace.chars)) } : {}),
      // How it was typed, in how many lines, and whether the tab was hidden (#104, v7.2).
      ...(['pasted', 'pasted_late', 'inserted'].includes(trace.typed) ? { typed: trace.typed } : {}),
      ...(Number.isFinite(Number(trace.lines)) ? { lines: Math.round(Number(trace.lines)) } : {}),
      ...(typeof trace.hidden === 'boolean' ? { hidden: trace.hidden } : {}),
      // How full the thread was (v7.3): the budgets are guesses until this says otherwise.
      ...(trace.contextTokens > 0 && trace.contextLimit > 0
        ? { contextTokens: Math.round(trace.contextTokens), contextLimit: Math.round(trace.contextLimit) } : {}),
      stages,
    });
    const file = tracePath(workspace);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    /* instrumentation must never fail a turn */
  }
}

/** The most recent `limit` traces, newest last. */
export function readTraces(workspace, { limit = 200 } = {}) {
  try {
    const raw = fs.readFileSync(tracePath(workspace), 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* a half-written line */ }
    }
    return out.slice(-limit);
  } catch {
    return [];
  }
}

/** Median and 90th percentile, which is where "it feels slow" actually lives. */
export function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: no interpolation, so a reported number is always one that
  // really happened.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/**
 * Per stage: how many samples, the median, and the 90th percentile.
 *
 * @returns {{samples: number, stages: Array<{stage, n, median, p90}>}}
 */
export function summariseTraces(workspace, { limit = 200 } = {}) {
  const traces = readTraces(workspace, { limit });
  const byStage = new Map();

  for (const trace of traces) {
    for (const [stage, ms] of Object.entries(trace.stages || {})) {
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage).push(ms);
    }
  }

  const order = (stage) => {
    const at = STAGES.indexOf(stage);
    return at === -1 ? STAGES.length : at;
  };

  const stages = [...byStage.entries()]
    .map(([stage, values]) => ({
      stage,
      n: values.length,
      median: percentile(values, 50),
      p90: percentile(values, 90),
    }))
    .sort((a, b) => order(a.stage) - order(b.stage) || a.stage.localeCompare(b.stage));

  /*
   * And the same numbers split by rung.
   *
   * Recorded *and read*, in one change. This repo has twice shipped a value
   * that was written and never carried back — `getAllMemories` with no callers,
   * `task.md` that no prompt returned — and both times the tool call was spent
   * for nothing. A per-rung field with no per-rung view would be the third.
   *
   * `first_token` and `complete` are the two that differ by model: the rest is
   * our own overhead and is the same whichever tab is answering.
   */
  const byEffort = new Map();
  for (const trace of traces) {
    if (!trace.effort) continue;
    if (!byEffort.has(trace.effort)) byEffort.set(trace.effort, { first: [], complete: [] });
    const row = byEffort.get(trace.effort);
    const s2 = trace.stages || {};
    if (Number.isFinite(s2.first_token)) row.first.push(s2.first_token);
    if (Number.isFinite(s2.complete)) row.complete.push(s2.complete);
  }

  const efforts = [...byEffort.entries()]
    .map(([effort, v]) => ({
      effort,
      n: Math.max(v.first.length, v.complete.length),
      firstToken: percentile(v.first, 50),
      complete: percentile(v.complete, 50),
    }))
    .sort((a, b) => b.n - a.n);

  /*
   * By prompt version (v5.35), for the reply time only: the rest is the
   * browser's overhead and no prompt changes it. Rows from before the field
   * existed are v1's, since v1 *is* the prompt they were sent with.
   */
  const byVersion = new Map();
  for (const trace of traces) {
    const v = trace.promptVersion || 'v1';
    const done = trace.stages?.complete;
    if (!Number.isFinite(done)) continue;
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v).push(done);
  }
  const versions = [...byVersion.entries()]
    .map(([version, values]) => ({
      version, n: values.length, complete: percentile(values, 50), p90: percentile(values, 90),
    }))
    .sort((a, b) => a.version.localeCompare(b.version));

  /*
   * Typing, by how it was typed (v7.2, #104). `type` ran from 0.2 s to 35 s
   * over 41 turns and nothing said which path each one took. Split by path and
   * by whether the tab was hidden, with time per 1,000 characters so a long
   * prompt is not mistaken for a slow path.
   */
  const byTyping = new Map();
  for (const trace of traces) {
    const ms = trace.stages?.type;
    if (!trace.typed || !Number.isFinite(ms)) continue;
    const key = `${trace.typed}${trace.hidden ? ' · hidden' : ''}`;
    if (!byTyping.has(key)) byTyping.set(key, { ms: [], perK: [], chars: [] });
    const row = byTyping.get(key);
    row.ms.push(ms);
    if (trace.chars > 0) { row.chars.push(trace.chars); row.perK.push((ms * 1000) / trace.chars); }
  }
  const typing = [...byTyping.entries()]
    .map(([path, v]) => ({
      path, n: v.ms.length, median: percentile(v.ms, 50), p90: percentile(v.ms, 90),
      chars: percentile(v.chars, 50), perK: percentile(v.perK, 50),
    }))
    .sort((a, b) => b.n - a.n);

  /*
   * Reply time by how full the thread was (v7.3). If replies slow down, or
   * first tokens stretch, well before the budget, the budget is too high; if
   * nothing moves until past it, too low. Bands of the rung's own budget, so
   * rungs with different budgets are comparable.
   */
  const FILL_BANDS = [[0, 0.25, 'under 25%'], [0.25, 0.5, '25–50%'], [0.5, 0.8, '50–80%'], [0.8, Infinity, 'over 80%']];
  const fill = FILL_BANDS.map(([lo, hi, band]) => {
    const rows = traces.filter((t) => t.contextLimit > 0 && t.contextTokens / t.contextLimit >= lo
      && t.contextTokens / t.contextLimit < hi);
    const first = rows.map((t) => t.stages?.first_token).filter(Number.isFinite);
    const done = rows.map((t) => t.stages?.complete).filter(Number.isFinite);
    return { band, n: rows.length, firstToken: percentile(first, 50), complete: percentile(done, 50) };
  }).filter((b) => b.n > 0);

  return { samples: traces.length, stages, efforts, versions, typing, fill };
}

/** `2.1s`, `340ms` — the unit people would say out loud. */
export function formatMs(ms) {
  if (ms === null || ms === undefined) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
