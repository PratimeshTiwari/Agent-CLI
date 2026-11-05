import { readFileSync } from 'fs';
import { configPath } from '../core/workspace/paths.js';
import { MemoryStore } from './memory-store.js';

export { parseMemory } from './memory-store.js';

/**
 * What the agent has learned about this project, in `.agent/<scope>/memory/`.
 * The on/off switch and the numbered view v1 uses; the files are `MemoryStore`'s.
 *
 * Two things were wrong with the version this replaces, and they compounded.
 *
 * It was **write-only**. `manage_memory add` appended to `memory.json` and
 * nothing ever read it back — `getAllMemories` had no callers at all. Every
 * fact the model was told to remember cost a tool call and bought nothing, and
 * the model was told to do it by the system prompt, so it kept paying.
 *
 * And it was **JSON**, for a list of English sentences a person is supposed to
 * be able to correct. A learned fact is exactly the kind of thing that is
 * subtly wrong six weeks later; if fixing it means editing a quoted array, it
 * does not get fixed. Markdown bullets are readable in any editor, diff
 * cleanly, and are something `read_file` and `edit_file` already understand.
 *
 * **Scoped, never walked.** `AGENT.md` is walked up from the code because a
 * parent repo's conventions genuinely apply to its children. Memory is not
 * that: it is what this agent inferred here, which nobody reviewed. Walking it
 * would put one repo's guesses into a sibling's prompt. Promoting a learned
 * fact to a standing instruction is a manual edit into `AGENT.md`, on purpose.
 */
export class MemoryManager {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.store = new MemoryStore(workspacePath);
    this.memoryEnabled = readMemoryEnabled(workspacePath);
  }

  toggleMemory() {
    this.memoryEnabled = !this.memoryEnabled;
    return this.memoryEnabled;
  }

  isMemoryEnabled() {
    return this.memoryEnabled;
  }

  /**
   * Add a fact, unless it is already there.
   * @returns {boolean} false when memory is off or the fact is a duplicate
   */
  addMemory(fact, stamp = {}) {
    if (!this.memoryEnabled) return false;
    return this.store.add({ fact, ...stamp }).ok;
  }

  /**
   * Forget one fact, by its 1-based position as the prompt shows it.
   *
   * The old signature was 0-based and the facts were in a file nothing
   * displayed, so the model was picking indices into a list it had never seen.
   * They are numbered in the prompt now, and these numbers are those.
   */
  removeMemory(position) {
    const facts = this.store.list();
    const i = Number(position) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= facts.length) return false;
    return this.store.remove(facts[i].name, { force: true }).ok;
  }

  /** Every remembered fact, in the order they were learned. */
  getAllMemories() {
    return this.store.list().map((f) => f.fact);
  }

  /** The same, with who wrote each, when and why. */
  getEntries() {
    return this.store.list();
  }
}

/** The file as it is written: a header a human will understand, then bullets. */
export function renderMemory(facts) {
  return [
    '# Memory',
    '',
    'What the agent has learned about this project. It is read back into the',
    'prompt, so a wrong line here becomes a wrong assumption — edit or delete',
    'freely. Conventions you want followed always belong in `AGENT.md` instead.',
    '',
    ...facts.map((f) => `- ${f}`),
    '',
  ].join('\n');
}

/** The persisted `/memory on|off` preference. Defaults to on. */
export function readMemoryEnabled(workspace) {
  try {
    const cfg = JSON.parse(readFileSync(configPath(workspace), 'utf8'));
    return cfg.memoryEnabled !== false;
  } catch {
    return true;
  }
}
