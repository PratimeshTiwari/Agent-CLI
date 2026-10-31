/**
 * A write that leaves this machine asks first, every time (v8.1).
 *
 * Owner, 2026-10-31: every Jira or Confluence write or change must ask
 * permission, as a mandatory step. A comment posted to a ticket is seen by
 * other people at once and `/undo` cannot take it back, so the rules that make
 * local edits cheap to approve do not apply:
 *
 * - it asks in every mode, auto included (`requiresApproval` checks this
 *   before the mode);
 * - `/allowlist` rules and "allow always" do not apply — the box offers Send
 *   and Don't send, and `answerCommandApproval` stores nothing for it;
 * - esc, Don't send, or anything but Send is a no;
 * - subagents cannot call these tools at all.
 *
 * And the handler checks it too. A write runs only with an approval token
 * issued here, after the person said yes, and each token works once. A path
 * that reaches `executeTool` without passing through this file — a subagent
 * runner, a future dispatcher — gets a refusal, not a post.
 */
import { randomUUID } from 'node:crypto';
import { logCommand } from './command-log.js';
import { issueApproval } from './approval-token.js';
import { planJiraWrite } from '../mcp/tools/jira-issue.js';
import { isExternalWrite } from './tool-policy.js';

export { issueApproval, consumeApproval } from './approval-token.js';


const PLANNERS = { jira_issue: planJiraWrite };

/** What the command log calls it: `jira_issue comment PROJ-12`. */
function auditLine(call) {
  const a = call.args || {};
  return [call.name, a.action, a.key || a.project].filter(Boolean).join(' ');
}

/**
 * Run one external call from the main loop. Reads go straight to the tool.
 * A write is planned (which may read, to show what changes), shown, and only
 * sent on Send.
 *
 * @param {import('./agent-loop.js').AgentLoop} loop
 * @param {{name: string, args: object}} call
 * @param {object} context - passed to executeTool
 */
export async function runExternalTool(loop, call, context = {}) {
  if (!isExternalWrite(call)) return loop.mcpServer.executeTool(call.name, call.args, context);

  let plan;
  try {
    plan = await PLANNERS[call.name](call.args || {});
  } catch (err) {
    return { success: false, error: err.message };
  }
  // Planning found nothing to send (a transition that does not exist): its
  // answer is the result, and nobody is asked about nothing.
  if (plan.answer) return plan.answer;

  let approval;
  try {
    approval = await loop._parked(new Promise((resolve) => {
      loop.pendingCommandResolve = resolve;
      loop._pendingExternal = true;
      loop.callbacks.sendToPanel({
        id: randomUUID(),
        type: 'request_command_approval',
        payload: {
          kind: 'external',
          title: plan.title,
          // `command` is what an older side panel draws; the terminal draws `lines`.
          command: plan.lines.join('\n'),
          lines: plan.lines,
          cwd: plan.site,
          riskLevel: 'external',
          riskReason: 'Other people see this, and /undo cannot take it back',
        },
        timestamp: Date.now(),
      });
    }));
  } finally {
    // Stopped mid-approval included: a later command's "always" must count.
    loop._pendingExternal = false;
  }

  const site = plan.site;
  if (!approval?.approved) {
    logCommand(loop.workspace, { command: auditLine(call), cwd: site, outcome: 'rejected', risk: 'external' });
    return {
      success: false,
      error: `User rejected: nothing was sent to ${plan.service}. Do not retry it; ask what they want changed.`,
    };
  }

  const result = await loop.mcpServer.executeTool(call.name, call.args, { ...context, approval: issueApproval(), plan });
  logCommand(loop.workspace, {
    command: auditLine(call), cwd: site,
    outcome: result.success ? 'ran' : 'failed', risk: 'external',
    ...(result.success ? {} : { reason: String(result.error || '').slice(0, 300) }),
  });
  return result;
}
