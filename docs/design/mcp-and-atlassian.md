# MCP servers, Jira and Confluence

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Tools

**Jira (v8.1, `jira_issue`, prompt v4).** Owner: every write asks, as a mandatory step. Reads (`get`,
`search`) answer in Markdown; every other action, an unknown one included, is a write. Three locks,
each tested with a negative control: `requiresApproval`'s **first** statement returns
`isExternalWrite` for an `EXTERNAL_TOOLS` call, before mode or risk (a source assertion pins its
place); `runExternalTool` (`core/policy/external-approval.js`) plans the write against the live issue,
shows it as a Send / Don't send box that starts on Don't send, stores no rule for "always", and logs
the outcome as `risk: 'external'`; and the handler refuses without a one-use token from
`approval-token.js`, so the registry alone cannot write. Subagents are refused the tool. A 403 is
`HANDED OFF — not done`, never retried. Cloud is `/rest/api/3` with ADF, Server/DC `/rest/api/2`
with wiki markup (`atlassian/adf.js`, `wiki.js`); what a write would lose (panels, mentions) is
named in the box. The token is only in the Keychain or `~/.agent/atlassian-token.json` (0600), set
by `agent atlassian login` (run by the bin before `tsx`); never in a prompt, log or settings file.
v4 offers it only once a site is set up (else v3 byte for byte); `/jira` checks the sign-in. Pty
on the fake Jira: Don't send sends nothing, Send one request, 0 clears. No real Jira run yet.

**MCP client (v9.0, `mcp/client/`).** `~/.agent/mcp.json`, Claude Code's shape. Started on
the first `/mcp`, never at launch (`AgentLoop.mcp` is lazy), and the model reaches nothing until v9.1.
`/mcp` lists servers and Jira together. `env` values are scrubbed from errors, descriptions and
results; children die on `exit`. Tested against a real process (`test/fixtures/mcp-fixture-server.js`).

**The model reaches them through two tools (v9.1, prompt v5).** `mcp_describe` and `mcp_tool`; servers
are data behind them, so a schema is typed into the tab only when asked for. With no usable server v5
is v4 byte for byte, and v1–v4 never read a config. Turn 0 gets `<mcp_servers>`, capped: +2,445
(low) / +3,146 (high) characters at 40 tools. **The switch** (`mcp/client/switches.js`, per person):
`ask`, `auto`, `block`; new tools ask; `auto` runs in plan and auto and asks in strict; `alwaysAsk` in
`mcp.json` beats it. Three locks as for Jira: `requiresApproval`'s second statement (a source assertion
pins it), the box (`core/policy/mcp-approval.js`, starts on Don't run), and a handler that refuses
without a one-use token unless the switch says run. **In one reply:** `mcp_describe` and calls needing
no box run together, 4 at once per server; anything else waits for them (`mcpInFlight`) and calls after
a box wait for it. A call is never repeated. A result is labelled data and cannot close its own label.

**Adding a server (v9.2, `/mcp add`, `components/McpAdd.jsx`).** Four pasted shapes (`parseServerInput`); the
check step always shows the command before anything runs. A secret goes to
the Keychain or a 0600 `mcp-secrets.json`, `mcp.json` holds `${secret:<server>/<VAR>}`, and a server reads only
its own. **A text field behind a menu needs its own `usePaste`:** the prompt's is inactive there, bracketed
paste goes off, and a pasted JSON's first newline is an Enter. The pty must set `AGENT_MCP_NO_KEYCHAIN=1`.

**The model adds one when asked (v9.9.7, `mcp_setup`, `core/policy/mcp-setup-approval.js`).** Owner: "the agent
can add and test mcp connection if user asks for it". v7 only (`mcpSetup`), with or without servers: +333 / +333 /
+688 characters on turn 0. `/mcp add`'s parse, name, test and save. Owner on the box, **one box, then auto**: a new
name and command show Test and add / Don't add (on Don't add, every mode; esc is Don't add); the same one again this
session runs unasked; one needing a secret always asks, since the person types it there (`SetupValues`) and it goes
`answerCommandApproval` → runner → handler, never into a prompt. Saved only if the test answered; the handler wants
the token; `mcp: true` keeps subagents out. A side panel cannot take a secret, so it gets a refusal naming `/mcp add`.
Pty `SCRIPT=script-mcp-setup.json ./run-mcp.sh ROWS 90 setup`: 0 clears at 13 and 24, the value in no screen or prompt.

**A repo's `.mcp.json` and HTTP servers (v9.6, `mcp/client/repo-approval.js`, `config.js`).** A cloned
folder writes that file, so nothing in it runs until the person allows it in `/mcp`, per folder and per whole entry:
any edit asks again. It cannot use `${secret:}`, because secrets go by server name and a repo picks its names. Your
`mcp.json` wins a shared name. **`switchKey`** ties a repo server's ask/auto/block to the entry, or it could arrive on
`auto` by reusing a name. HTTP is `https`, or `http` to this machine only, with `headers`; no SSE. OAuth is v9.9's, below. Cross-origin
redirects are refused by the SDK's default: do not pass `redirectPolicy: 'follow'`. A lost session fails that call
and the next one reconnects. Pty: `run-repo.sh`, no process before the yes.

**Jira and Confluence by browser sign-in (v9.9, `mcp/client/oauth.js`, `atlassian-server.js`).**
`agent atlassian login` opens Atlassian's consent page; `--token` is v8.1's flow, kept for Server/DC. Atlassian's
server (`https://mcp.atlassian.com/v2/mcp`, read 2026-11-08: 401 with resource metadata, self-registration, PKCE
S256) is a built-in `/mcp` row, usable once signed in; the SDK does the protocol, a one-shot `127.0.0.1` callback checks
`state`, and a connection never opens a browser (`SignInNeeded`). The record goes to the Keychain **in 3,000-character
pieces**, read back before it is trusted: `security -i` cut a 5,806-character value at 4,039. A fresh sign-in drops cached
discovery and the record names its address, or a moved server fails every sign-in. **Every write asks, in every mode:**
reads are a name list (`ATLASSIAN_READS`), anything else is a write, by address not name; `requiresApproval` checks
`external` before any switch, the box is Send / Don't send with no "always", and `mcp_tool` wants a token.
Pty `run-atl.sh`, `run-atl-bin.sh` (fixture `test/fixtures/oauth-fixture.js`): 0 clears at 13 and 24.
**An empty `AGENT_ATLASSIAN_MCP_URL` means the real server:** one harness run registered two real clients that way.
