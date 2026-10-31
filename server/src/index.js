#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { existsSync, readFileSync, rmSync } from 'fs';
import { homedir } from 'os';

/**
 * The bin: runs main.js under tsx, and restarts it when it asks.
 *
 * The sources contain JSX, so `node src/main.js` fails outright — everything
 * goes through tsx.
 *
 * The loop is what makes `/restart` real. It used to work by touching this
 * file's mtime, which does something only under `tsx --watch` (`npm run dev`)
 * and nothing at all under `agent-cli` — where it still reported success. A
 * coding agent that edits its own source needs to reload it, so the child asks
 * by exiting with RESTART_EXIT_CODE and this relaunches it. Any other status is
 * a real exit and passes straight through.
 */
// Defined in core/restart.js, which is where the paths that *ask* for a
// restart live. Two copies of a protocol number is the drift this repo keeps
// finding; the shim is the consumer, so it imports rather than declares.
export { RESTART_EXIT_CODE } from './core/restart.js';
import { RESTART_EXIT_CODE } from './core/restart.js';
import { shouldRevert, revertChange, readRecord } from './core/doctor-guard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainJs = resolve(__dirname, 'main.js');

let tsxPath = resolve(__dirname, '../node_modules/.bin/tsx');
if (!existsSync(tsxPath)) {
  tsxPath = resolve(__dirname, '../../node_modules/.bin/tsx');
}

// `agent doctor` answers before tsx is looked for: it exists for the machine
// whose install is broken, and core/doctor.js imports only built-ins.
if (process.argv[2] === 'doctor' || process.argv.includes('--doctor')) {
  const { runDoctorCli } = await import('./core/doctor.js');
  process.exit(await runDoctorCli(process.argv.slice(2)));
}

// `agent atlassian login | logout | status` (v8.1): in a shell of its own so a
// token is typed with echo off, never into the agent's prompt and history.
if (process.argv[2] === 'atlassian') {
  const { runAtlassianCli } = await import('./atlassian/cli.js');
  process.exit(await runAtlassianCli(process.argv.slice(3)));
}

if (!existsSync(tsxPath)) {
  console.error("✗ 'tsx' not found. Please run 'npm install' in the workspace root or server directory.\n");
  // Whatever else that install is missing, said now rather than one crash at a time.
  const { runDoctorCli } = await import('./core/doctor.js');
  await runDoctorCli(['--offline']);
  process.exit(1);
}

// A restart re-reads the agent's own code, so a run that keeps asking for one
// is a boot loop, not a feature. Bounded, and it says so before it stops.
const MAX_RESTARTS = 20;

/**
 * A workspace chosen from `/set-workspace`, if the child left one.
 *
 * Switching in place was the bug: the session store, memory manager, config and
 * command allowlist were all keyed on the workspace and only some of them were
 * rebound, so the agent read the new project's memory while writing facts to
 * the old one's file. A restart rebinds all of them, and the child cannot
 * rewrite its own argv, so it leaves the choice here instead.
 */
function takeHandover() {
  const file = resolve(
    process.env.AGENT_CLI_HOME || process.env.GEMINI_AGENT_HOME || process.env.AGENT_HOME
      || resolve(homedir(), '.agent'),
    'next-workspace',
  );
  try {
    if (!existsSync(file)) return null;
    const target = readFileSync(file, 'utf8').trim();
    // Read once. A stale handover would silently ignore --workspace on every
    // subsequent launch, which is a much more confusing bug than losing one.
    rmSync(file, { force: true });
    return target || null;
  } catch {
    return null;
  }
}

/** Replace any `--workspace`/`-w` already on the command line. */
function withWorkspace(argv, workspace) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace' || argv[i] === '-w') { i++; continue; }
    out.push(argv[i]);
  }
  return [...out, '--workspace', workspace];
}

let argv = process.argv.slice(2);

for (let restarts = 0; ; restarts++) {
  const result = spawnSync(tsxPath, [mainJs, ...argv], {
    stdio: 'inherit',
    // How the child knows a supervisor is listening. Without it, /restart has
    // nothing to exit into and says so rather than quitting on the user.
    env: { ...process.env, AGENT_CLI_SUPERVISED: '1' },
  });

  // A start that broke after `/doctor` changed a package: put it back, once,
  // and start again (`core/doctor-guard.js`).
  if (result.status !== RESTART_EXIT_CODE && shouldRevert(result.status, process.env, result.pid)) {
    // Said before npm runs: its output is the next thing on screen, and
    // without this line nothing says why an install started after a crash.
    const pending = readRecord(process.env)?.changes || [];
    console.error(`↶ The agent did not start after /doctor changed ${pending.join(', ')}. Putting back the previous package.json and lockfile…`);
    const { ok, error } = revertChange({ env: process.env });
    console.error(ok ? '↶ Put back; starting again.' : `✗ Putting it back failed: ${error}`);
    if (ok) continue;
  }
  if (result.status !== RESTART_EXIT_CODE) {
    process.exit(result.status ?? 0);
  }
  if (restarts >= MAX_RESTARTS) {
    console.error(`✗ Restarted ${MAX_RESTARTS} times without settling. Stopping.`);
    process.exit(1);
  }

  const handover = takeHandover();
  if (handover) argv = withWorkspace(argv, handover);
  console.log(handover ? `⟳ Restarting in ${handover}…` : '⟳ Restarting…');
}
