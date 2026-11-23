/**
 * Everything built from a workspace, built in one place (v9.9.9.5).
 *
 * Owner, 2026-11-23: "changing workspace also restarts the agent … can you
 * avoid restarting the agent in workspace change? or make it more seamless?"
 *
 * The switch used to be in-process: `setWorkspace` rebound four collaborators
 * and left the session store, the memory manager and the config on the old
 * project, so memory went to the old project and its allowlist stayed armed
 * (docs/history.md, "The workspace commands"). That is why it became a
 * restart. This keeps the restart's guarantee without the restart: nothing is
 * re-pointed. The whole world is built again from the new path, and the old
 * one is taken down. Only the process, the bridge (the extension stays
 * connected, on the same tab) and the screen survive a switch.
 *
 * `main.js` builds the first world here too, so a switch and a start can never
 * wire things differently.
 */
import { runMigrations } from '../install/migrate.js';
import { rememberWorkspace } from './workspaces.js';
import { writeAgentReadme } from './agent-readme.js';
import { codeDir, setActiveScope, clearPathCache } from './paths.js';
import { DiffEngine } from '../edits/diff-engine.js';
import { RiskClassifier } from '../commands/risk-classifier.js';
import { PromptBuilder } from '../prompt/prompt-builder.js';
import { MCPServer } from '../../mcp/mcp-server.js';
import { TaskManager } from '../commands/task-manager.js';
import { AgentLoop } from '../turn/agent-loop.js';
import { FileWatcher } from '../../watcher/file-watcher.js';

/**
 * @param {string} workspace absolute path, already validated
 * @param {object} opts `agentSourceDir`, `editor`, `configHome`, and for the
 *   first world only `continueSession` / `resumeSessionId` (a switch starts a
 *   fresh session in the new project, as the restart did)
 */
export function buildWorld(workspace, {
  agentSourceDir, editor, configHome, continueSession = false, resumeSessionId = null,
  migrate = runMigrations, watch = true,
} = {}) {
  try {
    migrate(workspace);
  } catch (err) {
    // A skipped migration is a layout that stays old; a dead start is not.
    console.warn(`⚠️  Migration skipped: ${err.message}`);
  }
  rememberWorkspace(workspace);

  const diffEngine = new DiffEngine(workspace);
  const riskClassifier = new RiskClassifier(workspace);
  const promptBuilder = new PromptBuilder(workspace, agentSourceDir);
  const mcpServer = new MCPServer(workspace, diffEngine);
  const taskManager = new TaskManager(workspace);
  const agentLoop = new AgentLoop({
    workspace, mcpServer, promptBuilder, diffEngine, riskClassifier, editor, configHome,
    continueSession, resumeSessionId, agentSourceDir, taskManager,
  });
  // After the loop, which has made `.agent`; never creates one itself, never throws.
  writeAgentReadme(workspace);

  const fileWatcher = new FileWatcher(codeDir(workspace), agentLoop);
  if (watch) fileWatcher.start();

  return { workspace, diffEngine, riskClassifier, promptBuilder, mcpServer, taskManager, agentLoop, fileWatcher };
}

/**
 * Take a world down without ending the process: what exit does for the
 * project, minus the bridge and the tab. Never throws — a switch that half
 * failed to tidy up still switches.
 */
export async function disposeWorld(world) {
  if (!world) return;
  const quietly = async (fn) => { try { await fn(); } catch { /* tidy-up only */ } };
  await quietly(() => world.fileWatcher?.stop());
  await quietly(() => world.taskManager?.cleanup()); // the old project's background processes
  await quietly(() => world.agentLoop?.dispose?.());
}

/**
 * Switch the running agent to another workspace. The caller has checked the
 * path (`validateWorkspace`) and waited for the turn to finish.
 *
 * `scope` is dropped: it named a folder inside the old workspace.
 */
export async function switchWorld(current, target, opts, { wsServer } = {}) {
  setActiveScope(null);
  clearPathCache();
  const next = buildWorld(target, { ...opts, continueSession: false, resumeSessionId: null });
  wsServer?.setAgentLoop?.(next.agentLoop);
  await disposeWorld(current);
  return next;
}
