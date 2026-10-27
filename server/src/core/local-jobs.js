/**
 * One at a time for the local work that rewrites the install (v5.30).
 *
 * Asked 2026-10-27, after `/doctor` was typed while the warm-up was running:
 * *"how do we deal with multiple responses in this case?"* A message typed
 * during a turn queues (one browser tab, one prompt at a time), and a local
 * command runs beside the turn without touching it. What nothing covered was
 * two local commands that both change the same files: `/doctor fix` pressed
 * twice, or a menu install while `/update pull` is still running. Two
 * `npm install`s writing one `node_modules` is how an install ends up half
 * done, which is the very fault `/doctor` exists to find.
 *
 * So the work that writes the tree takes a named slot first, and a second
 * caller is told what is holding it rather than queued behind it: an install
 * is minutes, and a queued one the user has forgotten about is a surprise.
 *
 * Per process. Two agents on one checkout are not coordinated here; the
 * startup install in `dep-recovery.js` runs before anything else can.
 */

const held = new Map();

/**
 * Take `slot` for `label`, or say who has it.
 *
 * @returns {{ok: true, release: () => void} | {ok: false, holder: string}}
 */
export function claim(slot, label) {
  if (held.has(slot)) return { ok: false, holder: held.get(slot) };
  held.set(slot, label);
  let released = false;
  return {
    ok: true,
    release() {
      if (released) return;
      released = true;
      if (held.get(slot) === label) held.delete(slot);
    },
  };
}

/** Run `fn` holding `slot`; a busy slot answers `{busy: holder}` without running it. */
export async function exclusive(slot, label, fn) {
  const c = claim(slot, label);
  if (!c.ok) return { busy: c.holder };
  try {
    return await fn();
  } finally {
    c.release();
  }
}

/** Who holds `slot`, or null. */
export const holderOf = (slot) => held.get(slot) || null;

/** The slot for anything that runs `npm install` or `git pull` on the agent's own checkout. */
export const INSTALL_SLOT = 'install';
