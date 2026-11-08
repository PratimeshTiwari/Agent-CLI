/**
 * Thinking level (v9.9.3): Gemini's Low / Medium / High, beside the model.
 *
 * Read live 2026-11-08 (plan `2026-11-06-auto-thinking-visuals.md`, Step 0): the
 * picker offers the same levels on every model, a level survives a model switch
 * and resets to the lightest on a page load. So the agent asks for a level with
 * every main-lane prompt and the tab applies it before typing, checking the
 * trigger first so the menu opens only when the level is wrong.
 *
 * The setting is the person's: `same` (the default) follows effort, or a level
 * name pins it. An account whose picker has no levels shows no Thinking row at
 * all (owner: "if thinking is not available … don't show thinking, simple"); a
 * locked level is shown as locked and never asked for.
 */

/** The levels the picker offers, lightest first, as the extension reported them. */
export function thinkingLevels(options = []) {
  return (options || []).filter((m) => m && m.level && m.label)
    .map((m) => ({ label: m.label, selected: Boolean(m.selected), locked: Boolean(m.locked) }));
}

/** The level ticked in the tab, or null. */
export function currentThinking(options = []) {
  return thinkingLevels(options).find((l) => l.selected)?.label || null;
}

const norm = (s) => String(s || '').trim().toLowerCase();

/** `same`, or a level name as typed: what `/effort thinking` and the setting hold. */
export function normaliseThinkingSetting(value) {
  const v = norm(value);
  return !v || v === 'same' || v === 'same as effort' || v === 'auto' ? 'same' : v;
}

/**
 * The level `same` means for a rung: low → the lightest, medium → the middle,
 * high and max → the heaviest. A locked one steps down to the next usable.
 */
function forRung(rung, levels) {
  const usable = levels.filter((l) => !l.locked);
  if (!usable.length) return null;
  const at = rung === 'low' ? 0
    : rung === 'medium' ? Math.floor((levels.length - 1) / 2)
      : levels.length - 1;
  for (let i = at; i >= 0; i--) if (!levels[i].locked) return levels[i].label;
  return usable[0].label;
}

/**
 * The level to ask the tab for, or null when there is nothing to ask:
 * no levels on this account, or a pinned level it does not have or has locked.
 *
 * @returns {{ level: string|null, reason: string|null }}
 */
export function wantedThinking({ rung, setting, options }) {
  const levels = thinkingLevels(options);
  if (!levels.length) return { level: null, reason: 'none' };
  const s = normaliseThinkingSetting(setting);
  if (s === 'same') return { level: forRung(rung, levels), reason: null };
  const pinned = levels.find((l) => norm(l.label) === s);
  if (!pinned) return { level: null, reason: 'missing' };
  if (pinned.locked) return { level: null, reason: 'locked' };
  return { level: pinned.label, reason: null };
}

/** The Thinking row's stops: `same as effort`, then each level, locked ones marked. */
export function thinkingStops(options = []) {
  const levels = thinkingLevels(options);
  if (!levels.length) return [];
  return [{ id: 'same', label: 'same as effort', locked: false },
    ...levels.map((l) => ({ id: norm(l.label), label: l.label, locked: l.locked }))];
}
