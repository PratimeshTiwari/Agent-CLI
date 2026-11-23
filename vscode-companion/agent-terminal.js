'use strict';

/**
 * The agent, started from the sidebar in a terminal the person does not see (1.9.0).
 *
 * Owner, 2026-11-23: "instead of starting in a visible terminal, should have a
 * button start agent and it should start in a terminal hidden from user view
 * like claude code sidebar". The agent is an Ink app and needs a real
 * terminal, so it still gets one, made with `hideFromUser`: it runs, the
 * sidebar talks to it over its socket, and **Agent CLI: Show Agent Terminal**
 * brings the terminal up when wanted.
 *
 * The command runs as the terminal's own process (a login, interactive shell
 * running `agent`), not typed into a shell, so the terminal closes when the
 * agent exits and its exit code says whether it ever started: 127 is "not
 * installed", which a hidden shell would otherwise swallow.
 */

const NAME = 'Agent CLI';
const NOT_FOUND = 127;

/** How the terminal runs `agent`; null where it is typed into the default shell instead. */
function launchSpec({ platform = process.platform, shell = process.env.SHELL } = {}) {
    if (platform === 'win32') return null;
    // -l and -i: setup.sh puts the shim in ~/.local/bin, and either file may be what adds it to PATH.
    return { shellPath: shell || '/bin/zsh', shellArgs: ['-lic', 'exec agent'] };
}

/** What the sidebar says when the agent ended before it ever connected. */
function failureText(code) {
    if (code === NOT_FOUND) {
        return 'The agent did not start: `agent` was not found. Run ./setup.sh in the Agent-CLI checkout, then press Start agent again.';
    }
    return `The agent stopped before it connected (exit ${code ?? '?'}). Show Agent Terminal says why, or run agent in a terminal.`;
}

function createAgentTerminal(vscode, { onFailed = () => {} } = {}) {
    let terminal = null;
    let connected = false;
    let hidden = true;

    const closed = vscode.window.onDidCloseTerminal?.((t) => {
        if (t !== terminal) return;
        terminal = null;
        const code = t.exitStatus?.code;
        if (!connected && code !== undefined && code !== 0) onFailed(failureText(code), code);
    });

    return {
        get running() { return Boolean(terminal); },
        /** Starts one, hidden; a second call while it runs only answers false. */
        start(root, { show = false } = {}) {
            if (terminal) {
                if (show) terminal.show();
                return false;
            }
            connected = false;
            hidden = !show;
            const spec = launchSpec();
            terminal = vscode.window.createTerminal({
                name: NAME, cwd: root, hideFromUser: !show, ...(spec || {}),
                // Not restored into a later window: a restored copy is a second agent.
                isTransient: true,
            });
            if (!spec) terminal.sendText('agent');
            if (show) terminal.show();
            return true;
        },
        /** Bring it up; false when this window did not start one. */
        show() {
            if (!terminal) return false;
            hidden = false;
            terminal.show();
            return true;
        },
        noteConnected() { connected = true; },
        get hidden() { return hidden; },
        dispose() { closed?.dispose?.(); },
    };
}

module.exports = { createAgentTerminal, launchSpec, failureText, NAME, NOT_FOUND };
