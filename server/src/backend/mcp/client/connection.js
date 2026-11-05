/**
 * One MCP server: its process, its handshake, its tool list (v9.0).
 *
 * The SDK is imported here and only here, on first use. It is `optional` in
 * `/doctor`: 6 MB and about twenty packages that a person with no servers never
 * loads, and a machine without it runs normally and `/mcp` names what is missing.
 *
 * **stderr is piped, never inherited.** Ours is Ink's terminal, so a server's
 * startup banner would land on the live frame (`OSASCRIPT_STDIO`, v5.24). The
 * tail is kept to say why a start failed, and goes through `scrub` first.
 *
 * A server sees only the SDK's short list of inherited variables (PATH, HOME…)
 * plus its own `env`, so a token in the agent's environment does not reach it
 * unless the config says so.
 */
import { scrub } from './config.js';

export const CONNECT_TIMEOUT_MS = 60_000; // `npx -y` may have a package to fetch
const MAX_TOOLS = 500;
const STDERR_KEPT = 2000;

export class McpSdkMissing extends Error {}

async function loadSdk() {
  try {
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
    ]);
    return { Client, StdioClientTransport };
  } catch (err) {
    throw new McpSdkMissing(`@modelcontextprotocol/sdk is not installed (${err.code || err.message})`);
  }
}

/** Reject after `ms`, and clear the clock either way. */
function withTimeout(promise, ms, what) {
  let timer;
  const clock = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took more than ${Math.round(ms / 1000)}s`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, clock]).finally(() => clearTimeout(timer));
}

export class McpConnection {
  /**
   * @param {object} server - an entry from `loadMcpConfig`
   * @param {{cwd?: string, timeoutMs?: number, sdk?: () => Promise<object>}} [opts]
   */
  constructor(server, { cwd, timeoutMs = CONNECT_TIMEOUT_MS, sdk = loadSdk } = {}) {
    this.server = server;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.sdk = sdk;
    this.client = null;
    this.transport = null;
    this.stderrTail = '';
    this.onClose = null;
  }

  /** The child's pid, for the kill on exit. */
  get pid() {
    return this.transport?.pid ?? null;
  }

  async connect() {
    const { Client, StdioClientTransport } = await this.sdk();
    const { command, args, env } = this.server;
    this.transport = new StdioClientTransport({ command, args, env, cwd: this.cwd, stderr: 'pipe' });
    this.client = new Client({ name: 'agent-cli', version: '1' });
    this.client.onclose = () => this.onClose?.();
    // Exists from the constructor with `stderr: 'pipe'`, before the child does.
    this.transport.stderr?.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_KEPT);
    });
    try {
      await withTimeout(this.client.connect(this.transport), this.timeoutMs, 'starting');
    } catch (err) {
      await this.close();
      throw new Error(this.describeFailure(err));
    }
  }

  /** One line: what went wrong, with what the server said about it if anything. */
  describeFailure(err) {
    const said = this.stderrTail.trim().split('\n').pop() || '';
    const message = String(err?.message ?? 'it failed');
    // The server's own words go first: this is a row, cut from the right. The
    // SDK's "Connection closed" says only that the process went.
    const raw = /Connection closed/.test(message) ? said || 'it stopped before answering'
      : said && !message.includes(said) ? `${said} · ${message}` : message;
    return scrub(raw.replace(/\s+/g, ' ').trim(), this.server).slice(0, 300);
  }

  /** Every tool, across pages. A server that never ends its pages is cut off. */
  async listTools() {
    const tools = [];
    let cursor;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await withTimeout(this.client.listTools(cursor ? { cursor } : {}), this.timeoutMs, 'listing tools');
      tools.push(...(page.tools || []));
      cursor = page.nextCursor;
    } while (cursor && tools.length < MAX_TOOLS);
    return tools.slice(0, MAX_TOOLS).map((t) => ({
      name: t.name,
      description: scrub(t.description || '', this.server),
      inputSchema: t.inputSchema || null,
    }));
  }

  async close() {
    const { client } = this;
    this.client = null;
    this.onClose = null;
    await client?.close().catch(() => { /* already gone */ });
  }
}
