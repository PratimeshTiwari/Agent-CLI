/**
 * Prompt text, kept in files instead of template literals.
 *
 * `prompt-builder.js` was 1,035 lines, and roughly two thirds of that was
 * English inside backticks. Two concrete problems with that, neither of them
 * aesthetic:
 *
 * **A prompt change is invisible in a diff.** Reword one line of the reasoning
 * protocol and it shows up as a modified line inside a template literal in a
 * very large file, indistinguishable from a logic change. That file is also the
 * one CLAUDE.md warns in capitals never to bulk-edit with a regex, because a
 * greedy pattern silently removed three tool definitions — twice.
 *
 * **Template literals have escaping rules and prose does not.** A single
 * unescaped backtick in that file ends the string and the failure surfaces
 * somewhere else entirely, as `ReferenceError: memory is not defined` from an
 * unrelated function. Markdown has no such trap.
 *
 * Only *static* prose moves here. Anything the builder computes — tiers,
 * topologies, the reviewer's name, phase numbering that shifts with the
 * reasoning level — stays in JavaScript, because that is logic and it belongs
 * where logic is read. A markdown file full of `${isBrief ? '2' : '3'}` would
 * be worse than what it replaced.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts');

// Read once. These are static files that ship with the agent, and buildPrompt
// is on the hot path of every turn.
const cache = new Map();

// Where the files are read from. Only a test moves it, to a copy, so that no
// test writes into the source tree: one did, and a running agent's watcher
// reported the planted file as an edit "made externally by the user" (v9.9.4).
let promptsRoot = PROMPTS_DIR;

/** Tests only: read prompts from `dir` (a copy of the shipped folder), or back from the shipped one. */
export function usePromptsDir(dir = null) {
  promptsRoot = dir || PROMPTS_DIR;
  cache.clear();
}

/** The shipped folder, for a test that copies it. */
export const SHIPPED_PROMPTS_DIR = PROMPTS_DIR;

/**
 * The text of `backend/prompts/<name>.md`, with trailing whitespace trimmed.
 *
 * A missing file throws at the first prompt rather than silently sending the
 * model a prompt with a hole in it — a system prompt quietly missing its
 * reasoning protocol is the kind of fault that looks like the model got worse.
 *
 * @param {string} name - file name without the extension
 * @returns {string}
 */
export function prompt(name, dir = null) {
  const key = dir ? `${dir}/${name}` : name;
  if (cache.has(key)) return cache.get(key);

  /*
   * A prompt version (core/prompt/prompt-versions.js) overrides a file by putting its
   * own copy in `backend/prompts/<dir>/`; anything it does not override is the base
   * file, so a version is only its differences.
   */
  const own = dir ? join(promptsRoot, dir, `${name}.md`) : null;
  const file = own && existsSync(own) ? own : join(promptsRoot, `${name}.md`);
  let text;
  try {
    text = readFileSync(file, 'utf-8').trimEnd();
  } catch (err) {
    throw new Error(`Missing prompt file ${name}.md (${file}): ${err.message}`);
  }

  cache.set(key, text);
  return text;
}

/** Forget the cache. Tests only — the files do not change at runtime. */
export function clearPromptCache() {
  cache.clear();
}
