/**
 * `mcp_setup` (v9.9.7): the model adds an MCP server and tests it, when the
 * person asks. Owner, 2026-11-08: "the agent can add and test mcp connection if
 * user asks for it". Until then (v9.2) only `/mcp add` could, and the model never.
 *
 * What the v9.2 rule protected is still protected, by the same three locks as
 * `mcp_tool`: `core/policy/mcp-setup-approval.js` shows the command in a box
 * before it first runs (owner: one box, then a retry of the same command runs);
 * a secret the server needs is typed by the person in that box and reaches this
 * handler through `ctx.values`, never through the model's arguments or its
 * result; and this handler refuses without the box's one-use token, so a path
 * around the runner — a subagent, a future dispatcher — runs nothing.
 *
 * It uses `/mcp add`'s own pieces: the same five pasted shapes, the same name
 * rule, the same test, the same write to `~/.agent/mcp.json`. A repo's
 * `.mcp.json` is never written here.
 */
import { consumeApproval } from '../../core/policy/approval-token.js';
import { commandLine, nameProblem, parseServerInput, planEnv, suggestName, tryServer } from '../client/add-server.js';
import { saveServer } from '../client/edit-config.js';

const TOOL_NAMES_SHOWN = 30;

/**
 * What the arguments ask for, before anything runs. Pure apart from `env`.
 *
 * @param {{input?: string, name?: string}} args
 * @returns {{problem?: string, name?: string, entry?: object, ask?: {key: string, hidden: boolean}[], fingerprint?: string}}
 */
export function planSetup({ input, name } = {}, { taken = [], env = process.env } = {}) {
  if (typeof input !== 'string' || !input.trim()) {
    return { problem: 'Pass `input`: the command, address or JSON the user gave, as given.' };
  }
  const parsed = parseServerInput(input);
  if (parsed.problem) return { problem: `That is not a server that can be added: ${parsed.problem}` };
  const wanted = typeof name === 'string' && name.trim() ? name.trim() : parsed.name || suggestName(parsed.entry, taken);
  const wrong = nameProblem(wanted, taken);
  if (wrong) {
    return {
      problem: taken.includes(wanted)
        ? `There is already a server called ${wanted}. Pass another \`name\`, or tell the user they can remove it in /mcp.`
        : `"${String(wanted).slice(0, 40)}" cannot be a server name: ${wrong}`,
    };
  }
  return {
    name: wanted,
    entry: parsed.entry,
    ask: planEnv(parsed.entry, env).ask,
    fingerprint: JSON.stringify([wanted, parsed.entry]),
  };
}

const serverNames = (mcp) => mcp.snapshot().servers.map((s) => s.name);

/** What the model is told once it worked: the tools by name, and how to reach them. */
function addedText(name, entry, tools) {
  const names = tools.map((t) => t.name);
  const shown = names.slice(0, TOOL_NAMES_SHOWN).join(', ');
  const more = names.length > TOOL_NAMES_SHOWN ? `, … +${names.length - TOOL_NAMES_SHOWN} more` : '';
  return [
    `Added ${name} to ~/.agent/mcp.json and tested it: it answered with ${names.length} tool${names.length === 1 ? '' : 's'}${shown ? `: ${shown}${more}` : ''}.`,
    `It runs: ${commandLine(entry)}`,
    `Call a tool with mcp_tool {"server": "${name}", "tool": "<tool>", "args": {…}}; mcp_describe {"server": "${name}", "tool": "<tool>"} gives its arguments first.`,
    'Each of its tools asks the user before it runs until they set it to auto in /mcp.',
  ].join('\n');
}

/**
 * @param {{input: string, name?: string}} args
 * @param {{mcp?: object, approval?: object, values?: Object<string, string>, workspace?: string,
 *   signal?: AbortSignal, afterSave?: (name: string) => Promise<void>}} ctx
 */
export async function mcpSetup(args = {}, ctx = {}) {
  if (!ctx.mcp) throw new Error('mcp_setup runs only in the main conversation.');
  if (!consumeApproval(ctx.approval)) {
    throw new Error('Adding a server needs the user\'s yes in the box, and there was none. Nothing was run or saved.');
  }
  const plan = planSetup(args, { taken: serverNames(ctx.mcp) });
  if (plan.problem) throw new Error(plan.problem);

  const values = ctx.values || {};
  const missing = plan.ask.filter((a) => !values[a.key]).map((a) => a.key);
  if (missing.length) {
    throw new Error(`${plan.name} needs ${missing.join(', ')}, which only the user types, and this screen could not ask for it. `
      + 'Nothing was run or saved. Tell them to run /mcp add in the terminal and paste the same thing.');
  }

  const tried = tryServer(plan.name, plan.entry, values, { cwd: ctx.workspace });
  const stop = () => tried.connection?.close();
  ctx.signal?.addEventListener('abort', stop, { once: true });
  let outcome;
  try {
    outcome = await tried.result;
  } finally {
    ctx.signal?.removeEventListener('abort', stop);
  }
  if (ctx.signal?.aborted) throw new Error('Stopped by the user while it was starting. Nothing was saved.');
  if (!outcome.ok) {
    throw new Error(`${plan.name} did not start, so nothing was saved. It said: ${outcome.error}\n`
      + 'If the command or address is wrong, fix it and call mcp_setup again. If something is missing on this '
      + 'computer (a program, a package, a sign-in), tell the user what to do; do not install it unasked.');
  }

  saveServer(plan.name, plan.entry, values);
  await ctx.afterSave?.(plan.name);
  return addedText(plan.name, plan.entry, outcome.tools || []);
}
