/**
 * The editor chat panel's pure parts: no `vscode` import, so they run under
 * `node --test` (see test/).
 *
 * The panel is the Chrome side panel's own page — `panel.html`, `panel.js`,
 * `panel.css`, copied in at package time by `scripts/sync-panel.js` — with a
 * shim in front of it that answers `chrome.runtime` over the agent's
 * WebSocket. One renderer for both surfaces: every message type the side
 * panel handles, including the two requests a turn parks on, works here
 * without a second copy that could forget one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must match AGENT_DIR in server/src/backend/core/workspace/paths.js
const AGENT_DIR = '.agent';

/**
 * Buttons that mean nothing inside an editor.
 *
 * Dock and pop-out move the Chrome panel between Chrome surfaces. The
 * workspace button asks for a path with `window.prompt`, which webviews do not
 * provide — and in an editor the workspace is the folder that is open.
 * `panel.js` guards every one of these with `if (!btn) return`, so removing
 * the markup is enough.
 */
const EDITOR_ABSENT_BUTTONS = ['dock-btn', 'popout-btn', 'workspace-btn'];

/**
 * The panel's colours, re-pointed at the editor's theme.
 *
 * `panel.css` is a fixed dark palette, right for Chrome and wrong in a light
 * VS Code theme. Its colours are all variables on `:root`, so mapping them is
 * the whole job; nothing in `panel.css` changes.
 */
const THEME_BRIDGE = `
:root {
  --bg: var(--vscode-sideBar-background, #1e1e1e);
  --bg-raised: var(--vscode-input-background, #26272c);
  --bg-sunken: var(--vscode-textCodeBlock-background, #18181b);
  --bg-hover: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.15));
  --border: var(--vscode-input-border, var(--vscode-widget-border, #36383f));
  --border-subtle: var(--vscode-widget-border, var(--vscode-panel-border, #2b2c31));
  --text: var(--vscode-foreground, #e6e6e6);
  --muted: var(--vscode-descriptionForeground, #9ba1b8);
  --faint: color-mix(in srgb, var(--vscode-descriptionForeground, #9ba1b8) 78%, transparent);
  --accent: var(--vscode-focusBorder, #7aa2f7);
  --link: var(--vscode-textLink-foreground, #7dcfff);
  --attention: var(--vscode-editorWarning-foreground, #ff9e64);
  --danger: var(--vscode-errorForeground, #f7768e);
  --success: var(--vscode-testing-iconPassed, #9ece6a);
  --plan: var(--vscode-charts-yellow, #e0af68);
  --auto: var(--vscode-charts-green, #73daca);
  --strict: var(--vscode-charts-purple, #bb9af7);
  --add-bg: var(--vscode-diffEditor-insertedLineBackground, #132a1f);
  --del-bg: var(--vscode-diffEditor-removedLineBackground, #2d1a1d);
  --on-accent: var(--vscode-button-foreground, #16161a);
  --font-ui: var(--vscode-font-family, -apple-system, sans-serif);
  --font-mono: var(--vscode-editor-font-family, Menlo, monospace);
}
#send-btn.ready, .diff-btn.accept, .question-actions .question-submit {
  background: var(--vscode-button-background, var(--accent));
  border-color: var(--vscode-button-background, var(--accent));
}`;

/**
 * The agent's state directory for a workspace — where it reads `editor.json`
 * and writes `bridge.json`.
 *
 * A port of `resolveState` + `agentDir` in `server/src/backend/core/workspace/paths.js`: walk up
 * from the workspace to the first existing `.agent`, the way git finds `.git`;
 * the path from there down is the scope. Not found means `<workspace>/.agent`.
 *
 * The companion used `<workspace>/.agent/state` unconditionally, which is the
 * same answer for an ordinary repo and the wrong one in a monorepo, where the
 * CLI reads `/base/.agent/repo-1/state`. So in that layout every file this
 * extension wrote — editor state, diagnostics, the chat queue, plan reviews —
 * went where nothing read it, and the chat panel could not find the bridge.
 * Found when the harness's own scratch folder sat under a stray `.agent`.
 *
 * `~/.agent` is the agent's *home*, never a project root, and the walk stops
 * at `$HOME` — adopting either would pool every project's state. A `--scope`
 * flag given at launch cannot be seen from here; that case still resolves to
 * the root.
 */
function agentStateDir(workspace, { home = os.homedir(), agentHome = process.env.AGENT_CLI_HOME } = {}) {
    const ws = path.resolve(workspace);
    const forbidden = new Set([path.join(home, AGENT_DIR), agentHome ? path.resolve(agentHome) : null]);
    // A temp dir's own .agent, as paths.js's tempAgentDirs (1.8.11): on Linux
    // /tmp is shared, and a stray /tmp/.agent was adopted by everything under it.
    for (const tmp of [os.tmpdir(), '/tmp', '/var/tmp']) {
        forbidden.add(path.join(tmp, AGENT_DIR));
        try { forbidden.add(path.join(fs.realpathSync(tmp), AGENT_DIR)); } catch { /* no such dir */ }
    }
    let dir = ws;
    for (let i = 0; i < 64; i++) {
        const candidate = path.join(dir, AGENT_DIR);
        if (!forbidden.has(candidate) && fs.existsSync(candidate)) {
            const scope = path.relative(dir, ws);
            return path.join(scope ? path.join(candidate, scope) : candidate, 'state');
        }
        const parent = path.dirname(dir);
        if (parent === dir || dir === home) break;
        dir = parent;
    }
    return path.join(ws, AGENT_DIR, 'state');
}

