/**
 * When the browser is not on the model the effort wants (v5.28).
 *
 * Owner, 2026-10-27: *"instead of directly matching the browser effort, we can
 * stop, show an option to user that these differ, continue or change effort,
 * and if effort fails to change, display effort fails (due to quota on pro and
 * argon) then send the lower, make a systematic thing"*.
 *
 * Since v5.26 the prompt has followed the tab silently (`rungForModel`), with a
 * notice row as the only sign. This module holds the three decisions that
 * replace the silence, as functions over plain values so each is testable
 * without a browser:
 *
 * - **whether to ask** (`describeMismatch`, gated by `mismatchPolicy`);
 * - **one step down** (`lowerRung`): Max → High → Medium → Low, never up;
 * - **getting the tab onto a rung, or the nearest one below it that lands**
 *   (`ensureRung`). Every trigger — the user choosing "switch" in the ask, a
 *   quota reply mid-turn — goes through this one walk, so the triggers cannot
 *   drift into stepping down differently.
 *
 * A switch counts as landed only on what the picker reads back afterwards
 * (`switchedTo`), never on having been asked: the bridge's own rule.
 */

import { EFFORT_LEVELS, resolveEffort } from './effort.js';
import { explainModelMismatch, planModelSwitch, browserModelPin, rungForModel } from './model-match.js';

/** `ask` stops before the turn; `follow` is v5.26's silent behaviour; `switch` always switches. */
export const MISMATCH_POLICIES = ['ask', 'follow', 'switch'];

export function mismatchPolicy(modelConfig = {}) {
  return MISMATCH_POLICIES.includes(modelConfig?.onMismatch) ? modelConfig.onMismatch : 'ask';
}

/** The rung one below, or null at the bottom. Never upward. */
export function lowerRung(id) {
  const ids = EFFORT_LEVELS.map((e) => e.id);
  const at = ids.indexOf(resolveEffort(id).id);
  return at > 0 ? ids[at - 1] : null;
}

/**
 * What to put to the user, or null when there is nothing to ask.
 *
 * Null when the two agree, when the picker is unread (`unknown` is not a
 * disagreement — the warning row has the same rule), and when nothing on this
 * account suits the setting (`unavailable`: switching cannot help, and `/effort`
 * already said so when it was set).
 *
 * `key` is the disagreement itself. "Send on Flash this time" holds until the
 * tab or the setting moves; a choice made once must not be asked again on every
 * message after it, or the panel becomes something people dismiss unread.
 *
 * @returns {null | {key: string, setting: string, wanted: string, current: string, browserRung: string|null}}
 */
export function describeMismatch(setting, models = [], modelConfig = {}) {
  const rung = resolveEffort(setting).id;
  const explained = explainModelMismatch(rung, models, browserModelPin(modelConfig, rung));
  if (explained.state !== 'mismatch') return null;
  return {
    key: `${rung}|${explained.current}`,
    setting: rung,
    wanted: explained.wanted,
    current: explained.current,
    // Null when the tab is on something no rung answers to (a mode); then the
    // "set effort to match" choice has nothing to offer and is left out.
    browserRung: rungForModel(models, rung, modelConfig),
  };
}

/**
 * Get the tab onto `rung`, or the nearest rung below it whose switch lands.
 *
 * Collaborators are passed in rather than imported, so the walk is tested with
 * a fake picker — the failure it exists for (Pro at its limit) cannot be made
 * to happen on demand against the real page.
 *
 * @param {object} o
 * @param {string} o.rung              where to start
 * @param {() => Array} o.models       the picker as last read; re-read per step,
 *                                     because each switch reports a fresh list
 * @param {object} [o.modelConfig]     for pins
 * @param {(label: string) => Promise<{ok: boolean, switchedTo?: string|null, cancelled?: boolean}>} o.switchTo
 * @returns {Promise<{ok: boolean, rung: string|null, label?: string, cancelled?: boolean,
 *   failed: Array<{rung: string, label: string, switchedTo: string|null}>}>}
 *   `failed` is every switch that did not land, in order — what the screen says
 */
export async function ensureRung({ rung, models, modelConfig = {}, switchTo }) {
  const failed = [];
  for (let id = resolveEffort(rung).id; id; id = lowerRung(id)) {
    const plan = planModelSwitch(id, models() || [], browserModelPin(modelConfig, id));
    if (plan.action === 'none') return { ok: true, rung: id, label: plan.model.label, failed };
    // Nothing on this account for that rung (Max without Argon): not a failed
    // switch, just not a step that exists. Keep going down.
    if (plan.action === 'unavailable') continue;
    const result = await switchTo(plan.model.label);
    if (result?.cancelled) return { ok: false, rung: null, cancelled: true, failed };
    if (result?.ok) return { ok: true, rung: id, label: plan.model.label, failed };
    failed.push({
      rung: id, label: plan.model.label, switchedTo: result?.switchedTo ?? null,
      ...(result?.timedOut ? { timedOut: true } : {}),
    });
  }
  return { ok: false, rung: null, failed };
}

/**
 * `✗ Could not switch the browser to 3.1 Pro (it stayed on 3.8 Flash)`.
 *
 * Three different facts, kept apart: the picker named another model; the tab
 * never answered; or it answered with nothing marked selected, which is a
 * picker we cannot read rather than a tab that ignored us.
 */
export function describeFailedSwitch({ label, switchedTo, timedOut = false }) {
  const why = switchedTo ? `it stayed on ${switchedTo}`
    : timedOut ? 'the tab did not answer'
      : 'the picker showed no model selected';
  return `✗ Could not switch the browser to ${label} (${why})`;
}
