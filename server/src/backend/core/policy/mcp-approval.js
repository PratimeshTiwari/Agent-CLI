/**
 * What happens between the model asking for an MCP tool and it running (v9.1).
 * The same shape as `external-approval.js`: the policy decides, the box asks,
 * and the handler holds a third lock (`mcp/tools/mcp-tool.js`).
 *
 * The box starts on Don't run, and "Always for this tool" sets the switch to
 * auto. The command log gets server, tool and outcome, never the arguments,
 * because they can hold what the person would not want in a log.
 */
import { randomUUID } from 'node:crypto';
import { logCommand } from '../logs/command-log.js';
import { setSwitch, switchFor } from '../../mcp/client/switches.js';
import { issueApproval } from './approval-token.js';
import { isBlockedOutright, requiresApproval } from './tool-policy.js';

const MAX_ARG_LINES = 40;
const MAX_LINE = 200;


function decide(loop, call) {
  const { server, tool } = call.args || {};
  const external = loop.mcp.kindOf?.(server, tool) || null;
  const mcpSwitch = switchFor(loop.mcp.switchKey(server), tool);
  const alwaysAsk = loop.mcp.alwaysAsks(server);
  return {
    alwaysAsk,
    external,
    blocked: isBlockedOutright(call, null, { mcpSwitch, external }),
    ask: requiresApproval(call, { mode: loop.mode, mcpSwitch, alwaysAsk, external }),
  };
}

/** Calls that need no box run together; anything that asks holds its place in the reply. */
export function runsTogether(loop, call) {
  if (call.name === 'mcp_describe') return true;
  if (call.name !== 'mcp_tool' || !loop.mcp.usable(call.args?.server)) return false;
  const { blocked, ask } = decide(loop, call);
  return !blocked && !ask;
}

/** The arguments as the box shows them: all of a call's shape, long values cut. */
export function argLines(args) {
  const lines = JSON.stringify(args ?? {}, null, 2).split('\n').map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…` : l));
  return lines.length > MAX_ARG_LINES ? [...lines.slice(0, MAX_ARG_LINES), `… +${lines.length - MAX_ARG_LINES} lines`] : lines;
}

async function askToRun(loop, { server, tool, args }, { alwaysAsk, external }) {
  const always = alwaysAsk ? [] : [{ label: 'Always for this tool', value: 'allow_always' }];
  const lines = argLines(args);
  // Atlassian's write is Jira's box in Jira's words (v9.9): Send, never "always".
  const words = external === 'write'
    ? { title: `Send to Atlassian · ${tool}?`, reason: 'Other people see this at once, and /undo cannot take it back', yes: 'Send', no: "Don't send" }
    : { title: `Run ${server} · ${tool}?`, reason: 'A server you added runs this, and /undo cannot take it back', yes: 'Run', no: "Don't run" };
  try {
    return await loop._parked(new Promise((resolve) => {
      loop.pendingCommandResolve = resolve;
      loop._pendingExternal = true;
      loop.callbacks.sendToPanel({
        id: randomUUID(),
        type: 'request_command_approval',
        payload: {
          kind: 'external',
          title: words.title,
          command: lines.join('\n'),
          lines,
          cwd: 'MCP server',
          riskLevel: 'external',
          riskReason: words.reason,
          choices: [{ label: words.yes, value: 'send' }, ...(external ? [] : always), { label: words.no, value: 'reject' }],
        },
        timestamp: Date.now(),
      });
    }));
  } finally {
    loop._pendingExternal = false;
  }
}

/** One MCP call from the main loop. */
export async function runMcpTool(loop, call, context = {}) {
  const signal = loop._mcpAbort?.signal;
  if (signal?.aborted) return { success: false, error: 'Stopped by the user. Nothing was run.' };
  const ctx = { ...context, mcp: loop.mcp, mode: loop.mode, signal };
  const { server, tool } = call.args || {};
  // A name no server has, or a call the schema refuses, has nothing to ask about.
  if (call.name === 'mcp_describe' || !loop.mcp.usable(server) || typeof tool !== 'string') {
    return loop.mcpServer.executeTool(call.name, call.args, ctx);
  }

  const audit = { command: `mcp ${server} ${tool}`, cwd: server, risk: loop.mcp.kindOf?.(server, tool) === 'write' ? 'external' : 'mcp' };
  const decision = decide(loop, call);
  if (decision.blocked) {
    logCommand(loop.workspace, { ...audit, outcome: 'blocked' });
    return { success: false, error: `${server} · ${tool} is blocked by the user. Do not retry it; say so.` };
  }

  let approval;
  if (decision.ask) {
    const answer = await askToRun(loop, call.args, decision);
    if (!answer?.approved) {
      logCommand(loop.workspace, { ...audit, outcome: 'rejected' });
      return { success: false, error: 'User rejected: nothing was run. Do not retry it; ask what they want changed.' };
    }
    if (answer.always && !decision.alwaysAsk && !decision.external) setSwitch(loop.mcp.switchKey(server), tool, 'auto');
    approval = issueApproval();
  }

  const result = await loop.mcpServer.executeTool(call.name, call.args, { ...ctx, approval });
  logCommand(loop.workspace, {
    ...audit,
    outcome: result.success ? 'ran' : 'failed',
    ...(result.success ? {} : { reason: String(result.error || '').slice(0, 300) }),
  });
  return result;
}