/**
 * Turn `panel.html` into the webview's page.
 *
 * @param {string} panelHtml - the Chrome panel's HTML, verbatim
 * @param {{cspSource: string, nonce: string, css: string, panelJs: string,
 *          shimJs: string, version: string}} o - webview URIs as strings
 */
function buildWebviewHtml(panelHtml, o) {
    let html = String(panelHtml);

    for (const id of EDITOR_ABSENT_BUTTONS) {
        html = html.replace(new RegExp(`\\s*<button id="${id}"[^>]*>[\\s\\S]*?</button>`), '');
    }

    /*
     * Scripts only by nonce, so nothing injected into a message can run.
     * `connect-src` names the loopback bridge and nothing else. Styles allow
     * inline because the panel sets `style.height` on its textarea and writes
     * a few style attributes through innerHTML; scripts never get that.
     */
    const csp = [
        "default-src 'none'",
        `style-src ${o.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${o.nonce}'`,
        'connect-src ws://127.0.0.1:*',
        `img-src ${o.cspSource} data:`,
        `font-src ${o.cspSource}`,
    ].join('; ');

    html = html.replace(
        /<head>/i,
        `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`,
    );
    html = html.replace('href="panel.css"', `href="${o.css}"`);
    html = html.replace(
        '</head>',
        `  <style nonce="${o.nonce}">${THEME_BRIDGE}\n  </style>\n</head>`,
    );
    html = html.replace(
        '<script src="panel.js"></script>',
        `<script nonce="${o.nonce}" src="${o.shimJs}" data-version="${escapeAttr(o.version)}"></script>\n`
        + `  <script nonce="${o.nonce}" src="${o.panelJs}"></script>`,
    );
    return html;
}

function escapeAttr(s) {
    return String(s ?? '').replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** Is a process with this pid alive? `kill(pid, 0)` asks without signalling. */
function pidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM'; // alive, just not ours to signal
    }
}

/**
 * Where the running agent's bridge is, or why there is none.
 *
 * `bridge.json` is written by the agent when its socket starts listening and
 * removed when it stops. A crash leaves it behind, which the pid exposes —
 * connecting to a dead port would only look like a slow failure.
 *
 * @returns {{port: number, token: string} | {missing: string}}
 */
function readBridge(file, isAlive = pidAlive) {
    let info;
    try {
        info = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return { missing: 'no-agent' };
    }
    if (!Number.isInteger(info.port) || typeof info.token !== 'string') return { missing: 'unreadable' };
    if (!isAlive(info.pid)) return { missing: 'stale' };
    return { port: info.port, token: info.token };
}

/*
 * The attachment format the CLI already uses for "Add to Agent Chat"
 * (`server/src/ui/chat-queue.js`). Copied, because the companion cannot import
 * from the server; `test/attachment-parity.test.js` imports both and fails if
 * they drift.
 */
function selectionMarker(entry) {
    const name = String(entry.file || 'selection').split('/').pop();
    const range = entry.startLine === entry.endLine
        ? `${entry.startLine}`
        : `${entry.startLine}-${entry.endLine}`;
    return `@${name}:${range}`;
}

function selectionBody(entry) {
    const fence = entry.language ? `\`\`\`${entry.language}` : '```';
    return [
        `${entry.file} (lines ${entry.startLine}-${entry.endLine}):`,
        fence,
        entry.text ?? '',
        '```',
    ].join('\n');
}

/*
 * A file chosen in the system dialog. An image goes in as a pasted one does,
 * because the model has to see it and `read_file` cannot show it; anything else
 * goes by path, as a file dragged from the explorer does, so the model reads the
 * range it needs and a PDF or a large file works. An image too big to paste, or
 * one that cannot be read, falls back to its path rather than being lost.
 */
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_PICKED_IMAGE_BYTES = 10 * 1024 * 1024;

function pickedFile(filePath) {
    const mime = IMAGE_TYPES[path.extname(filePath).toLowerCase()];
    if (!mime) return { path: filePath };
    try {
        const bytes = fs.readFileSync(filePath);
        if (bytes.length > MAX_PICKED_IMAGE_BYTES) return { path: filePath };
        return {
            path: filePath,
            mime,
            sizeKB: Math.max(1, Math.round(bytes.length / 1024)),
            dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
        };
    } catch {
        return { path: filePath };
    }
}

/** The picker's first row: Finder by name where that is what opens. */
function browseLabel(platform = process.platform) {
    return platform === 'darwin' ? 'Browse in Finder…' : 'Browse…';
}

module.exports = {
    browseLabel, pickedFile,
    AGENT_DIR, agentStateDir, EDITOR_ABSENT_BUTTONS, buildWebviewHtml, readBridge, pidAlive, selectionMarker, selectionBody,
};
