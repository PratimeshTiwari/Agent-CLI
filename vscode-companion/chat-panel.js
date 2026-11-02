/**
 * The chat panel in the editor's sidebar (companion 1.8.0, agent v5.2).
 *
 * A second front-end on the agent that is already running in a terminal —
 * not a second agent. One loop, one browser lane, one history. A turn started
 * in the terminal streams here live; a turn started here runs in the same
 * conversation, and the terminal draws it when it next merges the loop's
 * history (its next turn) — the same as the Chrome side panel today. If no
 * agent is running for this folder, the panel says so and **Agent CLI: Start
 * Agent** opens one in a terminal.
 *
 * The page is the Chrome side panel's, unchanged; `media/vscode-shim.js`
 * answers its `chrome.runtime` calls over the agent's WebSocket. This file is
 * the host half: it serves the page and does the things a webview cannot —
 * reading `bridge.json`, opening diffs, picking files, starting the agent.
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildWebviewHtml, readBridge, selectionMarker, selectionBody, agentStateDir } = require('./chat-panel-html.js');

/*
 * Two homes for one view (1.8.10), the way Claude Code's extension does it:
 * the secondary side bar (right) where the editor supports it — VS Code 1.106
 * and later, which includes Antigravity IDE — else the activity bar. Each is a
 * container whose `when` reads `agentCli:noSecondarySidebar`, set below, so
 * exactly one shows. Asked with a screenshot: in Antigravity the activity-bar
 * icon was nowhere to be seen and only the shortcut found the chat.
 */
const VIEW_ID = 'agentCli.chat';
const SECONDARY_VIEW_ID = 'agentCli.chatSecondary';
const OPENED_ONCE_KEY = 'agentCli.chatOpenedOnce';

/** Whether this editor has a secondary side bar for extensions (VS Code 1.106+). */
function supportsSecondarySidebar(version) {
    const [major = 0, minor = 0] = String(version || '').split('.').map(Number);
    return major > 1 || (major === 1 && minor >= 106);
}
const PROPOSED_SCHEME = 'agent-cli-proposed';
/** Large enough for any source file worth attaching; small enough not to type a bundle into a browser. */
const MAX_ATTACH_BYTES = 200 * 1024;

