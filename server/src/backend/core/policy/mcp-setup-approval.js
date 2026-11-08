/**
 * What happens between the model asking to add an MCP server and it running
 * (v9.9.7). The same shape as `mcp-approval.js`: this file asks, and the handler
 * (`mcp/tools/mcp-setup.js`) refuses without the token it issues.
 *
 * Owner, 2026-11-09, on the box: **one box, then auto**. Testing a server starts
 * its command, which is what v9.2's "the model can never add one" protected: a
 * page or a file can talk a model into a command. So the first time a name and
 * command are tried, the box shows them, starting on Don't add. A retry of the
 * exact same name and command in this session runs without asking again; a
 * changed one asks. A server that needs a secret always asks, because the box is
 * where the person types it.
 *
 * Mode does not matter: auto mode asks too. Nothing about it is remembered past
 * the session, and the command log gets the outcome under `risk: 'mcp'`.
 */
import { randomUUID } from 'node:crypto';
import { logCommand } from '../logs/command-log.js';
import { issueApproval } from './approval-token.js';
import { commandLine, valuesLine } from '../../mcp/client/add-server.js';
import { planSetup } from '../../mcp/tools/mcp-setup.js';
import { changeMcp } from '../../mcp/client/integrations.js';

/** The box. `ask` is drawn by the terminal as hidden or plain fields before the choice. */
export function setupPayload(plan) {
  const target = commandLine(plan.entry);
  const values = valuesLine(plan.entry);
  const lines = [target, ...(values ? [`with ${values}`] : [])];
  return {
    kind: 'external',
    setup: true,
    title: `Add MCP server ${plan.name}?`,
    command: lines.join('\n'),
    lines,
    cwd: '~/.agent/mcp.json',
    riskLevel: 'external',
    riskReason: plan.entry.url ? 'Testing it connects to this address' : 'Testing it runs this command on your computer',
    choices: [{ label: 'Test and add', value: 'send' }, { label: "Don't add", value: 'reject' }],
    ...(plan.ask.length ? { ask: plan.ask } : {}),
  };
}

async function askToAdd(loop, plan) {
  try {
    return await loop._parked(new Promise((resolve) => {
      loop.pendingCommandResolve = resolve;
      loop._pendingExternal = true;
      loop.callbacks.sendToPanel({
        id: randomUUID(),
        type: 'request_command_approval',
        payload: setupPayload(plan),
        timestamp: Date.now(),
      });
    }));
  } finally {
    loop._pendingExternal = false;
  }
}

/** One `mcp_setup` call from the main loop. */
export async function runMcpSetup(loop, call) {
  const signal = loop._mcpAbort?.signal;
  if (signal?.aborted) return { success: false, error: 'Stopped by the user. Nothing was run.' };
  const args = call.args || {};
  const plan = planSetup(args, { taken: loop.mcp.snapshot().servers.map((s) => s.name) });
  // Nothing to run, so nothing to ask about: the model reads why and fixes it.
  if (plan.problem) return { success: false, error: plan.problem };

  const audit = { command: `mcp add ${plan.name}: ${commandLine(plan.entry)}`, cwd: 'mcp.json', risk: 'mcp' };
  const agreed = (loop._mcpSetupAgreed ??= new Set());
  let values = {};
  if (plan.ask.length || !agreed.has(plan.fingerprint)) {
    const answer = await askToAdd(loop, plan);
    if (!answer?.approved) {
      logCommand(loop.workspace, { ...audit, outcome: 'rejected' });
      return { success: false, error: 'User rejected: nothing was run or saved. Do not retry it; ask what they want changed.' };
    }
    agreed.add(plan.fingerprint);
    values = answer.values || {};
  }

  const result = await loop.mcpServer.executeTool('mcp_setup', args, {
    mcp: loop.mcp,
    workspace: loop.workspace,
    signal,
    values,
    approval: issueApproval(),
    afterSave: async (name) => {
      await changeMcp(loop, () => loop.mcp.configChanged());
      // Not awaited, as from /mcp add: it answered a moment ago, and a slow
      // second start is a `starting` row, not a held turn.
      loop.mcp.connect(name)?.catch?.(() => { /* its row says so */ });
    },
  });
  logCommand(loop.workspace, {
    ...audit,
    outcome: result.success ? 'ran' : 'failed',
    ...(result.success ? {} : { reason: String(result.error || '').slice(0, 300) }),
  });
  return result;
}
