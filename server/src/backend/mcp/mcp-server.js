/**
 * MCP Server
 *
 * Registers all filesystem tools and handles tool invocation.
 * Uses a custom in-process transport (not stdio) since we bridge
 * through the WebSocket server to the Chrome Extension.
 */

import { searchFiles } from './tools/search-files.js';
import { grepSearch } from './tools/grep-search.js';
import { findSymbol, findReferences } from './tools/find-symbol.js';
import { queryLog } from './tools/query-log.js';
import { jiraIssue } from './tools/jira-issue.js';
import { readFile } from './tools/read-file.js';
import { editFile } from './tools/edit-file.js';
import { createFile } from './tools/create-file.js';
import { listDirectory } from './tools/list-directory.js';
import { runCommand } from './tools/run-command.js';
import { runBackground } from './tools/run-background.js';
import { manageTask } from './tools/manage-task.js';
import getEditorState from './tools/get-editor-state.js';
import recallHistory from './tools/recall-history.js';
import getDiagnostics from './tools/get-diagnostics.js';
import { logError } from '../core/logs/error-log.js';
import { validateArgs } from './validate-args.js';

// Tool registry with schemas
const TOOL_DEFINITIONS = [
  {
    name: 'search_files',
    description: 'Search for files by name or path pattern using fuzzy matching. Use this to find files in the codebase.',
    parameters: {
      query: { type: 'string', description: 'File name or path pattern to search for', required: true },
      maxResults: { type: 'number', description: 'Maximum number of results to return (default: 20)', required: false },
    },
    handler: searchFiles,
  },
  {
    name: 'grep_search',
    description: 'Search file contents across the codebase, like ripgrep. Results are grouped by file, most matches first. '
      + 'Pass SEVERAL patterns at once when you are not sure what this codebase calls something — ["rate limit", "throttle", "quota"] '
      + 'is one search, not three, and guessing wrong three times in a row costs three round trips. '
      + 'Use contextLines when a bare matching line would not tell you whether it is the right one.',
    parameters: {
      pattern: { type: 'string|array', description: 'Text or regex to find. May also be an array of terms, which are searched together (OR).', required: true },
      isRegex: { type: 'boolean', description: 'If true, every pattern is treated as a regex', required: false },
      includes: { type: 'array', description: 'Globs to restrict the search (e.g. ["*.js", "*.ts"])', required: false },
      maxResults: { type: 'number', description: 'Maximum matches (default 50, max 500)', required: false },
      contextLines: { type: 'number', description: 'Lines of surrounding code to include with each match (0-5, default 0)', required: false },
    },
    handler: grepSearch,
  },
  {
    name: 'find_symbol',
    description: 'Find where a symbol is DEFINED — a class, function, method, or const. '
      + 'Parses the code rather than matching text, so it returns the definition and not the forty call sites, '
      + 'and never the name inside a comment or a string. Use it instead of grep_search whenever you know the '
      + 'exact name and want the definition. JavaScript and JSX are parsed; Ruby, TypeScript, Python, Go, Java, '
      + 'Kotlin, C#, Swift, Scala, Rust, PHP, C/C++, Elixir, Lua and shell are matched by line patterns. '
      + 'It says so when a file could not be read.',
    parameters: {
      name: { type: 'string', description: 'Exact symbol name, case-sensitive', required: true },
    },
    handler: findSymbol,
  },
  {
    name: 'find_references',
    description: 'Find every place a symbol is USED — calls, imports, JSX tags. Parses the code, so a mention '
      + 'in a comment or a same-named object key is not a hit. This is the "who calls this?" and "what breaks if '
      + 'I change this?" question, which grep_search answers badly. Results are grouped by file, busiest first.',
    parameters: {
      name: { type: 'string', description: 'Exact symbol name, case-sensitive', required: true },
      includeDefinition: { type: 'boolean', description: 'Include the definition itself (default true)', required: false },
    },
    handler: findReferences,
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. You can optionally specify a line range to read only a portion. PDF, Word (.docx, .doc), PowerPoint, RTF and ODT are returned as extracted Markdown; other binary files are refused.',
    parameters: {
      path: { type: 'string', description: 'File path (relative to workspace root or absolute)', required: true },
      startLine: { type: 'number', description: 'Start line (1-indexed, inclusive)', required: false },
      endLine: { type: 'number', description: 'End line (1-indexed, inclusive)', required: false },
    },
    handler: readFile,
  },
  {
    name: 'query_log',
    description: 'Ask questions of a log file or export (JSON, NDJSON, CSV/TSV, text, gzipped; Grafana, Loki, '
      + 'Datadog, Kibana). Reads the whole file as a stream however large. With only a path: time range, levels, '
      + 'errors over time, repeated messages and fields. Then filter with where/text/from/to, count with groupBy, '
      + 'or see what led up to a record with around.',
    parameters: {
      path: { type: 'string', description: 'The log file', required: true },
      where: { type: 'array', description: 'Filters, all must hold: field=value, field!=value, field~regex, field>=n, field=*', required: false },
      text: { type: 'string', description: 'Regex over the message, then the whole record', required: false },
      from: { type: 'string', description: 'ISO time, inclusive', required: false },
      to: { type: 'string', description: 'ISO time, inclusive', required: false },
      groupBy: { type: 'string', description: 'A field, "message" or "time"', required: false },
      around: { type: 'string|number', description: 'A record number (#1234) or a time', required: false },
      context: { type: 'number', description: 'Records each side of around (default 5)', required: false },
      fields: { type: 'array', description: 'Fields to show per record; ["*"] for all', required: false },
      limit: { type: 'number', description: 'Records to list (default 20, max 100)', required: false },
      offset: { type: 'number', description: 'Records to skip, for paging', required: false },
      format: { type: 'string', description: 'json | ndjson | csv | tsv | text, when detection is wrong', required: false },
    },
    handler: queryLog,
  },
  {
    // v8.1: offered by prompt versions with `jira` (v4), and only once a site
    // is set up. Writes ask every time: core/policy/external-approval.js.
    name: 'jira_issue',
    description: 'Read, search, create, update, comment on, move and attach files to Jira issues, on the '
      + 'site the user signed in to. Text is Markdown both ways. Every write is shown to the user and sent only '
      + 'if they approve it.',
    parameters: {
      action: { type: 'string', description: 'get | search | create | update | comment | transition | attach', required: true },
      key: { type: 'string', description: 'Issue key, e.g. PROJ-123 (get, update, comment, transition, attach)', required: false },
      jql: { type: 'string', description: 'JQL for search', required: false },
      limit: { type: 'number', description: 'search: issues to list (default 20, max 50)', required: false },
      project: { type: 'string', description: 'create: project key', required: false },
      type: { type: 'string', description: 'create: issue type name (Story, Bug, Task, …)', required: false },
      summary: { type: 'string', description: 'create/update: the title', required: false },
      description: { type: 'string', description: 'create/update: Markdown; on update it replaces the whole description', required: false },
      labels: { type: 'string|array', description: 'create/update: labels; on update they replace the existing ones', required: false },
      priority: { type: 'string', description: 'create/update: priority name', required: false },
      parent: { type: 'string', description: 'create/update: parent or epic key', required: false },
      assignee: { type: 'string', description: 'create/update: "me", "none", a name or an email', required: false },
      body: { type: 'string', description: 'comment: Markdown', required: false },
      to: { type: 'string', description: 'transition: the status to move to', required: false },
      files: { type: 'string|array', description: 'attach: local file paths (under 10 MB each)', required: false },
    },
    handler: jiraIssue,
  },
  {
    name: 'edit_file',
    description: 'Propose edits to an existing file. Each edit specifies old text to find and new text to replace it with. Depending on the mode and the file, the edit is either applied straight away or shown to the user as a diff to approve. The result tells you which happened — report that, never assume it is waiting for approval.',
    parameters: {
      path: { type: 'string', description: 'File path to edit', required: true },
      edits: {
        type: 'array',
        description: 'Array of edits. Each edit has { oldText: string, newText: string }',
        required: false,
      },
      append: {
        type: 'string',
        description: 'Text to add at the end of the file, with no matching. For building a document section by section.',
        required: false,
      },
    },
    handler: editFile,
  },
  {
    name: 'create_file',
    description: 'Create a new file with the specified content. Parent directories will be created automatically. Depending on the mode and the file, it is either written straight away or shown to the user to approve. The result tells you which happened — report that, never assume it is waiting for approval.',
    parameters: {
      path: { type: 'string', description: 'File path to create', required: true },
      content: { type: 'string', description: 'File content', required: true },
    },
    handler: createFile,
  },
  {
    name: 'list_directory',
    description: 'List the contents of a directory. Shows files and subdirectories with their sizes.',
    parameters: {
      path: { type: 'string', description: 'Directory path (default: workspace root)', required: false },
      recursive: { type: 'boolean', description: 'If true, list recursively', required: false },
      maxDepth: { type: 'number', description: 'Max depth for recursive listing (default: 3)', required: false },
    },
    handler: listDirectory,
  },
  {
    name: 'run_command',
    description: 'Execute a shell command. ALWAYS requires user approval. Use for running tests, builds, installs, etc.',
    parameters: {
      command: { type: 'string', description: 'The shell command to execute', required: true },
      cwd: { type: 'string', description: 'Working directory (default: workspace root)', required: false },
      timeout: { type: 'number', description: 'Timeout in seconds (default: 30)', required: false },
    },
    handler: runCommand,
  },
  {
    name: 'run_background',
    description: 'Spawn a long-running background process (dev servers, watchers, builds). Returns immediately with a taskId. Use manage_task to interact with it.',
    parameters: {
      command: { type: 'string', description: 'The shell command to execute', required: true },
      cwd: { type: 'string', description: 'Working directory (default: workspace root)', required: false },
    },
    handler: runBackground,
  },
  {
    name: 'manage_task',
    description: 'Interact with background tasks. Actions: status (check if running), read_logs (read output), send_input (send stdin text), kill (terminate), list (show all tasks), watch (be woken automatically when the task logs a failure — use this after starting a dev server or watcher so you find out it broke without polling), unwatch (stop).',
    parameters: {
      action: { type: 'string', description: 'Action: status, read_logs, send_input, kill, list, watch, unwatch', required: true },
      taskId: { type: 'string', description: 'Task ID (required for all actions except list)', required: false },
      lines: { type: 'number', description: 'Number of log lines to read (default: 50)', required: false },
      input: { type: 'string', description: 'Text to send to stdin (required for send_input)', required: false },
      pattern: { type: 'string', description: 'For watch: a regex to look for in the output. Omit to use the built-in failure patterns (error, failed, exception, traceback, EADDRINUSE, Cannot find module, ...).', required: false },
    },
    handler: manageTask,
  },
  {
    name: recallHistory.name,
    description: recallHistory.description,
    parameters: recallHistory.schema.properties,
    handler: recallHistory.execute,
  },
  {
    name: getEditorState.name,
    description: getEditorState.description,
    parameters: getEditorState.schema.properties,
    handler: getEditorState.execute,
  },
  {
    name: getDiagnostics.name,
    description: getDiagnostics.description,
    parameters: getDiagnostics.schema.properties,
    handler: getDiagnostics.execute,
  },
];