function registerChatPanel(context, { workspaceRoot, AGENT_DIR }) {
    const sub = (...items) => context.subscriptions.push(...items);
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const version = context.extension?.packageJSON?.version || '';
    let view = null;
    let offeredStart = false;

    const post = (message) => view?.webview.postMessage(message);
    const bridgeFile = () => {
        const root = workspaceRoot();
        return root ? path.join(agentStateDir(root), 'bridge.json') : null;
    };

    // ── The page ──────────────────────────────────────────────────────
    function html(webview) {
        const panelDir = vscode.Uri.joinPath(media, 'panel');
        let panelHtml;
        try {
            panelHtml = fs.readFileSync(path.join(panelDir.fsPath, 'panel.html'), 'utf8');
        } catch {
            // `scripts/sync-panel.js` copies the side panel in at package time.
            return '<body style="font-family:sans-serif;padding:1em">The chat panel files are missing from '
                + 'this build. Repackage the companion: <code>vsce package</code> runs '
                + '<code>scripts/sync-panel.js</code> first.</body>';
        }
        const uri = (...p) => webview.asWebviewUri(vscode.Uri.joinPath(...p)).toString();
        return buildWebviewHtml(panelHtml, {
            cspSource: webview.cspSource,
            nonce: crypto.randomBytes(16).toString('base64'),
            css: uri(panelDir, 'panel.css'),
            panelJs: uri(panelDir, 'panel.js'),
            shimJs: uri(media, 'vscode-shim.js'),
            version,
        });
    }

    const secondary = supportsSecondarySidebar(vscode.version);
    const activeViewId = secondary ? SECONDARY_VIEW_ID : VIEW_ID;
    vscode.commands.executeCommand('setContext', 'agentCli:noSecondarySidebar', !secondary);

    const provider = {
        resolveWebviewView(webviewView) {
            view = webviewView;
            webviewView.webview.options = { enableScripts: true, localResourceRoots: [media] };
            webviewView.webview.html = html(webviewView.webview);
            webviewView.webview.onDidReceiveMessage(onMessage);
            webviewView.onDidDispose(() => { if (view === webviewView) view = null; });
        },
    };
    for (const id of [VIEW_ID, SECONDARY_VIEW_ID]) {
        sub(vscode.window.registerWebviewViewProvider(id, provider, {
            // The socket lives in the page. Without this, hiding the sidebar would
            // drop the connection and a long turn's stream with it.
            webviewOptions: { retainContextWhenHidden: true },
        }));
    }

    // Always findable: a status-bar entry opens the chat in every editor,
    // whatever its side bars show.
    const statusItem = vscode.window.createStatusBarItem?.(vscode.StatusBarAlignment?.Right ?? 2, 100);
    if (statusItem) {
        statusItem.text = '$(comment-discussion) Agent CLI';
        statusItem.tooltip = 'Open the Agent CLI chat (⌥⌘J)';
        statusItem.command = 'agentCli.focusChat';
        statusItem.show();
        sub(statusItem);
    }

    // Shown once after install, so the first look says where it lives.
    if (context.globalState && !context.globalState.get(OPENED_ONCE_KEY)) {
        context.globalState.update(OPENED_ONCE_KEY, true);
        Promise.resolve(vscode.commands.executeCommand(`${activeViewId}.focus`)).catch(() => {});
    }

    // ── Requests from the page ────────────────────────────────────────
    function onMessage(message) {
        switch (message?.type) {
            case 'need_bridge': {
                const file = bridgeFile();
                const found = file ? readBridge(file) : { missing: 'no-folder' };
                post({ type: 'bridge', payload: found });
                if (found.missing && found.missing !== 'no-folder' && !offeredStart) {
                    offeredStart = true;
                    vscode.window.showInformationMessage(
                        'Agent CLI: no agent is running for this folder.', 'Start agent',
                    ).then((choice) => { if (choice) startAgent(); });
                }
                break;
            }
            case 'show_diff':
                openDiff(message.payload).catch((err) => {
                    vscode.window.showWarningMessage(`Agent CLI: could not open the diff — ${err.message}`);
                });
                break;
            case 'pick_file':
                pickAttachment();
                break;
            default:
                break;
        }
    }

    // ── Diffs in the editor ───────────────────────────────────────────
    //
    // The proposed file lives only in memory until it is accepted, so it is
    // served from a content provider under its own scheme. The left side is
    // the file on disk, which in plan mode is still the original.
    const proposed = new Map(); // diffId -> { content, filePath }
    const proposedChanged = new vscode.EventEmitter();
    sub(vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, {
        onDidChange: proposedChanged.event,
        provideTextDocumentContent: (uri) => (uri.path === '/empty' ? '' : proposed.get(uri.query)?.content ?? ''),
    }));

    async function openDiff(p) {
        if (!p || typeof p.newContent !== 'string' || !p.absPath) return; // an older agent: the panel still has the patch
        proposed.set(p.diffId, { content: p.newContent, filePath: p.filePath });
        const left = p.isNewFile
            ? vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: '/empty' })
            : vscode.Uri.file(p.absPath);
        const right = vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: `/${p.filePath}`, query: p.diffId });
        await vscode.commands.executeCommand('vscode.diff', left, right, `${p.filePath} ↔ proposed by the agent`, { preview: true });
    }

    function decideActiveDiff(action) {
        const uri = vscode.window.activeTextEditor?.document?.uri;
        const diffId = uri?.scheme === PROPOSED_SCHEME ? uri.query : null;
        if (!diffId || !proposed.has(diffId)) {
            vscode.window.showWarningMessage('Agent CLI: this is not a pending agent diff.');
            return;
        }
        // Through the page, so its card updates and it sends the answer —
        // one path for the decision whichever button was pressed.
        post({ type: 'diff_decision', payload: { diffId, action } });
        proposed.delete(diffId);
        vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }

    sub(
        vscode.commands.registerCommand('agentCli.acceptDiff', () => decideActiveDiff('accept')),
        vscode.commands.registerCommand('agentCli.rejectDiff', () => decideActiveDiff('reject')),
    );

    // ── @ attachments ─────────────────────────────────────────────────
    async function pickAttachment() {
        const root = workspaceRoot();
        if (!root) return;
        const items = [];

        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty && editor.document.uri.scheme === 'file') {
            const s = editor.selection;
            items.push({
                label: `$(selection) Selection in ${path.basename(editor.document.fileName)}`,
                description: `lines ${s.start.line + 1}-${s.end.line + 1}`,
                selection: true,
            });
        }

        const files = await vscode.workspace.findFiles('**/*', `**/{node_modules,.git,${AGENT_DIR}}/**`, 5000);
        for (const f of files.sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
            items.push({ label: path.relative(root, f.fsPath), uri: f });
        }

        const choice = await vscode.window.showQuickPick(items, {
            placeHolder: 'Attach a file or the current selection',
            matchOnDescription: true,
        });
        if (!choice) return;

        let entry;
        if (choice.selection) {
            const doc = editor.document;
            const s = editor.selection;
            entry = {
                file: path.relative(root, doc.uri.fsPath),
                startLine: s.start.line + 1,
                endLine: s.end.line + 1,
                text: doc.getText(s),
                language: doc.languageId,
            };
        } else {
            const stat = fs.statSync(choice.uri.fsPath);
            if (stat.size > MAX_ATTACH_BYTES) {
                vscode.window.showWarningMessage(
                    `Agent CLI: ${choice.label} is ${Math.round(stat.size / 1024)} KB — too large to type into the browser. `
                    + 'Select the part you need and attach the selection instead.',
                );
                return;
            }
            const doc = await vscode.workspace.openTextDocument(choice.uri);
            entry = {
                file: choice.label,
                startLine: 1,
                endLine: doc.lineCount,
                text: doc.getText(),
                language: doc.languageId,
            };
        }
        post({ type: 'insert', payload: { marker: selectionMarker(entry), body: selectionBody(entry) } });
    }

    // ── Starting the agent, and getting to the panel ──────────────────
    function startAgent() {
        const root = workspaceRoot();
        if (!root) {
            vscode.window.showWarningMessage('Agent CLI: open a folder first.');
            return;
        }
        // `agent` takes its workspace from the directory it starts in. The
        // panel's retry loop picks the bridge up once the agent writes it.
        const terminal = vscode.window.createTerminal({ name: 'Agent CLI', cwd: root });
        terminal.show();
        terminal.sendText('agent');
    }

    sub(
        vscode.commands.registerCommand('agentCli.startAgent', startAgent),
        vscode.commands.registerCommand('agentCli.focusChat', async () => {
            await vscode.commands.executeCommand(`${activeViewId}.focus`);
            post({ type: 'focus_input' });
        }),
    );
}

module.exports = { registerChatPanel, PROPOSED_SCHEME, supportsSecondarySidebar };
