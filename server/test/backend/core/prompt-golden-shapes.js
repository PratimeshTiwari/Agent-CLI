/**
 * Every prompt shape the builder can produce, as text, for the v1 golden test.
 *
 * Prompt v1 is a frozen baseline (v5.32): the point of a selectable version is
 * a fixed thing to compare a newer one against, and a baseline that drifts
 * with every edit compares nothing. `prompt-v1-golden.test.js` hashes these
 * and checks them against `fixtures/prompt-v1-golden.json`.
 *
 * Regenerate only when v1 is *meant* to change (it should not be):
 *   node --import ./test/setup-home.js test/backend/core/prompt-golden-shapes.js --write
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PromptBuilder } from '../../../src/backend/core/prompt-builder.js';

const EFFORTS = ['low', 'medium', 'high'];
const MODES = ['plan', 'auto', 'strict'];

export function promptShapes({ version } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'golden-'));
  const make = () => {
    const pb = new PromptBuilder(ws, ws);
    if (version) pb.promptVersion = version;
    return pb;
  };
  const norm = (s) => String(s).split(ws).join('<WS>');
  const out = {};
  try {
    for (const effort of EFFORTS) {
      for (const mode of MODES) {
        for (const subagents of [true, false]) {
          const key = `${effort}/${mode}/${subagents ? 'sub' : 'solo'}`;
          const args = { userMessage: 'hi', mode, subagents, modelConfig: { effort }, objective: 'hi' };
          const pb = make();
          out[`${key}/turn0`] = norm(pb.buildPrompt(args));
          pb.noteMessageSent?.();
          out[`${key}/short`] = norm(pb.buildPrompt({ ...args, userMessage: 'and then?' }));
          pb.messagesSinceRefresh = 1000;
          out[`${key}/refresh`] = norm(pb.buildPrompt({ ...args, userMessage: 'again' }));
          pb.requestToolRedeclaration();
          out[`${key}/redeclare`] = norm(pb.buildPrompt({ ...args, userMessage: 'use your tools' }));
          out[`${key}/warmup`] = norm(make().buildWarmup({ mode, subagents, modelConfig: { effort } }));
        }
      }
      out[`${effort}/handover`] = norm(make().buildHandoverBlock(effort));
    }
    const pb = make();
    out['batch'] = norm(pb.buildToolResultBatch([
      { name: 'read_file', result: { path: 'a.js', content: 'const a = 1;\nexport default a;\n', totalLines: 2, range: { start: 1, end: 2 } } },
      { name: 'grep_search', result: { matches: [{ file: 'a.js', line: 1, text: 'const a = 1;' }] } },
      { name: 'run_command', result: { stdout: 'ok\n', exitCode: 0 } },
    ]));
    for (const role of ['review', 'research', 'task']) out[`subagent/${role}`] = norm(pb.buildSubagentWrapper(role));
    out['compaction'] = norm(pb.buildCompactionPrompt([{ role: 'user', content: 'q' }, { role: 'agent', content: 'a' }], 'focus'));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
  return out;
}

export const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export function hashedShapes(opts) {
  return Object.fromEntries(Object.entries(promptShapes(opts)).map(([k, v]) => [k, `${hash(v)} ${v.length}`]));
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv.includes('--write') && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = join(here, 'fixtures', 'prompt-v1-golden.json');
  writeFileSync(file, `${JSON.stringify(hashedShapes({}), null, 2)}\n`);
  console.log(`wrote ${file}`);
}
