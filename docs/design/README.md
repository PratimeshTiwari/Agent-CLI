# Design notes, by area

How each part of the agent came to be: what was reported, what was tried, what was measured.
[`CLAUDE.md`](../../CLAUDE.md) keeps the rules; these files keep the reasons. They were moved
word for word out of `CLAUDE.md` on 2026-11-09 (the whole old file is
[`../old-claude.md`](../old-claude.md)), so "this file" inside them means the old `CLAUDE.md`.

| File | Area |
| --- | --- |
| [overview.md](overview.md) | What it is, commands, layout, the turn lifecycle |
| [testing.md](testing.md) | Tests, CI and the pty harness |
| [bridge.md](bridge.md) | The Chrome bridge and the reply path |
| [prompt-and-models.md](prompt-and-models.md) | Prompt versions and economics, effort, models, thinking level |
| [tools.md](tools.md) | Tools: reads, edits, documents, logs, symbols, commands |
| [policy.md](policy.md) | Approvals, modes and who may run what |
| [mcp-and-atlassian.md](mcp-and-atlassian.md) | MCP servers, Jira and Confluence |
| [subagents.md](subagents.md) | Subagents and review |
| [context-and-memory.md](context-and-memory.md) | Context engine, memory, search |
| [state-and-sessions.md](state-and-sessions.md) | `.agent/`, sessions, resume, compaction |
| [companion-and-panels.md](companion-and-panels.md) | The VS Code companion and the side panels |
| [logs.md](logs.md) | Failure log and command log |
| [install-and-update.md](install-and-update.md) | `/doctor` and `/update` |
| [terminal-ui.md](terminal-ui.md) | The terminal UI |
| [project.md](project.md) | Branching, product decisions, the version series |

A new feature's story goes in its area's file (and `docs/CHANGELOG.md`); `CLAUDE.md` gets a line
or two.
