/**
 * The set of MCP servers for this run (v9.0).
 *
 * Nothing starts until something asks: `/mcp` today, a tool call from v9.1.
 * Starting them at launch would put a person's slowest `npx` in front of every
 * session, and `startup-order.test.js` exists to stop exactly that.
 *
 * What was last seen goes in `~/.agent/mcp-cache.json`, keyed on the entry's
 * fingerprint, so a list can be shown before its server has answered and an
 * edited entry does not show the old one's tools. It holds names and
 * descriptions, never the env.
 *
 * Children die with us. stdin closing ends a well-behaved server, but `exit` is
 * the one hook every way out reaches and a child left running is a process the
 * person never asked to keep, so each pid is killed there too.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homeDir } from '../../core/workspace/paths.js';
import { logError } from '../../core/logs/error-log.js';
import { loadMcpConfig } from './config.js';
import { McpConnection, McpSdkMissing } from './connection.js';

export const mcpCachePath = () => join(homeDir(), 'mcp-cache.json');

function readCache(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  } catch {
    return {}; // only a cache: a bad one costs a reconnect
  }
}

function writeCache(path, cache) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    renameSync(temp, path);
  } catch { /* the next look reconnects */ }
}

export class McpServers {
  /**
   * @param {{workspace?: string, load?: Function, connection?: Function, cachePath?: string}} [opts]
   */
  constructor({
    workspace,
    load = loadMcpConfig,
    connection = (server, opts) => new McpConnection(server, opts),
    cachePath = mcpCachePath(),
  } = {}) {
    this.workspace = workspace;
    this.load = load;
    this.connection = connection;
    this.cachePath = cachePath;
    this.live = new Map();      // name -> { state, connection, tools, error, fingerprint }
    this.listeners = new Set();
    this.config = load();
    this.cache = readCache(cachePath);
    this._killOnExit = () => this.killAll();
    process.on('exit', this._killOnExit);
  }

  /** Called on every change of state, so an open menu can redraw. */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _changed() {
    for (const fn of this.listeners) {
      try { fn(); } catch { /* a screen must not stop a server */ }
    }
  }

  /** What `/mcp` draws: pure data, with no env in it. */
  snapshot() {
    const servers = this.config.servers.map((server) => {
      const live = this.live.get(server.name);
      const cached = this.cache[server.name]?.fingerprint === server.fingerprint ? this.cache[server.name] : null;
      const state = server.problem ? 'invalid'
        : server.disabled ? 'disabled'
          : live?.fingerprint === server.fingerprint ? live.state : 'idle';
      return {
        name: server.name,
        source: server.source,
        transport: server.transport || null,
        state,
        error: server.problem || (state === 'failed' ? live?.error : null) || null,
        sdkMissing: state === 'failed' && Boolean(live?.sdkMissing),
        tools: (state === 'ready' ? live.tools : cached?.tools) || [],
        toolsStale: state !== 'ready' && Boolean(cached),
      };
    });
    return {
      path: this.config.path,
      exists: this.config.exists,
      error: this.config.error,
      servers,
    };
  }

  /** Start one server and list its tools. Safe to call twice: the first call is the one that runs. */
  connect(name) {
    const server = this.config.servers.find((s) => s.name === name);
    if (!server || server.problem || server.disabled) return Promise.resolve(false);
    const live = this.live.get(name);
    if (live?.fingerprint === server.fingerprint && live.starting) return live.starting;
    if (live?.fingerprint === server.fingerprint && live.state === 'ready') return Promise.resolve(true);
    const entry = { state: 'connecting', fingerprint: server.fingerprint, tools: [], error: null };
    entry.starting = this._start(server, entry).finally(() => { entry.starting = null; });
    this.live.set(name, entry);
    this._changed();
    return entry.starting;
  }

  async _start(server, entry) {
    const connection = this.connection(server, { cwd: this.workspace });
    entry.connection = connection;
    try {
      await connection.connect();
      const tools = await connection.listTools();
      entry.state = 'ready';
      entry.tools = tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
      connection.onClose = () => {
        if (this.live.get(server.name) !== entry || entry.state !== 'ready') return;
        entry.state = 'failed';
        entry.error = connection.describeFailure(new Error('the server stopped'));
        this._changed();
      };
      this.cache[server.name] = {
        fingerprint: server.fingerprint,
        tools: entry.tools,
        seen: new Date().toISOString(),
      };
      writeCache(this.cachePath, this.cache);
      return true;
    } catch (err) {
      entry.state = 'failed';
      entry.error = err.message;
      entry.sdkMissing = err instanceof McpSdkMissing;
      await connection.close();
      logError(this.workspace, { flow: 'tool', op: 'mcp_connect', message: `${server.name}: ${err.message}` });
      return false;
    } finally {
      this._changed();
    }
  }

  /** Start everything enabled. Slow servers do not hold each other up. */
  connectAll() {
    return Promise.all(this.config.servers.map((s) => this.connect(s.name)));
  }

  /** Read the file again and start over: what `/mcp reload` does. */
  async reload() {
    await this.closeAll();
    this.config = this.load();
    this.cache = readCache(this.cachePath);
    this._changed();
    return this.connectAll();
  }

  async closeAll() {
    const entries = [...this.live.values()];
    this.live.clear();
    await Promise.all(entries.map((e) => e.connection?.close()));
  }

  /** Synchronous, for `exit`: no awaiting anything from here. */
  killAll() {
    for (const { connection } of this.live.values()) {
      const pid = connection?.pid;
      if (!pid) continue;
      try { process.kill(pid); } catch { /* already gone */ }
    }
  }

  /** For tests: stop holding the process hook. */
  dispose() {
    process.off('exit', this._killOnExit);
    return this.closeAll();
  }
}