export class MCPServer {
  constructor(workspace, diffEngine) {
    this.workspace = workspace;
    this.diffEngine = diffEngine;
    this.tools = new Map();

    // Register all tools
    for (const def of TOOL_DEFINITIONS) {
      this.tools.set(def.name, def);
    }
  }

  /**
   * Get all tool definitions (for prompt building).
   */
  getToolDefinitions() {
    return TOOL_DEFINITIONS.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  /**
   * Execute a tool call.
   *
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments
   * @param {object} context - Execution context { workspace, diffEngine, callbacks }
   * @returns {Promise<{ success: boolean, result: any, error?: string }>}
   */
  async executeTool(name, args, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}. Available tools: ${[...this.tools.keys()].join(', ')}`,
      };
    }

    // The schema below is the one the prompt showed the model as the contract,
    // and until now nothing checked the call against it — a wrong-typed argument
    // reached the handler and failed inside it with a message written for a
    // stack trace. There is no tool-call API here to do this, so this is the
    // layer that has to. It also coerces "10" to 10, which is a working turn
    // that used to be thrown away. See ./validate-args.js.
    const checked = validateArgs(name, tool.parameters, args);
    if (!checked.ok) {
      logError(this.workspace, {
        flow: 'tool',
        // The diagnosis has to be *on* the first line, because that is all any
        // reader keeps: `logError` slices `message` at the newline, and `/logs`
        // does the same to `detail` when it draws it. This used to log
        // `checked.message.split('\n')[0]` — the headline, which is the
        // identical sentence for every bad call to every tool. Six
        // `grep_search:bad_args` records accumulated in this repo's own log
        // and not one of them said which argument was wrong, so the cause had
        // to be recovered from commit timestamps instead of from the log
        // written to answer exactly that.
        //
        // It also un-collapses them: `logError` keys its 60s repeat window on
        // the message, so two different mistakes a minute apart used to count
        // as one failure twice.
        op: `${name}:bad_args`,
        message: checked.problems?.length
          ? checked.problems.join('; ')
          : checked.message.split('\n')[0],
        meta: { args: Object.keys(args || {}) },
      });
      return { success: false, error: checked.message };
    }
    const validArgs = checked.value;

    let retries = 0;
    let lastErr = null;

    while (retries < 3) {
      try {
        const result = await tool.handler(validArgs, {
          workspace: this.workspace,
          diffEngine: this.diffEngine,
          ...context,
        });
        return { success: true, result };
      } catch (err) {
        lastErr = err;
        // Only retry on transient OS-level file errors
        if (['EBUSY', 'EACCES', 'EAGAIN', 'EMFILE', 'EPERM'].includes(err.code)) {
          retries++;
          // Exponential backoff: 500ms, 1000ms, 2000ms
          await new Promise(r => setTimeout(r, 250 * Math.pow(2, retries)));
          continue;
        }
        break; // Non-retriable error
      }
    }

    // Every tool failure is written down, whether or not the model recovers
    // from it. A tool that fails often is a tool whose description is wrong or
    // whose arguments the model keeps guessing — that pattern is invisible if
    // only the give-ups are recorded.
    logError(this.workspace, {
      flow: 'tool',
      op: name,
      message: lastErr.message,
      detail: lastErr.stack,
      meta: { code: lastErr.code, retries, args: Object.keys(args || {}) },
    });

    // Format OS errors into human-readable instructions for the LLM
    let errorMsg = lastErr.message;
    if (lastErr.code === 'EACCES' || lastErr.code === 'EPERM') {
      errorMsg = `Permission denied. The file is locked by the OS and may be open in another process. Please ask the user to close it or fix permissions.`;
    } else if (lastErr.code === 'EBUSY') {
      errorMsg = `The file is currently busy/locked by another process (like a dev server). Please try again or ask the user.`;
    } else if (lastErr.code === 'ENOENT') {
      errorMsg = `The file or directory does not exist. Double-check the path.`;
    } else if (lastErr.code === 'EBADF' && lastErr.syscall === 'spawn') {
      // The command never started: macOS refuses to spawn once the agent holds
      // a descriptor past OPEN_MAX. Retrying cannot help and neither can a
      // different command — without this the model retried with variations
      // and then reported the user's script as broken.
      errorMsg = 'The agent could not start any process (spawn EBADF: it holds too many open '
        + 'files). This is not a problem with the command. Do not retry or try variations — tell '
        + 'the user to restart the agent, and continue with what does not need a shell.';
    }

    return {
      success: false,
      error: `Tool ${name} failed: ${errorMsg}`,
    };
  }

  /**
   * List available tools (for debugging / status).
   */
  listTools() {
    return [...this.tools.keys()];
  }
}
