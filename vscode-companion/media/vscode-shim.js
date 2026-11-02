/**
 * `chrome.runtime`, answered over the agent's WebSocket.
 *
 * Loaded before the Chrome side panel's own `panel.js`, unchanged, inside a
 * VS Code webview. In Chrome that page talks to the extension's service
 * worker, which relays to the agent; here there is no worker, so this stands
 * in for the four things the page uses — `sendMessage`, `onMessage`, `id` and
 * `getManifest` — and speaks to the agent directly.
 *
 * The page cannot tell. That is the point: one renderer for both surfaces, so
 * a request type handled in one cannot be forgotten in the other — a panel
 * that ignores a request deadlocks the turn waiting on it.
 *
 * The socket lives here and not in the extension host because the host is
 * Node without a WebSocket client, and the companion has no dependencies.
 * The host does what a page cannot: read `bridge.json` for the port and
 * token, open diffs in the editor, pick files.
 */
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const VERSION = (document.currentScript && document.currentScript.dataset.version) || '';
    const listeners = [];
    /** Marker typed into the box → the text the model receives instead. */
    const attachments = new Map();

    let ws = null;
    let open = false;
    let bridge = null;
    let retryMs = 500;
    let retryTimer = null;
    let toldMissing = null;

    const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

    function deliver(message) {
        for (const fn of listeners) {
            try { fn(message, {}, () => {}); } catch (err) { console.error('[agent panel]', err); }
        }
    }

    /** Ask the host where the agent is, after a growing pause. */
    function askForBridgeSoon() {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => vscode.postMessage({ type: 'need_bridge' }), retryMs);
        retryMs = Math.min(retryMs * 2, 10000);
    }

    function connect() {
        if (!bridge || ws) return;
        const sock = new WebSocket(`ws://127.0.0.1:${bridge.port}/?token=${encodeURIComponent(bridge.token)}`);
        ws = sock;
        sock.onopen = () => {
            open = true;
            retryMs = 500;
            toldMissing = null;
            // `editor`, never `extension`: an extension is sent `inject_prompt`,
            // and a panel handed the user's prompt has nowhere to type it.
            sock.send(JSON.stringify({
                id: rid(), type: 'identify', timestamp: Date.now(),
                payload: { clientType: 'editor', version: VERSION },
            }));
            deliver({ type: 'connection_status', payload: { connected: true } });
        };
        sock.onmessage = (event) => {
            let message;
            try { message = JSON.parse(event.data); } catch { return; }
            // The panel draws the diff and owns Accept/Reject; the editor
            // additionally shows it the way every other diff is shown.
            if (message.type === 'diff_request') vscode.postMessage({ type: 'show_diff', payload: message.payload });
            deliver(message);
        };
        sock.onclose = () => {
            const was = open;
            open = false;
            ws = null;
            // The agent may come back on another port; ask again rather than
            // redialling the old one.
            bridge = null;
            if (was) deliver({ type: 'connection_status', payload: { connected: false } });
            askForBridgeSoon();
        };
        sock.onerror = () => { /* onclose follows and handles it */ };
    }

    function expand(text) {
        let out = text;
        for (const [marker, body] of attachments) out = out.split(marker).join(body);
        return out;
    }

    function sendMessage(message) {
        const type = message && message.type;
        // Answered here, as the service worker answers them in Chrome.
        if (type === 'get_status') return Promise.resolve({ success: true, connected: open });
        if (type === 'connect') {
            if (!ws) vscode.postMessage({ type: 'need_bridge' });
            return Promise.resolve({ success: true });
        }
        if (!open) return Promise.resolve({ success: false, error: 'not connected' });

        let out = message;
        if (type === 'user_message' && attachments.size > 0) {
            // The transcript keeps the short marker, as the terminal does; the
            // model gets what it stands for.
            out = { ...message, payload: { ...message.payload, content: expand(message.payload?.content || '') } };
            attachments.clear();
        }
        ws.send(JSON.stringify({ id: rid(), timestamp: Date.now(), ...out }));
        return Promise.resolve({ success: true });
    }

    const runtime = {
        id: 'vscode-editor-panel',
        getManifest: () => ({ version: VERSION }),
        getURL: (p) => p,
        sendMessage,
        onMessage: { addListener: (fn) => listeners.push(fn) },
    };
    window.chrome = Object.assign(window.chrome || {}, { runtime });

    // The panel's paperclip asks the editor (1.8.10): its picker offers the
    // workspace's files and the selection, which a webview cannot list.
    window.__agentPickFiles = () => vscode.postMessage({ type: 'pick_file' });

    /** Replace the `@` that opened the picker with the marker, and remember what it means. */
    function insertAttachment({ marker, body }) {
        const input = document.getElementById('command-input');
        if (!input || !marker) return;
        const caret = input.selectionStart ?? input.value.length;
        const at = caret > 0 && input.value[caret - 1] === '@' ? caret - 1 : -1;
        const before = at === -1 ? input.value : input.value.slice(0, at);
        const after = at === -1 ? '' : input.value.slice(caret);
        const spacer = before && !/\s$/.test(before) ? ' ' : '';
        input.value = `${before}${spacer}${marker} ${after}`;
        attachments.set(marker, body);
        input.focus();
        input.dispatchEvent(new Event('input')); // let the panel resize and light the send button
    }

    window.addEventListener('message', (event) => {
        const m = event.data || {};
        if (m.type === 'bridge') {
            if (m.payload && m.payload.port) {
                bridge = m.payload;
                connect();
            } else {
                // Said once per reason, not on every retry.
                const reason = m.payload && m.payload.missing;
                if (reason && reason !== toldMissing) {
                    toldMissing = reason;
                    // Plain words: a one-line status is not rendered, so
                    // `**…**` showed its asterisks (1.8.10). `kind` lets the
                    // panel remove the line once the agent connects.
                    deliver({ type: 'status', payload: { kind: 'no_agent', message: reason === 'stale'
                        ? 'The agent for this folder has stopped. Run agent in a terminal, or Agent CLI: Start Agent from the command palette.'
                        : 'No agent is running for this folder. Run agent in a terminal, or Agent CLI: Start Agent from the command palette.' } });
                }
                askForBridgeSoon();
            }
        } else if (m.type === 'insert') {
            insertAttachment(m.payload || {});
        } else if (m.type === 'diff_decision') {
            if (typeof window.respondToDiff === 'function') window.respondToDiff(m.payload.diffId, m.payload.action);
        } else if (m.type === 'focus_input') {
            const input = document.getElementById('command-input');
            if (input) input.focus();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const input = document.getElementById('command-input');
        if (input) {
            input.addEventListener('input', (e) => {
                if (e.inputType === 'insertText' && e.data === '@') vscode.postMessage({ type: 'pick_file' });
            });
        }
    });

    vscode.postMessage({ type: 'need_bridge' });
}());
