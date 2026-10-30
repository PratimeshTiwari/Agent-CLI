# Changelog

Every release reached `main` through a pull request from a branch that is kept — the branches are
the history, so this can be checked rather than believed:

```bash
git log main --merges --format="%h %ad %s" --date=short
```

Internals and the reasoning behind each change live in [`CLAUDE.md`](CLAUDE.md).

## Every release

Every pull request, newest first, grouped by series — generated from GitHub. Two were closed
without merging (#6 and #15, both `test-pr`); there is no PR #68 because #68 is an issue.

### v6 — 2026-10-30 … · PRs [#105](https://github.com/PratimeshTiwari/Agent-CLI/pull/105)–[#127](https://github.com/PratimeshTiwari/Agent-CLI/pull/127)

| Version | Date | Branch | PR | What |
| --- | --- | --- | --- | --- |
| v6.3 | 2026-10-30 | `v6.3/lean-menus` | [#108](https://github.com/PratimeshTiwari/Agent-CLI/pull/108) | v6.3: lean menus — state in colour on the title, one short line, glyph-led options |
| v6.4 | 2026-10-30 | `v6.4/question-prompt` | [#109](https://github.com/PratimeshTiwari/Agent-CLI/pull/109) | v6.4: the question prompt in Claude Code's layout |
| v6.5 | 2026-10-30 | `v6.5/action-rows` | [#110](https://github.com/PratimeshTiwari/Agent-CLI/pull/110) | v6.5: action rows in Claude Code's shape |
| v6.6 | 2026-10-30 | `v6.6/between-turns` | [#111](https://github.com/PratimeshTiwari/Agent-CLI/pull/111) | v6.6: measure the time between turns (#104) |
| v6.7 | 2026-10-30 | `v6.7/plan-review-guard` | [#112](https://github.com/PratimeshTiwari/Agent-CLI/pull/112) | v6.7: a greeting no longer ends on a plan review |
| v6.8 | 2026-10-30 | `v6.8/ruby-symbols` | [#113](https://github.com/PratimeshTiwari/Agent-CLI/pull/113) | v6.8: find_symbol and find_references read Ruby; acorn loads on first use |
| v6.9 | 2026-10-30 | `v6.9/companion-panel` | [#114](https://github.com/PratimeshTiwari/Agent-CLI/pull/114) | v6.9: companion 1.8.5 carries the v6.5 action rows |
| v6.10 | 2026-10-30 | `v6.10/prompt-menu` | [#115](https://github.com/PratimeshTiwari/Agent-CLI/pull/115) | v6.10: /prompt opens a menu |
| v6.11 | 2026-10-30 | `v6.11/prompt-compare` | [#116](https://github.com/PratimeshTiwari/Agent-CLI/pull/116) | v6.11: /prompt compares the versions |
| v6.12 | 2026-10-30 | `v6.12/reply-wrap` | [#117](https://github.com/PratimeshTiwari/Agent-CLI/pull/117) | v6.12: replies fit the terminal; bullets hang under their text |
| v6.13 | 2026-10-30 | `v6.13/status-bar` | [#118](https://github.com/PratimeshTiwari/Agent-CLI/pull/118) | v6.13: a quieter status bar; shift+tab hint only at the start of a chat |
| v6.14 | 2026-10-30 | `v6.14/architecture-pointer` | [#119](https://github.com/PratimeshTiwari/Agent-CLI/pull/119) | v6.14: the architecture is findable; idle time is not round_work |
| v6.15 | 2026-10-30 | `v6.15/compaction` | [#120](https://github.com/PratimeshTiwari/Agent-CLI/pull/120) | v6.15: compaction keeps the last 3 exchanges; watcher rows and own writes stop counting |
| v6.16 | 2026-10-30 | `v6.16/large-files` | [#121](https://github.com/PratimeshTiwari/Agent-CLI/pull/121) | v6.16: a large file is read by a subagent; the main chat gets a digest |
| v6.17 | 2026-10-30 | `v6.17/panel-drop` | [#122](https://github.com/PratimeshTiwari/Agent-CLI/pull/122) | v6.17: drag and drop in the side panels (extension 1.52.0, companion 1.8.6) |
| v6.18 | 2026-10-30 | `v6.18/keys` | [#123](https://github.com/PratimeshTiwari/Agent-CLI/pull/123) | v6.18: ? shows the keys; the / palette no longer overflows 10 rows |
| v6.19 | 2026-10-30 | `v6.19/ruby-precision` | [#124](https://github.com/PratimeshTiwari/Agent-CLI/pull/124) | v6.19: Ruby references 99.5% precise; Rails production blocked; one-line extension notice |
| v6.20 | 2026-10-30 | `v6.20/log-query` | [#125](https://github.com/PratimeshTiwari/Agent-CLI/pull/125) | v6.20: query_log reads log exports (Grafana, Loki, Datadog) however large |
| v6.21 | 2026-10-30 | `v6.21/generic-symbols` | [#126](https://github.com/PratimeshTiwari/Agent-CLI/pull/126) | Symbols in every common language, from one table |
| v6.22 | 2026-10-30 | `v6.22/status-bar-gutter` | [#127](https://github.com/PratimeshTiwari/Agent-CLI/pull/127) | Status bar gutter, /context wording, CLAUDE.md under 150k |
| v6.2 | 2026-10-30 | `v6.2/readable-replies` | [#107](https://github.com/PratimeshTiwari/Agent-CLI/pull/107) | v6.2: list text readable again (#103); /update answers in one line |
| v6.1 | 2026-10-30 | `v6.1/apply-or-revert-settings` | [#106](https://github.com/PratimeshTiwari/Agent-CLI/pull/106) | v6.1: settings wait for Apply; Revert says nothing; clearer theme names |
| v6.0 | 2026-10-30 | `v6.0/settings-and-update-fixes` | [#105](https://github.com/PratimeshTiwari/Agent-CLI/pull/105) | v6.0: /update pull restores the lockfile (#102); short settings hints; /theme preview box; Put back says only what moved |

### v5 — 2026-10-19 … 2026-10-28 · PRs [#63](https://github.com/PratimeshTiwari/Agent-CLI/pull/63)–[#101](https://github.com/PratimeshTiwari/Agent-CLI/pull/101)

| Version | Date | Branch | PR | What |
| --- | --- | --- | --- | --- |
| v5.35 | 2026-10-28 | `v5.35/logs-picker` | [#101](https://github.com/PratimeshTiwari/Agent-CLI/pull/101) | v5.35: /logs is a picker — every question the log answers, each with its answer |
| v5.34 | 2026-10-28 | `v5.34/prompt-v2` | [#100](https://github.com/PratimeshTiwari/Agent-CLI/pull/100) | v5.34: prompt v2 — fewer round trips, one copy of each rule |
| v5.33 | 2026-10-28 | `v5.33/file-drop` | [#99](https://github.com/PratimeshTiwari/Agent-CLI/pull/99) | v5.33: drag and drop — a dropped path becomes a [File #n] tag |
| v5.32 | 2026-10-28 | `v5.32/prompt-versions` | [#98](https://github.com/PratimeshTiwari/Agent-CLI/pull/98) | v5.32: prompt versions — v1 frozen, v2 opt-in, compared per reply |
| v5.31 | 2026-10-28 | `v5.31/quick-wins` | [#97](https://github.com/PratimeshTiwari/Agent-CLI/pull/97) | v5.31: chokidar out; /doctor uninstall, remove unused, ripgrep from VS Code; ✻ end-of-turn line |
| v5.30 | 2026-10-27 | `v5.30/health-menu` | [#96](https://github.com/PratimeshTiwari/Agent-CLI/pull/96) | v5.30: /doctor as a menu; installs that cannot collide; a broken start is undone |
| v5.29 | 2026-10-27 | `v5.29/read-documents` | [#95](https://github.com/PratimeshTiwari/Agent-CLI/pull/95) | v5.29: read PDF, Word and PowerPoint; /doctor health check; README with project images |
| v5.28 | 2026-10-27 | `v5.28/effort-mismatch` | [#94](https://github.com/PratimeshTiwari/Agent-CLI/pull/94) | v5.28: ask when the browser differs from the effort; step down on a failed switch or a quota |
| v5.27 | 2026-10-26 | `v5.27/fixes-from-use` | [#93](https://github.com/PratimeshTiwari/Agent-CLI/pull/93) | v5.27: expandable output, gated Low/Medium handover, opt-in warm start; /settings as a list of switches |
| v5.26 | 2026-10-26 | `v5.26/effort-argon` | [#92](https://github.com/PratimeshTiwari/Agent-CLI/pull/92) | v5.26: effort follows the tab, a Max rung for Argon, /update lockfile fix |
| v5.25 | 2026-10-26 | `v5.25/effort-slider-quiet-replies` | [#89](https://github.com/PratimeshTiwari/Agent-CLI/pull/89) | v5.25: effort slider, one-line replies, quieter menus |
| v5.24 | 2026-10-26 | `v5.24/images-panel-ui-fixes` | [#87](https://github.com/PratimeshTiwari/Agent-CLI/pull/87) | v5.24: images, side panel, /help, one menu look |
| v5.23 | 2026-10-26 | `v5.23/steer-into-turn` | [#88](https://github.com/PratimeshTiwari/Agent-CLI/pull/88) | v5.23: steer into the running turn; exit and intro |
| v5.22 | 2026-10-25 | `v5.22/first-run-welcome` | [#86](https://github.com/PratimeshTiwari/Agent-CLI/pull/86) | v5.22: first-start setup, Look A startup, /copy |
| v5.21 | 2026-10-25 | `v5.21/exit-footer-and-live-command-output` | [#85](https://github.com/PratimeshTiwari/Agent-CLI/pull/85) | v5.21: live output under a running command; Claude Code's exit footer |
| v5.20 | 2026-10-25 | `v5.20/exit-keeps-transcript-compact-on-send` | [#84](https://github.com/PratimeshTiwari/Agent-CLI/pull/84) | v5.20: exit keeps the transcript; auto-compaction waits for your next message; spacing and bullets |
| v5.19 | 2026-10-25 | `v5.19/release-history` | [#83](https://github.com/PratimeshTiwari/Agent-CLI/pull/83) | v5.19: release history with dates, branches and PR links; current README screenshots |
| v5.18 | 2026-10-24 | `v5.18/thinking-waits` | [#82](https://github.com/PratimeshTiwari/Agent-CLI/pull/82) | v5.18: replies no longer dropped while Gemini thinks; interrupted tool calls salvaged |
| v5.17 | 2026-10-24 | `v5.17/rows` | [#81](https://github.com/PratimeshTiwari/Agent-CLI/pull/81) | v5.17: redesign phase 3 — tool rows, message edge, mode on the border, meter, rounds, tinted diffs |
| v5.16 | 2026-10-24 | `v5.16/themes` | [#80](https://github.com/PratimeshTiwari/Agent-CLI/pull/80) | v5.16: themes (/theme), issue #68 regression test |
| v5.15 | 2026-10-24 | `v5.15/theme-tokens` | [#79](https://github.com/PratimeshTiwari/Agent-CLI/pull/79) | v5.15: colour by role (redesign phase 1); extension CONNECTING-state fix |
| v5.14 | 2026-10-24 | `v5.14/fixes-and-ui` | [#78](https://github.com/PratimeshTiwari/Agent-CLI/pull/78) | v5.14: live-frame fixes, compaction row, disconnected hints, task progress |
| v5.13 | 2026-10-23 | `v5.13/prompt-and-readme` | [#77](https://github.com/PratimeshTiwari/Agent-CLI/pull/77) | v5.13: prompt fixes, README feature tour, marker prompts drawn once |
| v5.12 | 2026-10-23 | `v5.12/ui-polish` | [#76](https://github.com/PratimeshTiwari/Agent-CLI/pull/76) | v5.12: UI polish, and a short README with pictures |
| v5.11 | 2026-10-23 | `v5.11/three-modes` | [#75](https://github.com/PratimeshTiwari/Agent-CLI/pull/75) | v5.11: three modes — plan, auto, strict |
| v5.10 | 2026-10-23 | `v5.10/large-files` | [#74](https://github.com/PratimeshTiwari/Agent-CLI/pull/74) | v5.10: large files and documents |
| v5.9 | 2026-10-23 | `v5.9/compact-in-thread` | [#73](https://github.com/PratimeshTiwari/Agent-CLI/pull/73) | v5.9: compaction hands the summary over, from the same chat, between turns |
| v5.8 | 2026-10-23 | `v5.8/queue-drain` | [#72](https://github.com/PratimeshTiwari/Agent-CLI/pull/72) | v5.8: a queued prompt is sent when the turn ends |
| v5.7 | 2026-10-23 | `v5.7/composer` | [#71](https://github.com/PratimeshTiwari/Agent-CLI/pull/71) | v5.7: prompts go in without a 5-second wait |
| v5.6 | 2026-10-23 | `v5.6/spawn-ebadf` | [#70](https://github.com/PratimeshTiwari/Agent-CLI/pull/70) | v5.6: commands run again on large repos (spawn EBADF), and /reset |
| v5.5 | 2026-10-23 | `v5.5/honest-busy` | [#69](https://github.com/PratimeshTiwari/Agent-CLI/pull/69) | v5.5: the busy indicator lasts as long as the turn |
| v5.4 | 2026-10-19 | `v5.4/exit-and-shortcut` | [#67](https://github.com/PratimeshTiwari/Agent-CLI/pull/67) | v5.4 — exit clears and prints the resume id; ⌘⇧1 reports a missing key (extension 1.44.0) |
| v5.3 | 2026-10-19 | `v5.3/hotkeys` | [#66](https://github.com/PratimeshTiwari/Agent-CLI/pull/66) | v5.3 — global shortcut for the floating window (extension 1.43.0) |
| v5.2 | 2026-10-19 | `v5.2/editor-panel` | [#65](https://github.com/PratimeshTiwari/Agent-CLI/pull/65) | v5.2 — a chat panel in the editor sidebar (companion 1.8.0) |
| v5.1 | 2026-10-19 | `v5.1/one-recovery-policy` | [#64](https://github.com/PratimeshTiwari/Agent-CLI/pull/64) | v5.1 — one recovery table; provider retry re-asks the right question, after a wait |
| v5.0 | 2026-10-19 | `v5.0/clean-slate` | [#63](https://github.com/PratimeshTiwari/Agent-CLI/pull/63) | v5.0 — clean slate: tests stop writing to ~/.agent, GitHub leftovers removed |

### v4 — 2026-09-27 … 2026-10-19 · PRs [#60](https://github.com/PratimeshTiwari/Agent-CLI/pull/60)–[#62](https://github.com/PratimeshTiwari/Agent-CLI/pull/62)

| Version | Date | Branch | PR | What |
| --- | --- | --- | --- | --- |
| v4.2 | 2026-10-19 | `v4.2/fixes-from-use` | [#62](https://github.com/PratimeshTiwari/Agent-CLI/pull/62) | v4.2 — six fixes from one session of use (extension 1.42.0) |
| v4.1 | 2026-09-27 | `v4.1/rename-agent-cli` | [#61](https://github.com/PratimeshTiwari/Agent-CLI/pull/61) | v4.1 — follow the rename to Agent-CLI, without breaking existing installs |
| v4.0 | 2026-09-27 | `v4.0/honest-log` | [#60](https://github.com/PratimeshTiwari/Agent-CLI/pull/60) | v4.0 — the log counts failures, and the picker can fail without costing a turn |

### v3 — 2026-09-22 … 2026-09-27 · PRs [#26](https://github.com/PratimeshTiwari/Agent-CLI/pull/26)–[#59](https://github.com/PratimeshTiwari/Agent-CLI/pull/59)

| Version | Date | Branch | PR | What |
| --- | --- | --- | --- | --- |
| v3.27 | 2026-09-27 | `v3.27/backspace-after-recall` | [#59](https://github.com/PratimeshTiwari/Agent-CLI/pull/59) | Backspace stopped working after recalling history into an empty prompt |
| v3.26 | 2026-09-27 | `v3.26/new-chat-resends-the-prompt` | [#58](https://github.com/PratimeshTiwari/Agent-CLI/pull/58) | /new resends the base prompt, and a half-built picker is retried |
| v3.25 | 2026-09-27 | `v3.25/dont-expand-reads` | [#57](https://github.com/PratimeshTiwari/Agent-CLI/pull/57) | ctrl+e no longer expands a file read into the transcript |
| v3.24 | 2026-09-27 | `v3.24/stall-reaches-the-screen` | [#56](https://github.com/PratimeshTiwari/Agent-CLI/pull/56) | A stalled turn now ends on screen, instead of spinning for hours |
| v3.23 | 2026-09-26 | `v3.23/subagent-picker-race` | [#55](https://github.com/PratimeshTiwari/Agent-CLI/pull/55) | Extension 1.39.0: subagents were silently running on the main model |
| v3.22 | 2026-09-26 | `v3.22/never-click-the-mic` | [#54](https://github.com/PratimeshTiwari/Agent-CLI/pull/54) | Extension 1.38.0: it was clicking the microphone |
| v3.21 | 2026-09-26 | `v3.21/tool-usage` | [#53](https://github.com/PratimeshTiwari/Agent-CLI/pull/53) | Record which tools are actually called, and close two gated items |
| v3.20 | 2026-09-26 | `v3.20/subagent-watchdog` | [#52](https://github.com/PratimeshTiwari/Agent-CLI/pull/52) | The subagent watchdog was 5.4× the slowest turn ever recorded |
| v3.19 | 2026-09-26 | `v3.19/drop-terminal-queue` | [#51](https://github.com/PratimeshTiwari/Agent-CLI/pull/51) | Remove terminal failure forwarding — it never produced a record |
| v3.18 | 2026-09-26 | `v3.18/seamless-tab` | [#50](https://github.com/PratimeshTiwari/Agent-CLI/pull/50) | Extension 1.37.0: ctrl+b opens the tab, and the picker is waited for |
| v3.17 | 2026-09-26 | `v3.17/generating-traces` | [#49](https://github.com/PratimeshTiwari/Agent-CLI/pull/49) | Extension 1.36.0: record the Stop button's edges, and trace a turn that timed out |
| v3.16 | 2026-09-26 | `v3.16/out-of-turn-notices` | [#48](https://github.com/PratimeshTiwari/Agent-CLI/pull/48) | Notices raised outside a turn land in the transcript |
| v3.15 | 2026-09-26 | `v3.15/quick-wins` | [#47](https://github.com/PratimeshTiwari/Agent-CLI/pull/47) | Cover the bridge's message dispatch: 53% → 70% |
| v3.14 | 2026-09-26 | `v3.14/docs-current` | [#46](https://github.com/PratimeshTiwari/Agent-CLI/pull/46) | Docs: bring both READMEs current, and say how the picker hunt ended |
| v3.13 | 2026-09-26 | `v3.13/picker-cleanup` | [#45](https://github.com/PratimeshTiwari/Agent-CLI/pull/45) | Picker cleanup: four matching strategies to two, and clear up after the chase |
| v3.12 | 2026-09-26 | `v3.12/effort-low-medium-high` | [#44](https://github.com/PratimeshTiwari/Agent-CLI/pull/44) | Effort rungs are low/medium/high; the status bar shows the browser's model |
| v3.11 | 2026-09-26 | `v3.11/the-worker-dropped-the-answer` | [#43](https://github.com/PratimeshTiwari/Agent-CLI/pull/43) | Extension 1.34.0: the worker was dropping model_options before it reached the socket |
| v3.10 | 2026-09-26 | `v3.10/prove-the-picker-path` | [#42](https://github.com/PratimeshTiwari/Agent-CLI/pull/42) | Extension 1.33.0: make the picker path say which hop failed |
| v3.9 | 2026-09-25 | `v3.9/picker-repairs-and-deferral` | [#41](https://github.com/PratimeshTiwari/Agent-CLI/pull/41) | Extension 1.32.0: repair the picker path, defer instead of dropping, observe the composer |
| v3.8 | 2026-09-25 | `v3.8/models-by-structure` | [#40](https://github.com/PratimeshTiwari/Agent-CLI/pull/40) | Extension 1.31.0: read the models from the page, hardcode no product names |
| v3.7 | 2026-09-25 | `v3.7/deadline-and-picker-order` | [#39](https://github.com/PratimeshTiwari/Agent-CLI/pull/39) | Extension 1.30.0: a deadline that could not outlast its own work, and Pro as the anchor |
| fix | 2026-09-25 | `fix/deadline-and-picker-order` | [#38](https://github.com/PratimeshTiwari/Agent-CLI/pull/38) *(closed, not merged)* | Extension 1.30.0: a deadline that could not outlast its own work, and Pro as the anchor |
| fix | 2026-09-25 | `fix/confirm-switch-without-reopening` | [#37](https://github.com/PratimeshTiwari/Agent-CLI/pull/37) | Extension 1.29.1: the switch worked; confirming it is what broke the turn |
| fix | 2026-09-25 | `fix/effort-may-open-its-tab` | [#36](https://github.com/PratimeshTiwari/Agent-CLI/pull/36) | Extension 1.29.0: /effort may open the tab it needs |
| fix | 2026-09-25 | `fix/discover-on-tab-not-on-connect` | [#35](https://github.com/PratimeshTiwari/Agent-CLI/pull/35) | Extension 1.28.2: read the picker when a tab exists, not when a socket opens |
| fix | 2026-09-25 | `fix/menu-budget-and-late-close` | [#34](https://github.com/PratimeshTiwari/Agent-CLI/pull/34) | Extension 1.28.1: the menu budget was cut 20×, and a late menu was left open |
| chore | 2026-09-25 | `chore/ignore-claude-local-settings` | [#33](https://github.com/PratimeshTiwari/Agent-CLI/pull/33) | chore: ignore .claude/settings.local.json |
| v3.6 | 2026-09-25 | `v3.6/picker-off-page-timers` | [#32](https://github.com/PratimeshTiwari/Agent-CLI/pull/32) | Extension 1.28.0: the mode picker was read on a clock a hidden tab does not run |
| v3.5 | 2026-09-25 | `v3.5/version-and-routing` | [#31](https://github.com/PratimeshTiwari/Agent-CLI/pull/31) | Extension 1.26.0: say which build is loaded, and route gathering to a cheaper tab |
| v3.4 | 2026-09-25 | `v3.4/lanes-and-tab-reuse` | [#30](https://github.com/PratimeshTiwari/Agent-CLI/pull/30) | Lane the model switch, hold one tab per subagent task, and measure the rung |
| v3.3 | 2026-09-25 | `v3.3/paste-landed` | [#29](https://github.com/PratimeshTiwari/Agent-CLI/pull/29) | fix(bridge): a paste that was "handled" and lost left the composer empty |
| v3.2 | 2026-09-25 | `v3.2/turn0-false-positive` | [#28](https://github.com/PratimeshTiwari/Agent-CLI/pull/28) | fix(loop): turn0_no_tools fired on the turns that did it right |
| v3.1 | 2026-09-22 | `v3.1/picker-pin` | [#27](https://github.com/PratimeshTiwari/Agent-CLI/pull/27) | feat(core): pin the browser model per rung, and notice when the picker never answers |
| v3.0 | 2026-09-22 | `v3/turn0-detector` | [#26](https://github.com/PratimeshTiwari/Agent-CLI/pull/26) | fix(core): turn0_no_tools missed 5 of the 8 real hallucinations |

### v2 — 2026-09-20 … 2026-09-22 · PRs [#17](https://github.com/PratimeshTiwari/Agent-CLI/pull/17)–[#25](https://github.com/PratimeshTiwari/Agent-CLI/pull/25)

| Version | Date | Branch | PR | What |
| --- | --- | --- | --- | --- |
| v2.5.1 | 2026-09-22 | `v2.5.1/echo-and-guardrails` | [#25](https://github.com/PratimeshTiwari/Agent-CLI/pull/25) | Transcript echo, /compact clarity, and model-picker diagnostics |
| v2.5 | 2026-09-21 | `v2.5/prompt-trim` | [#24](https://github.com/PratimeshTiwari/Agent-CLI/pull/24) | refactor(prompt): say each rule once, and size tool descriptions to Gemini's own guidance |
| v2.4 | 2026-09-21 | `v2.4/loose-ends` | [#23](https://github.com/PratimeshTiwari/Agent-CLI/pull/23) | chore: stop writing a field nothing reads, and stop timing the machine |
| v2.4 | 2026-09-21 | `v2.4/loose-ends` | [#22](https://github.com/PratimeshTiwari/Agent-CLI/pull/22) | chore: stop writing a field nothing reads, and stop timing the machine |
| v2.3 | 2026-09-21 | `v2.3/compact-stall-and-diagnostics` | [#21](https://github.com/PratimeshTiwari/Agent-CLI/pull/21) | feat: bound /compact's wait, and hand lint results to the edit that caused them |
| v2.2 | 2026-09-21 | `v2.2/tool-call-discipline` | [#20](https://github.com/PratimeshTiwari/Agent-CLI/pull/20) | fix: an answer that arrives before its evidence, and an audit that could not see the claim |
| v2.1 | 2026-09-21 | `v2.1/fix/tool-call-parsing-and-resume` | [#19](https://github.com/PratimeshTiwari/Agent-CLI/pull/19) | fix: prose is not a tool call, resume reaches the browser, and a thread we left is not a thread we never had |
| v2 | 2026-09-20 | `v2` | [#18](https://github.com/PratimeshTiwari/Agent-CLI/pull/18) | V2 |
| v2 | 2026-09-20 | `fix/bridge-speed-and-stability` | [#17](https://github.com/PratimeshTiwari/Agent-CLI/pull/17) | V1.2 Fix/bridge speed and stability |

### v1 — 2026-09-16 … 2026-09-16 · PRs [#13](https://github.com/PratimeshTiwari/Agent-CLI/pull/13)–[#16](https://github.com/PratimeshTiwari/Agent-CLI/pull/16)

| Version | Date | Branch | PR | What |
| --- | --- | --- | --- | --- |
| v1.2 | 2026-09-16 | `v1.2-github` | [#16](https://github.com/PratimeshTiwari/Agent-CLI/pull/16) | fix(github): a review without an analysis is not a plan, and triage d… |
| — | 2026-09-16 | `test-pr` | [#15](https://github.com/PratimeshTiwari/Agent-CLI/pull/15) *(closed, not merged)* | test |
| v1.1 | 2026-09-16 | `v1.1-bug-fixes` | [#14](https://github.com/PratimeshTiwari/Agent-CLI/pull/14) | V1.1 |
| v1.0 | 2026-09-16 | `v1-stable` | [#13](https://github.com/PratimeshTiwari/Agent-CLI/pull/13) | V1 stable |

### Betas — 2026-08-26 … 2026-09-06 · PRs [#1](https://github.com/PratimeshTiwari/Agent-CLI/pull/1)–[#12](https://github.com/PratimeshTiwari/Agent-CLI/pull/12)

| Version | Date | Branch | PR | What |
| --- | --- | --- | --- | --- |
| Beta v12 | 2026-09-06 | `fix/bridge-lock-and-cli` | [#12](https://github.com/PratimeshTiwari/Agent-CLI/pull/12) | fix: unwedge the extension bridge, plus CLI, extension, and dependency cleanup |
| Beta v11 | 2026-09-06 | `beta-11-followup` | [#11](https://github.com/PratimeshTiwari/Agent-CLI/pull/11) | Beta 11 followup |
| Beta v10 | 2026-09-05 | `beta-v10-code-cleanup` | [#10](https://github.com/PratimeshTiwari/Agent-CLI/pull/10) | Unify agent state under .agent/, fix diff approval, restyle the CLI |
| Beta v8 | 2026-09-05 | `beta-v8-ui` | [#9](https://github.com/PratimeshTiwari/Agent-CLI/pull/9) | Fix missing tabs and UI rendering issues |
| Beta v7 | 2026-09-03 | `beta-v7-parallel-subagents` | [#8](https://github.com/PratimeshTiwari/Agent-CLI/pull/8) | Beta v7 parallel subagents |
| Beta v6 | 2026-09-01 | `beta-v6-system-prompts` | [#7](https://github.com/PratimeshTiwari/Agent-CLI/pull/7) | feat: tiered model profiles and github PR agent rewrite |
| — | 2026-08-30 | `test-pr` | [#6](https://github.com/PratimeshTiwari/Agent-CLI/pull/6) *(closed, not merged)* | test |
| Beta v5 | 2026-08-29 | `beta-v5-github-agent` | [#5](https://github.com/PratimeshTiwari/Agent-CLI/pull/5) | Beta v5 GitHub agent |
| Beta v4 | 2026-08-29 | `beta-v4-subagents` | [#4](https://github.com/PratimeshTiwari/Agent-CLI/pull/4) | Beta v4 subagents |
| Beta v3 | 2026-08-26 | `beta-v3` | [#3](https://github.com/PratimeshTiwari/Agent-CLI/pull/3) | feat: add prompt improvement plan, CLI UI, and update core agent loop |
| Beta v2 | 2026-08-26 | `beta-v2` | [#2](https://github.com/PratimeshTiwari/Agent-CLI/pull/2) | Beta v2 |
| Beta v1 | 2026-08-26 | `beta-v1` | [#1](https://github.com/PratimeshTiwari/Agent-CLI/pull/1) | feat: smart context management, robust image support, and extension s… |

## v5 in detail

### v5.22 — 2026-10-25 · [PR #86](https://github.com/PratimeshTiwari/Agent-CLI/pull/86) · `v5.22/first-run-welcome`

- First start walks you through setup: an animated splash, then a theme (every palette with its colours, previewed live), a name (the banner previewed as you type), and connecting Chrome (the folder to load, and a spinner that turns into **Connected**). Enter goes on, esc skips; it is not shown again.
- A new startup look: a small `❯` mark with the name, byline, workspace and `/help` beside it, instead of six rows of large lettering. The input has a rule above and below and no sides, so selecting a prompt no longer copies the border. The mode line reads `⏸ plan mode on`, `⏵⏵ auto mode on`, `⏹ strict plan mode on`.
- `/copy` puts the last reply on the clipboard as markdown.
- Exit with nothing to resume leaves one blank row before the shell prompt. Long workspace paths are shortened from the middle.
- README screenshots re-captured, plus one of setup.

### v5.21 — 2026-10-25 · [PR #85](https://github.com/PratimeshTiwari/Agent-CLI/pull/85) · `v5.21/exit-footer-and-live-command-output`

- A running command shows its last five lines under its row, with how long it has been running and how many lines are hidden (`◌ run_command npm test · 12s · +340 lines`), like Claude Code's Bash rows. On a short terminal the lines are dropped first; the model's result is unchanged.
- After you approve a command, the transcript says only what you decided. It repeated the whole command, which wrapped over several rows and made the screen flicker on short terminals.
- Exit prints Claude Code's footer: `Resume this session with:` and the command on its own line, dim, with the shell prompt directly under it.

### v5.20 — 2026-10-25 · [PR #84](https://github.com/PratimeshTiwari/Agent-CLI/pull/84) · `v5.20/exit-keeps-transcript-compact-on-send`

- Exit keeps the session on screen and prints one resume line under it, like Claude Code — or nothing when there was no conversation. It used to clear the screen.
- Auto-compaction no longer runs during a turn or right after one: once the threshold is crossed, your next message compacts first and is then sent. A `/compact` typed during a turn still runs when it ends. The status bar says `N% until auto-compact`.
- "Taking a while — make sure the Chrome tab is not minimised" appears after 30s of silence from the browser (60s on High), not after a fixed 10s.
- The status line reads `plan mode on (shift+tab to cycle)`, without the dot and the pause glyph.
- Lists use dim `◦` bullets, and inline code inside a list item is rendered (it showed its backticks).
- A blank row between events in the transcript and before "Worked for…"; the live tally moved onto the spinner line, with a blank row above the spinner.
- `/effort` picked from its menu shows the command above the result; a reply that was only an empty code block is no longer drawn.
- `CLAUDE.md` split: history moved verbatim to `docs/history.md` (169k → 122k characters, under the 150k Claude Code loads).

### v5.19 — 2026-10-25 · [PR #83](https://github.com/PratimeshTiwari/Agent-CLI/pull/83) · `v5.19/release-history`

- This changelog rebuilt: every PR indexed from GitHub with its date, branch and link, grouped by series; the v5 releases written out one by one; every PR number in the older notes linked.
- The README's screenshots re-captured from the current agent (status-line mode, `⎿` result rows, rounds, line-numbered diffs) and a release-history table added.

### v5.18 — 2026-10-24 · [PR #82](https://github.com/PratimeshTiwari/Agent-CLI/pull/82) · `v5.18/thinking-waits` · extension 1.49.0

- A reply is no longer dropped while Gemini is still thinking: the 45s "nothing came back" timeout and the 15s silence fallback no longer run while the Stop button is on screen (a 46s paste plus 36s of Pro thinking had hit the first).
- Tool calls that Argon interrupts with a `<thought>` are salvaged: the complete calls after the thought are run instead of the whole reply being rejected round after round.
- The tool-call prompts say to finish thinking before a json block.

### v5.17 — 2026-10-24 · [PR #81](https://github.com/PratimeshTiwari/Agent-CLI/pull/81) · `v5.17/rows`

- Redesign phase 3: finished tools on two lines with a `⎿` result (red when it failed); your message with an accent `▌` edge.
- The mode in the status line, Claude Code style (`⏵⏵ auto mode on (shift+tab to cycle)`); a five-cell context meter; rounds in the turn summary (each call stamped with its round by the loop).
- Tinted diffs with line numbers when expanded; no tint in the Terminal and Mono themes.

### v5.16 — 2026-10-24 · [PR #80](https://github.com/PratimeshTiwari/Agent-CLI/pull/80) · `v5.16/themes` · closes issue #68

- `/theme` with a live preview: Dark, Light, two colour-blind palettes, Terminal (the classic look, still the default) and Mono (also `NO_COLOR`); saved per person in `~/.agent/settings.json`; every palette held to WCAG contrast by a test.
- Issue #68 (replies vanishing after compaction) reproduced on v5.4 and absent now, with a regression test.
- One spinner instead of three; a reply dot that differs from a finished tool's; an unparseable tool call as one row; `⚠` on a mismatched model.

### v5.15 — 2026-10-24 · [PR #79](https://github.com/PratimeshTiwari/Agent-CLI/pull/79) · `v5.15/theme-tokens` · extension 1.48.0

- Colour by role (`ui/theme.js`), no visible change: the same 19 on-screen styles and a byte-identical run.
- The extension identifies on the socket that opened, not its successor — no more `InvalidStateError: Still in CONNECTING state`.

### v5.14 — 2026-10-24 · [PR #78](https://github.com/PratimeshTiwari/Agent-CLI/pull/78) · `v5.14/fixes-and-ui`

- Finished tools join the transcript as they finish instead of being listed twice: 28 full redraws at 13 rows and 6 at 16 became 0 at every size from 10 to 40.
- Compaction as one transcript row; the disconnected row names its fix; `tasks 3/5` while a turn runs; `/help` leads with the most-used commands.
- `setup.sh` finds the newest companion package.

### v5.13 — 2026-10-23 · [PR #77](https://github.com/PratimeshTiwari/Agent-CLI/pull/77) · `v5.13/prompt-and-readme`

- Prompt fixes from a review: pro's duplicate bullets, numbered headings, no planning ceremony for a greeting.
- A prompt with a paste or selection marker is drawn once; README feature tour images.

### v5.12 — 2026-10-23 · [PR #76](https://github.com/PratimeshTiwari/Agent-CLI/pull/76) · `v5.12/ui-polish`

- `6 reads · 2 edits · 1 command` turn summaries, `/diff`, paths that keep their first directory, `↑ to take back` on queued prompts.
- The README rewritten short with pictures; release notes moved here.

### v5.11 — 2026-10-23 · [PR #75](https://github.com/PratimeshTiwari/Agent-CLI/pull/75) · `v5.11/three-modes` · extension 1.47.0 · companion 1.8.2

- Three modes: `plan` writes the repo's Markdown without asking (not AGENT.md/CLAUDE.md), `strict` asks for everything, `auto` unchanged.

### v5.10 — 2026-10-23 · [PR #74](https://github.com/PratimeshTiwari/Agent-CLI/pull/74) · `v5.10/large-files`

- Large files: reads cut by whole lines naming what they left out, plain-text file content, edits that survive copied line numbers, `append` for documents, `+N −M` on edit rows.

### v5.9 — 2026-10-23 · [PR #73](https://github.com/PratimeshTiwari/Agent-CLI/pull/73) · `v5.9/compact-in-thread`

- Compaction finally hands its summary to the fresh chat; asked of the same chat; between turns or paused mid-turn and resumed; a progress row. The task list moves to ctrl+o.

### v5.8 — 2026-10-23 · [PR #72](https://github.com/PratimeshTiwari/Agent-CLI/pull/72) · `v5.8/queue-drain`

- A queued prompt is sent when the turn ends, not when ↑ is pressed.

### v5.7 — 2026-10-23 · [PR #71](https://github.com/PratimeshTiwari/Agent-CLI/pull/71) · `v5.7/composer` · extension 1.46.0

- Prompts go in without the 5-second paste wait (Gemini's composer changed).

### v5.6 — 2026-10-23 · [PR #70](https://github.com/PratimeshTiwari/Agent-CLI/pull/70) · `v5.6/spawn-ebadf`

- Commands run again on large repos (`spawn EBADF` from the file watcher); `/reset` starts a repo fresh.

### v5.5 — 2026-10-23 · [PR #69](https://github.com/PratimeshTiwari/Agent-CLI/pull/69) · `v5.5/honest-busy` · extension 1.45.0 · companion 1.8.1

- The busy indicator lasts as long as the turn.

### v5.4 — 2026-10-19 · [PR #67](https://github.com/PratimeshTiwari/Agent-CLI/pull/67) · `v5.4/exit-and-shortcut`

- Exit clears the screen and prints the resume id; ⌘⇧1 says when it has no key.

### v5.3 — 2026-10-19 · [PR #66](https://github.com/PratimeshTiwari/Agent-CLI/pull/66) · `v5.3/hotkeys`

- Global ⌘⇧1 for the floating window; `cmd+alt+j` for the editor panel.

### v5.2 — 2026-10-19 · [PR #65](https://github.com/PratimeshTiwari/Agent-CLI/pull/65) · `v5.2/editor-panel` · companion 1.8.0

- A chat panel in the VS Code companion, sharing the Chrome side panel's renderer.

### v5.1 — 2026-10-19 · [PR #64](https://github.com/PratimeshTiwari/Agent-CLI/pull/64) · `v5.1/one-recovery-policy`

- One recovery policy: provider errors re-ask the failed prompt after a backoff; quota is never retried; rounds per turn recorded.

### v5.0 — 2026-10-19 · [PR #63](https://github.com/PratimeshTiwari/Agent-CLI/pull/63) · `v5.0/clean-slate`

- Clean slate: tests stop writing into `~/.agent`; dead code removed.

## Before v5

Versioned by what has actually merged into `main`. Each beta is one pull request
from one branch, and those branches are kept on purpose — they *are* the history,
so the list below can be checked rather than believed:

```bash
git log main --merges --format="%h %ad %s" --date=short
```

**Each entry shows the release number, the PR and the branch, because the three
stopped agreeing partway through and guessing between them is worse than saying
so.** The release number follows the `beta-vN` branch names, which run 1-8, then
10 and 11.

Two gaps cancel each other out, which is why the numbers look right again at the
end. **[PR #6](https://github.com/PratimeshTiwari/Agent-CLI/pull/6)** was opened and closed without merging, so the PR number runs one
ahead of the beta from v6 to v8. Then there is no **`beta-v9`** — that work
landed inside `beta-v10-code-cleanup` — and from v10 they line up once more.

**Beta v12 came from `fix/bridge-lock-and-cli`**, not a `beta-` branch. It was a
fix release, and it is numbered in sequence because it is the twelfth thing that
reached `main`.

Removals are listed with the reason, because on this project they matter as much
as the additions. The rule behind most of them: **a broken tool is worse than a
missing one**, since the model reaches for it and concludes the code is not there.

---

### v4.2 — 2026-09-27 · [PR #62](https://github.com/PratimeshTiwari/Agent-CLI/pull/62) · `v4.2/fixes-from-use` · extension 1.42.0

**Six reports from one session, two of them caused by v4.0.** Everything here was
found by using the product, and each fix was checked against the report rather
than reasoned towards.

- **A prompt pasted and never sent.** Gemini renders its send button only once the
  composer holds text, and the extension looked for it on a page timer — which in
  a background tab runs about once a minute. It looked once too early, then again
  after its deadline, and gave up with the button on screen. It now watches the
  page change instead. It also now **checks that a send happened**: Gemini clears
  the composer the moment it takes a prompt, so text still sitting there proves it
  didn't, and the extension clicks again. It never retries on uncertainty, and
  never once Gemini has started answering, so it cannot send twice.
- **Every round trip was about a second slower** than it used to be, for the same
  reason — a "50ms" pause that is a second long in a background tab. Typing went
  from a 27ms median to 994ms; it is back on the page's own clock.
- **A subagent ran on the wrong model,** and **a notice ended the turn.** v4.0's
  menu cleanup closed a model switch's menu while the switch was still using it,
  and the notice it sent was treated as fatal. The cleanup now waits for a running
  switch, and a notice can never end a turn.
- **A reply that read, in full, "json".** A tool call written on the same line as
  the model's reasoning left its code fence behind when the call was removed. The
  call itself always ran; only the leftovers reached the screen.
- **"Worked for ⠋ Thinking…"** read like a turn that had stopped. While a turn
  runs, the row now shows only the spinner and what it is doing.
- **Searching `a|b|c` found nothing.** The search tool matched that literally,
  pipes included, so the model concluded the code wasn't there and read whole
  files instead. Alternatives like that are searched separately now.

Two things are recorded rather than guessed at, because their cause isn't known:
a reply held for exactly twelve seconds after Gemini had finished, and a model
that lost the conversation after `/effort`. Both now leave a row in `/logs
notices` saying what happened, so the next occurrence settles them.

**After updating:** reload the extension *and* restart the agent — one of the
fixes is on the server side.

---

### v4.0 — 2026-09-27 · [PR #60](https://github.com/PratimeshTiwari/Agent-CLI/pull/60) · `v4.0/honest-log` · extension 1.41.0

**A new series, because the last one ended by measuring itself.** v3 was 34 PRs
in six days and did not feel like progress; the reason turned out to be
legible only once the failure log was read properly, and what it said is that
**the log was lying**. Over 09-25 → 09-27 it held 274 rows. Roughly **ten** were
product failures.

```bash
/logs                # failures
/logs notices        # the expected states that used to be counted as failures
```

#### The log now counts failures, not events

Three quarters of every row was one optional subsystem, and most of those were
*expected states*. The largest single entry — **65 rows** — was a background
`discover_models` poll declining to open a browser tab, at connect, before any
tab exists. That is correct behaviour: a poll must never make a window appear to
answer a question nobody asked. It was filed as a failure every session, on
every session, forever.

While that was true nobody could open `/logs` and see a regression, which is the
only thing the log is for. So there are two levels:

- **failures** — something went wrong, and someone should act on it;
- **notices** — an expected state, worth a record, nothing to do.

Demoted: the background poll's missing tab, `extension_stale` (which already
names its own fix), `inject_resumed` (a repair that worked), `grep_no_ripgrep`
(the fallback returns identical results, only slower), and the half of
`stale_response` that means *you pressed stop*.

**Demote, never drop.** Notices stay in the same file, collapse the same way, and
`/logs <flow>` still shows both marked `✗` and `·` — because a notice beside the
failure after it is often the explanation, and one stale build accounts for the
six selector faults under it. The temporary instrumentation that finally caught
v3's picker bug was exactly this kind of row; a log that discards what is merely
*expected* cannot be used to find out why an expectation was wrong.

#### Two things that were one name for two opposite readings

- **"No tab"** is correct for a background poll and a real fault for an
  `/effort` you typed — which has already tried to open a tab and failed. Only
  the extension knows which, because the discriminator is `userInitiated` and it
  lives in the browser, so the level now travels on the message. `switch_model`,
  `focus_tab` and a user-initiated discovery all stay loud; there is one
  condition deciding it and a test that fails if `switch_model` is ever added to
  it.
- **`stale_response`** — a reply arriving after the turn ended — meant either
  *you stopped it*, where discarding the reply is the feature working, or *a
  watchdog gave up*, where the deadline was shorter than the work. The second is
  the signal the row is worth having; undifferentiated, it was eight rows saying
  one of two opposite things. `noteUserStop` records the difference, and it is
  cleared when the next turn starts, because a reason with no clock is a flag
  that ages into a lie.

#### The picker can fail without costing a turn

Everything the model picker had was a *veto* — don't open a menu over a live
composer, don't act on a half-read list. A veto only works while every path that
could leave a menu open is known, and eight selector ladders against a page Google
redesigns without warning means that assumption expires without notice. An open
menu puts an overlay across the composer: the send lands on its backdrop and the
turn is lost, two turns away from whatever left it open.

So the turn stops trusting the picker. **Every prompt now clears a stuck menu
before typing** — synchronously, in two DOM reads when nothing is open, which is
every turn. It tries Escape before the menu's own button, and the order matters:
the button *toggles*, so pressing it after Escape has already closed the menu
opens it again. The first test page modelled a button that could only close and
could not see that; the one that ships toggles, like Gemini's.

And `switch_model` now refuses to open a menu while a prompt is going in, which
`discover_models` has done since 1.30.0. A subagent's switch is sent with no lane
check — its tab is its own, and its tab is exactly the one about to be typed into.

**Verified with the picker forced to fail on every call:** 20 of 20 turns
completed, five tool round trips and a subagent included, with two picker
failures landing in the middle of a turn. An `/effort` typed a second into a
deliberately slow turn was held for four seconds and sent **4ms after** that
turn's reply — the report that started this, *"/effort during a turn killed it"*,
no longer reproduces.

#### What the exit criterion actually measures

The log's goal was *fewer than five rows on a normal working day*. Re-scoring
09-27 under the new rules: **8 failures, 12 notices**, down from 20
undifferentiated rows — and **four of the remaining eight are the model picker**.
The picker work above stops those failures costing turns; it does not stop them
happening, because the selectors are the architecture. Whether a normal day now
reads under five is a reading to take after a few days of use, not a number to
write down today.

#### Found by trying to break the tests

Every demotion has a negative control naming the case that must stay loud, and
three of them did not work until they were checked by mutating the source and
watching the suite stay green:

- a **tally line that forgot its level** — the collapse writes one line for
  repeats 2..N, so 50 notices would have resurfaced as 49 failures. The storm
  test passed anyway, because inside the 60-second window the tally is still a
  number in memory and never reaches disk.
- **two copies of "write the tally"**, in `flushExpired` and `flushPending`.
  Deleting the level from one left everything green, because every test reached
  the other. Now one function: two copies of a thing is how one of them ends up
  forgetting.
- a test that **cleared the flag by hand** and then checked the result, which
  measures the test rather than the code.

A brittle assertion also went: `queued-prompts.test.js` bounded a source scrape
at 4,000 characters and went red when a comment was added above the line it was
looking for. It reads to the construct now — a test measuring a byte offset is
not measuring the thing it is named for.

---

### v3.12 – v3.27 — 2026-09-26 … 2026-09-27 · PRs [#44](https://github.com/PratimeshTiwari/Agent-CLI/pull/44)–[#59](https://github.com/PratimeshTiwari/Agent-CLI/pull/59)

**Sixteen PRs in two days, and what they made visible is why v4 starts with a
plan rather than another fix.** The model-picker hunt below (#26–#43) ended; this
is the work that came out of finishing it.

```bash
git log --oneline --merges v3.11..HEAD
```

**The effort ladder stopped being named after models** (#44). Three rungs, now
`low` / `medium` / `high`. The old names were the mistake: `flash` meant *our*
terse rung and *Google's* middle one, in the same sentence. Effort is how hard to
work; the model is whatever the browser's picker offers, read from the page.

**The picker's four matching strategies became two** (#45), and #46 brought both
READMEs current — which is the last time they were, until this entry.

**Three things the bridge was doing wrong, each found by watching it rather than
reasoning about it:**

- **It was clicking the microphone** (#54, extension 1.38.0). The send-button
  ladder had a structural fallback with no veto, so when every selector missed it
  picked the nearest icon button — starting dictation and losing the turn. A
  structural fallback needs a veto *and* containment; the mode picker's still has
  only the veto.
- **Subagents were silently running on the main model** (#55, 1.39.0).
- **A freshly opened tab reports ready before its picker exists** (#50, 1.37.0).
  Readiness is the *composer*, and Angular mounts the picker a beat later — so
  three separate bugs came from code that looked once and gave up. A ladder miss
  and a control that has not mounted yet are not the same thing.

**A stalled turn now ends on screen** (#56) instead of spinning for hours, and
**the subagent watchdog was 5.4× the slowest turn ever recorded** (#52) — five
minutes, against a measured p99 of 44.7s. Timings are now recorded per stage
(#49), including for turns that timed out, so the next timeout argument has
numbers: **median 8.5s, p90 20.9s, p99 44.7s, slowest ever 55.7s**.

**Notices raised outside a turn reach the transcript** (#48). `_notify` sent
`type: 'status'`, which every front-end draws as the label on the *spinner* — and
the spinner only exists during a turn. So `✓ Browser model is now …`, the
confirmation that the switch **worked**, was invisible for the entire time that
feature was being debugged, and so was every connect-time row.

**Two gated decisions closed on data** (#53). `/logs tools` records which tools
are actually called, one row per turn. The earlier hand-count — 41 sessions, 529
calls, eight of eighteen tools never called once — turned out not to be
repeatable at all: tool calls are stripped from a reply before it reaches the
session history, so a probe over 2,790 of them was matching `"name"` keys inside
tool *results*.

**Removed: terminal failure forwarding** (#51). The companion forwarded failed
commands to the CLI as a marker you could send or delete. Both halves worked and
the design was right. It **never wrote a single record** in its entire life,
because the offer appeared only when a command failed in an *unwatched* terminal,
once per session, as a dismissable toast. Zero uses is not a discoverability
hypothesis worth a second guess. The thing to fix first, if it returns, is that
the offer was tied to a failure happening.

**Also:** `/new` resends the base prompt and a half-built picker is retried
(#58); `ctrl+e` no longer expands a file read into the transcript (#57);
backspace works after recalling history into an empty prompt (#59); bridge
message dispatch went from 53% to 70% covered (#47).

#### Extension versions in this range

1.35.0 → 1.40.0, three of which are listed above as bugs they fixed. The
per-change record is in [`extension/README.md`](extension/README.md).

---

### v3.0 – v3.11 — 2026-09-22 … 2026-09-26 · PRs [#26](https://github.com/PratimeshTiwari/Agent-CLI/pull/26)–[#43](https://github.com/PratimeshTiwari/Agent-CLI/pull/43)

**Eighteen PRs, and one of them is the reason for the other seventeen.** The
model picker — the thing that puts the browser tab on the model the effort rung
was written for — did not work, and six separate attempts to fix it failed
before the cause was found. Everything below is either that hunt or work that
came out of it.

```bash
git log --oneline --merges v2.5.1..HEAD
npm test
```

#### The bug, and why it took six tries

`/effort pro` printed *"asked the browser for Gemini Pro"* and nothing further
ever happened. The server logged `model_options_unanswered` — the browser never
answered — and that sentence was **true of five different faults**: nothing
connected to ask, no tab to ask in, a tab whose content script is an orphan, a
read that threw, and a read that was declined. Each wants a different fix. The
server could only observe the last effect, so every attempt was a coin flip.

The cause was none of the five. The service worker relays messages from the
content script to the agent, by type — and **`model_options` had no case in
that switch**, so it hit `default` and was discarded one hop before the socket.
The picker had been read correctly the entire time: measured against the live
page at **27.7ms**, returning every option with its selection flag correct.

`gemini_response` *is* in that list. That single difference is the whole of
"prompts work but `/effort` and `ctrl+b` do not" — one path was relayed and the
other was not. `error` was dropped for the same reason, which is why the
content script's own failures never surfaced either.

It was found by **running the agent under a pty and reading the rows the run
did not produce**: no `extension_unreachable` (so it was delivered), no
"no tab this extension owns" (so a tab accepted it), and still no reply. That
leaves exactly one hop, and it was the only one nobody had read.

`test/background/relay-drift.test.js` makes the class impossible: it derives
the types the content script sends **from the content script's own source** and
asserts the worker handles each. A hand-maintained list is precisely what
drifted. It caught a second dropped message before it had finished being
written.

#### What the hunt produced that is worth keeping

- **The picker is read without knowing any product name.** The menu separates
  models from modes with a real `<mat-divider>`, and the rung maps onto
  position: lightest first, heaviest last. Confirmed against the live page and
  cross-checked against what Gemini's own `⌘⇧M` cycles, which walks exactly the
  entries above that rule. Flash-Lite and Flash are renamed across Google
  accounts and version numbers move; none of that reaches us now.
- **Page timers do not work in a hidden tab, and the picker is always read in
  one.** Measured on the real page: 28 chained `setTimeout(…, 50)` — nominal
  1.4s — did not complete in **45 seconds**, while a `MutationObserver` did the
  same work in 28ms. CLAUDE.md had recorded this for completion detection; the
  picker was a second caller of the same clock and had been left behind.
- **A message sent to nobody no longer looks like a message ignored.**
  `broadcast` always returned whether it reached a client and `_toExtension`
  discarded it, so five different commands could be sent into an empty room
  indistinguishably from the browser going quiet.
- **Whether a prompt was actually sent is observed, not inferred.** Gemini
  clears its composer when it accepts one, so text still sitting there proves
  the submit did not happen — and an empty composer proves it did, which is the
  half that prevents a double-send.

#### Other work in this range

- **Turn-0 false positive** (#28): `turn0_no_tools` fired on turns that *did*
  open files, because `isFirstReply` stays true through every tool round.
- **A paste that was "handled" and lost** (#29): `pasteHandled` asked whether
  anyone called `preventDefault`, which Gemini always does before inserting
  asynchronously — so a lost insert skipped the fallback and burned 30s waiting
  for a send button that cannot render without text.
- **Lanes and tab reuse** (#30): the model switch was the one tab interaction
  not serialised through `extension-lock`; subagent tasks opened a tab per
  round, measured at **64.8% of characters saved** once one tab was held.
- **The extension says which build it is** (#31): `identify` carries
  `chrome.runtime.getManifest().version`, compared with the manifest beside the
  server. A version badge is a number someone typed; `getManifest()` is what
  Chrome is running.

#### Extension versions in this range

1.26.0 → 1.34.0. The per-change record is in
[`extension/README.md`](extension/README.md), including the four releases that
fixed the wrong thing and the measurements that disproved them. They are kept
deliberately: this repo keeps its mistakes, because the reasoning that produced
them is the reasoning that would produce them again.

---

### v2.5.1 — 2026-09-22 · [PR #25](https://github.com/PratimeshTiwari/Agent-CLI/pull/25) · `v2.5.1/echo-and-guardrails`

**Four small fixes, each reported from use in the same session, none changing
behavior outside its own narrow case.**

```bash
git log --oneline v2.5..v2.5.1
```

#### `/compact` and `/undo` answered with nothing saying what caused it

Both rewrite the transcript instead of appending to it — `/undo` removes a
turn, `/compact` replaces the older ones with a summary — and only `/clear`'s
rewrite had reason to skip the `❯ /command` row that every other slash command
pushes before its reply. The other two glued their answer onto the end of
whatever the model last said, so a `/compact` refusal read as part of the
model's own reply. `/clear` is unaffected: it takes its own early-return path
above this branch and never reaches it.

#### `/compact`'s refusal mixed two units and read as self-contradictory

*"the older turns are only 114 characters"* sat directly above *"Context is
~23,248 tokens"* — both true, measuring different things, and side by side
they read as the tool contradicting itself. The first is
`conversationHistory.slice(0, -5)`, only what `/compact` would actually
summarise; the second is everything ever typed into the browser tab, system
prompt included, which is what auto-compaction actually watches. The message
now says which is which.

#### The model-picker warning couldn't tell "agrees" from "can't tell"

`modelMismatch` returned the same `null` whether the browser genuinely agreed
with the active rung or no picker read had ever succeeded — reported twice
from use, status bar on `PRO`, browser on a different model, no warning row
either time. `explainModelMismatch` exposes the real state, and a picker read
that comes back with a list but nothing marked selected is now logged
(`op: model_picker_unreadable`) instead of being silently indistinguishable
from agreement.

Confirmed live, not yet fixed: `discover_models` itself has no timeout, so a
request that never gets an answer leaves the picker's state unknown forever —
the warning cannot be shown, because it never receives anything to compare
against. Tracked for a follow-up.

#### Pro guessed file paths the terse rungs already refuse to

Reported from use: a `pro`-tier turn called `read_file` on an unverified path
with no search first. The guess was right, which is precisely why nothing
caught it — `core-terse.md` (the `lite` rung) and `reasoning-lite.md` both
say never to guess a path, and `pro-guardrails.md` did not, despite a code
comment claiming the rule had been folded into it. It hadn't: the guardrails
covered file *content* and function signatures already read, never path
*existence*. Restored, in pro's voice — `+261` characters, pro rung only.

---

### v2.2 — 2026-09-21 · [PR #20](https://github.com/PratimeshTiwari/Agent-CLI/pull/20) · `v2.2/tool-call-discipline`

**Evidence discipline.** An answer that arrives before its own evidence, and an
audit that could not see the claim it was written to check.

```bash
git log --oneline v2.1..v2.2
```

#### The audit could not see a claim about files

Reported with screenshots. A `## Review` block closed a turn with five
**Verified Files**, two of which did not exist — one of them in
`server/src/github/`, a directory deleted wholesale in `e375aed`. The
architecture above it was invented too: an `agentLoop.on(...)` event API, `F2`
navigation and three dialog components, none of which exist.

`handover-audit.js` exists for exactly this and passed it clean, twice over. Its
label table could return `ran`, `callers` or `checklist` and nothing else, while
carrying a `read` entry no label could ever reach — dead the day it was written,
and invisible because a detector that never fires looks identical to one with
nothing to report. And its parser required `- Label: value`, skipping any line
whose value was empty — which is the shape real blocks use, with the paths
nested beneath.

A path either exists or it does not, which makes this the one claim in a
handover that can be settled rather than weighed. It now is, twice: the path has
to exist, **and** the turn has to have opened it. The count alone only answered
"did anything get read", which a block citing five files passes on the strength
of one unrelated read elsewhere in the turn — so the per-turn record now keeps
which files were touched, not just how many times. `grep_search` and
`list_directory` deliberately do not count: they yield paths the model has seen
*mentioned*, and citing from a search result without opening the file is the
exact failure this exists to catch.

Unsupported is still not false. A model may legitimately cite something it read
three turns ago, so a finding says what *this turn* has no record of — a fact
that can be checked — and never that the claim is a lie. It still fails open on
prose, on an honest "none", and on a bare directory, because a detector that
punishes an unusual format teaches the model to stop emitting the format.

#### A conclusion written before its evidence is not shown

A tool call is a question; a handover block is "I am done". A reply carrying both
concluded before the results existed.

**The model had already been told** — every tool-result turn ends with *"Reply
once, with exactly one of: the next tool call, or your final answer to the
user"*, and that is the turn this happened on. So the matching prompt rule, now
added for the `flash` and `pro` rungs, is the weaker half. The loop declining to
print the conclusion is the fix; an instruction can be ignored, and was.

Detected on the handover block alone, never on length or tone: ordinary
narration beside a tool call is correct and common.

#### Three things that were happening and counted nowhere

- **`turn0_no_tools`** — turn 0 asked about the code and answered without
  opening anything. The most-reported failure here, and it had no log row at
  all: the existing detector catches an *explicit* refusal, which sits at
  0.38%, while a model answering from priors and denying nothing produced
  silence.
- **`premature_conclusion`** — the reply above, as a rate.
- **The picker mismatch could not see its own case.** The warning for "your tab
  is on Flash while the agent is on `pro`" compares against a model list
  requested **once**, 1.5s after the extension connects. Change the picker
  mid-session — which is exactly when people change it — and the stale list
  still said Pro. Re-read at the end of a turn now, throttled to a minute.

#### Also

- **`/compact` no longer draws the transcript twice.** The rebuild dropped the
  position marker the merge runs on, so the next real turn appended the whole
  history again: measured at 6 rows on screen, **11** after one merge.

---

### v2.1 — 2026-09-21 · [PR #19](https://github.com/PratimeshTiwari/Agent-CLI/pull/19) · `v2.1/fix/tool-call-parsing-and-resume`

Three faults reported from use, each reproduced before it was touched. What they
have in common: the product was measured rather than reasoned about, and in two
of the three the written explanation of the behaviour was itself wrong.

```bash
git log --oneline main..v2.1
npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"
```

#### Prose is not a malformed tool call

Asked whether the system prompt should be re-sent in chunks, the model answered
correctly and illustrated it with a **bare** code fence. Gemini labels an
untagged fence "Plaintext" in its own UI, so nothing on screen suggested JSON —
but the parser's language tag was optional and the body only had to open with
`[` and close with `}`. Measured: `plaintext`, `text` and `bash` all escape;
untagged is the one that matches.

The throw sits inside the `replace` callback, so it discarded the **entire
reply**. The loop then sent *"Please correct the previous JSON formatting
error."* into the thread — about a tool call that was never made. Models comply
with false premises: it invented one and spent the turn investigating a question
it had already answered. Preserved in `.agent/logs/errors.jsonl`.

A block that yields no call is also no longer deleted from the reply, so a model
answering "your config should be:" keeps its answer.

#### `--resume` and `--continue` reach the browser

The model's memory is the Gemini chat thread, not `history.jsonl`, and the whole
chain to reopen it existed — `open_thread` → `chrome.tabs.update(/app/<id>)`.
Only `/history` and the side panel called it. The launch flags called the
*storage* method and stopped, so the transcript came back while the tab opened a
new conversation and the model was told nothing about either.

The invariant is now asserted directly: a reopened thread **or** a recap, never
neither. Verified end-to-end against a fake extension over the real bridge.

#### `/update` says it is working

Bare `/update` runs `git fetch origin` — **1,086ms warm, up to 10s cold** — and
raised no spinner, so the input box cleared and nothing happened. Reported as
*"/update seems glitched out."* The comment in the source claiming a spinner was
unavailable "because `/update` on its own answers instantly" had never been
measured and was false.

#### Removed: `open_in_editor`

Opened a file in your editor at a line. Deleted because the terminal already
does it better and for free: paths printed as `file.js:12` are clickable in
every terminal this runs in, so the tool spent a browser round trip to reach a
worse version of a thing that was one click away.

It had also never been called — not once in 41 sessions — which is the evidence
that decided it. Seven other tools share that zero and are **kept**: four are
useful and need a trigger rather than a reminder, and three are correctly idle
(`manage_task` has nothing to manage while `run_background` is unused;
`recall_history` has nothing to recall until `/compact` stops stalling).

`isVSCodeFamily` in `core/host-editor.js` is now unreferenced outside its own
test. Left in place and flagged rather than swept up with this, because an
audit of dead exports is its own pass.

#### Measured while looking

- A turn costs **4,673ms median** (14,913ms p90) over 265 real turns, of which
  typing the prompt is **23ms — 0.5%**. Prompt length is nearly free; round
  trips are not.
- Turn 0 on `pro` is **26,268 characters ≈ 6,557 tokens**; turn 1 is **370**.
- **Eight of eighteen tools have never been called**, despite being named on
  every turn. A name is not a trigger.

---

### v2 — 2026-09-20 · [PR #17](https://github.com/PratimeshTiwari/Agent-CLI/pull/17) · `fix/bridge-speed-and-stability`

**Most of it is `fix`** — this release is mostly the product being made to do
what it already said it did.

```bash
git show --stat fb2c955
```

The count was deliberately never written out in prose. It said "113 commits
ahead" for about a day, during which it was wrong roughly forty times — and "82"
for another, which is the same mistake made by the paragraph warning about it.
That rule still stands for every entry above: print the command, not the number.

#### What this branch is

Three things, and the first is most of it.

**Nine bugs of one shape: the model was told the truth and the code did
something else** — see *Told the truth, enforced something else* below. Plan
mode exempting every `.md` file anywhere, `run_background` reaching none of the
safety machinery, `find_references` answering **0** for every method under a
message reading "It may be dead code". Every one was found by *using* the agent.

**The bridge stopped losing turns.** The reconnect alarm was being cleared on
connect, so a healthy bridge had none; prompts dispatched while Chrome was away
were written to no sockets and dropped; and the turn's clock lived in a tab
Chrome throttles to roughly one tick a minute, which is the whole of "it hangs
while I'm not looking at Chrome".

**Two subsystems removed**, and `agent-loop.js` taken apart: the GitHub PR agent
(2,009 lines, documented first for a possible rebuild) and ChatGPT (one bridge,
one model). `agent-loop.js` 2,669 → 2,193 lines.

**The transcript stopped lying about order and about how many times it happened.**
A turn is drawn in the order things occurred rather than "all the tools, then all
the prose" — and `<Static>` is handed **rows** instead of turns. Ink's `<Static>`
never re-renders an item, so a growing turn could only be shown by remounting it
and reprinting the whole transcript *below* the copy already on screen. On a tall
terminal you saw the banner three times, once per tool round. Measured at 210×64:
**3× → 1×**, 0 full clears, 22,868 → 15,312 bytes.

**The effort ladder is three rungs** — `low`, `medium`, `high` — because
five was one tier wearing three hats. `standard → deep` was three substantive
blocks for 4.2%, so `pro` is the old `standard` plus the one of them with a
demonstrated job: a second tab reading the diff cold. The other two are paid in
*output* tokens on every turn, which no prompt measurement shows.

**Added**
- `/history` — reopen a past conversation from inside the session.
- `/image <path>` and `/image remove`, with `1 image` in the status bar.
- `d` on a diff opens the rest of it before you approve.
- `ctrl+b` brings the Gemini tab forward.
- The task panel gets its own key, state and row budget.
- Prompts typed during a turn are queued; `↑` takes one back.
- A handover review that arrives when there is something to hand over, checked
  against what the turn actually did.
- One ceiling for a batch of tool results, divided fairly rather than
  first-come.
- A warning when the browser tab is on a different model from the effort rung,
  naming both and the key that shows the tab.
- `/open` says when the file is not there; `/clear` says which half it cleared.
- Escape clears what you typed before it kills a turn.
- The settings exit screen reports what you changed, not what moved.
- Plan mode offers the mode switch on the diff, where the evidence is.
- `setup.sh` asks where to install.
- A pty harness in the repo — 20 scenarios driving the real CLI with a fake
  extension, asserting text, files, drawing order, string counts, and that the
  frame cost 0 full clears.

**Removed**
- The GitHub PR agent — `github/`, the tab, two hooks, a content script.
- ChatGPT, the second bridge, and `topology` as a stored setting.
- `figlet` and `@inquirer/prompts`; `node_modules` 98.5 MB → 72.7 MB.
- The `brief` and `deep` effort rungs; a stored config naming one folds to `high`.
- `server/README.md` — the root README and `CLAUDE.md` already covered it.

**Changed**
- The rungs are named after the tabs they expect: `lite` · `flash` · `pro`.
  (Renamed again in v3 to `low` · `medium` · `high` — naming them after models is
  what made `flash` mean two different things.)
- Tables are drawn at the width the terminal actually is.
- Plain `✓` / `!` instead of emoji on the compaction, diff and model-switch rows.
- Two latency bugs, measured: a reply ending in a code block was read as
  mid-construct (**−10.8s on ~13% of rounds**) and the send path slept 500ms
  before looking (**−0.5s every round**). Extension **1.25.0**.

**Quality**: 1,755 tests (1,545 server + 210 extension) and 20 pty scenarios, **92.8% line coverage** (91.0% branch, 94.4% function).


#### The GitHub PR agent is gone (2026-09-19)
- **Removed**, and documented in `CLAUDE.md` in enough detail to rebuild from:
  what each of the nine files did, the interface decisions worth keeping, and
  the two things that were still broken. 2,009 lines plus a tab, two hooks, a
  content script and eight test files.
- *Why:* every `flow: 'github'` entry in the error log was `poll: fetch failed`,
  three review directories were ever written, and the tab left comments reading
  `⚠ not analysed` after being sent for analysis. It was a second product inside
  the first, and the first still had bugs that stopped it doing its job.
- The migrations stay: an older `.agent/github-pr-plans/` is still renamed on
  startup, and the `github` flow label in the error log still exists so old logs
  stay readable.

#### One model, and five things that were silently wrong (2026-09-19)
- **ChatGPT removed.** One bridge, one model. *Duo* now means a second Gemini
  tab that has not seen your conversation — which is the half of a reviewer
  that was ever doing the work. A config naming ChatGPT is folded to Gemini on
  read, because config saving preserves keys it does not own and a stored
  `main: 'chatgpt'` would otherwise point the agent at a site with no bridge.
- **A review that ends in prose is kept.** `ask_reviewer` produced a complete
  adversarial review, failed to wrap it in `return_result`, and the whole thing
  was discarded as a failure with the answer sitting in the payload.
- **`/compact` actually hands the conversation over.** It summarised, reset the
  prompt state and reset the context counter — and never told the browser, so
  the tab stayed on the thread that still held every turn it had just
  summarised. The counter then described a conversation that did not exist, in
  the status bar, in `/context` and in the auto-compaction threshold at once.
  The new chat is acknowledged now, and the counter only resets if it happened.
- **`/clear` stops zeroing the context counter.** It clears the CLI's record and
  deliberately leaves the tab alone, so the model still remembers — and the bar
  should say so.
- **The tool-call repair loop is capped at two.** Every other retry here was
  capped; a model stuck on a formatting habit could re-ask forever, a full
  browser turn each round. When it stops it hands you the raw reply, which
  usually contains the answer in prose.
- **The bridge can be injected twice.** Its constants were declared at the top
  level of a world that outlives the script, so re-injecting threw
  `Identifier … has already been declared` on line one. That silently disabled
  the repair rung written for exactly the case that guarantees a copy is already
  there. It also stops the copy it replaces, rather than leaving its observers
  running.

#### Told the truth, enforced something else (2026-09-19)

Nine of these, all the same shape and all found by *using* the agent rather
than reading it. The model was given an accurate description and the code did
something different — which is the worst of the three arrangements, because
nothing on screen gives you a reason to doubt it.

- **Plan mode exempted every `.md` file, anywhere.** The exemption itself was
  deliberate and is kept: `task.md` and `plan.md` are files the system prompt
  *tells* the model to keep current, and it cannot tick a checklist if every
  tick needs a keystroke. The bug was that the test was the **extension**
  instead of the **location**, so `README.md`, `CLAUDE.md`, `AGENT.md` — and
  anything at all outside the workspace, since these tools take absolute paths
  — were exempt too. It now resolves the path and checks it is inside
  `.agent/artifacts/`, and fails closed on anything it cannot resolve.
- **`run_background` reached none of the safety machinery.** Not the risk
  classifier, not the `critical` block, not the command log, and not plan
  mode's approval — for the one tool that leaves a process running after the
  turn ends. Every gate was written as `name === 'run_command'`.
- **And plan mode still let it through after that was fixed.** The read-only
  exemption said *any shell tool the classifier calls safe*, and
  `run_background` is a shell tool — so `run_background npm run dev` was exempt
  on the strength of a verdict about the **command text**, while the process it
  spawns outlives the turn. The classifier reads a string; it cannot see that.
- **`grep_search`'s `includes` matched nothing whenever it named a path**, and
  its `pattern` rejected the array its own description told the model to send.
- **Six tool parameters were undocumented**, one of them in neither form — so
  the model never sent them. The drift check that should have caught it was
  comparing an empty list to an empty list.
- **`find_references` answered 0 for every method**, under the message *"It may
  be dead code."* A method is only ever called as `x.name()`, and member
  properties were excluded — correctly for a variable, wrongly for a method.
  Measured on this repo: `buildToolResultBatch` 0 against 17 real call sites.
  That is a tool arguing for the deletion of code called everywhere.
- **…and the definition was missing** from the same answer, which promises
  "list the definition too".
- **`run_command`'s timeout pointed at an alternative it never named**, and
  `cwd: "."` was judged outside the workspace, so the agent could not run its
  own tests.

The cure in each case was the same: stop keeping a list at the call site.
Approval is decided in `core/tool-policy.js` from the catalog's own
`mutates` / `shell` / `detached` flags, so a tool that writes is gated by
saying so once, beside its description.

#### Smaller, from the same pass (2026-09-19)
- **An attached image can be removed.** `/image remove`, and the status bar
  says `1 image` while one is armed. Before this, the only ways to be rid of one
  were to send it or restart — and nothing on screen said it was there.
- **An instant command stops leaving a frozen `Thinking…` behind.** Every local
  command raised a spinner and took it down a moment later, around a write to
  the committed transcript — stranding the row above the command it belonged
  to, at `0s`, forever. Only `/compact` waits on anything, so only `/compact`
  raises it now.
- **The turn's confirming look leaked a timer, once per turn, compounding.** It
  was scheduled with a `setTimeout` nobody held, so stopping a turn did not stop
  it — and the next turn re-armed the same orphan into a second polling chain at
  the old cadence, with no handle anywhere to stop it.
- **A rejected edit stops looking like an applied one.** The model was told the
  truth and the transcript drew `✓ edit_file` in green on a change never
  written.

#### Made honest by testing it (2026-09-19, late)

Coverage was measured rather than assumed — `node --test
--experimental-test-coverage` — and the low files were worked in order of how
badly they would fail, not how interesting they were.

- **Every tool is now called once by a test.** That sweep did not exist, and its
  absence had already shipped a total breakage: a stray edit left `find_symbol`
  referring to a variable it never defines, so **every** call returned
  `isMethod is not defined` while 1,474 other tests stayed green. The sweep
  asserts almost nothing about what comes back — only that the call the agent
  makes does not throw, which is the failure that costs a whole turn.
- **Every slash command is now driven once, bare and with arguments.**
  `use-slash-commands.js` was the least-covered file in the repo at 8.7%, and
  the surface almost every bug reported from use has come from. It is 55.5% now.
- **A wrong effort word is rejected instead of ignored.** `/effort deeep` fell
  through to the status display, which prints the current rung and the ladder
  and reads exactly like a confirmation — so you believe it changed and every
  later turn goes out on the old rung.
- **A bare `/` lists the commands.** It used to answer `No such command: /` and
  then advise "Type `/` on its own to see what there is", which is what had just
  been done. An unknown command now says so *and then* lists them.
- **The minifier on the tool-result path always returns a string.** A cycle or a
  BigInt threw, was caught, and returned `''` — handing the model a tool that
  ran and produced nothing, which is worse than an error. Every test fixture
  passed a *string* result, so that branch had never been taken.
- **The startup migration's three promises are assertions now.** It moves your
  config, instructions, backups and logs before anything is on screen, and sat
  at 46% coverage. Nothing was wrong — all four behaviours were probed first and
  all four held — but a migration that clobbers has destroyed the thing it
  overwrote by the time anyone looks.
- **`server/README.md` is gone.** It had drifted for nine days advertising two
  subsystems deleted in September, and everything in it was already in this file
  or `CLAUDE.md`. A third document is a third place to drift.

### v1.0 — 2026-09-16 · [PR #13](https://github.com/PratimeshTiwari/Agent-CLI/pull/13) · `v1-stable`

The largest release by far, so it is grouped by area rather than listed flat.
`v1.1-bug-fixes` ([PR #14](https://github.com/PratimeshTiwari/Agent-CLI/pull/14)) and `v1.2-github` ([PR #16](https://github.com/PratimeshTiwari/Agent-CLI/pull/16)) followed it on 2026-09-17;
their changes are folded into the areas below rather than split out, because
they were fixes to this work rather than a release of their own.

#### At a glance

The detail is grouped by area below. This is the shape of it.

**Added**
- `find_symbol` / `find_references` — structural code search, on acorn.
- `run_background` + `manage_task` — dev servers and watchers that outlive a turn.
- `recall_history` — the model can look into its own compacted history.
- A **reviewer** (`/config`) with no memory of the conversation that produced
  the work.
- `/plans`, `/commands`, `/logs`, `/update`, `/name`, `/restart`.
- A **command audit trail** — every shell command run, blocked or refused.
- `/image` — attach a screenshot from the clipboard.
- A VS Code companion that forwards failed terminal commands and the Problems panel.

**Changed**
- **One instruction surface**: `AGENT.md`, walked up from the code.
- **One effort ladder**: `/effort` — flash · flash-thinking · brief · standard · deep.
- Startup **2.46 s → 0.53 s** to the prompt box.

**Removed**
- `semantic_search` and the retrieval subsystem; `ast-chunker`; the skills registry.
- `rules.md`, `mistakes.md`, `contextFolders`, `memory.json`.
- `topology`, `reasoningEffort`, `modelTier`/`reasoningLevel` as stored settings.
- Mouse tracking, permanently — scroll, drag-select and copy are the terminal's.
- The runtime scope switcher, and `/agent-dir`.

**Fixed** — the flicker that was deleting your scrollback seven times a second,
the auto-mode command classifier that could be walked past with a `;`, a bridge
that bound to every interface with no auth, and `diff-engine` writing backups
outside the backup directory.

#### The engine
- **Prompt economics.** The full system prompt goes out on turn 0 and every Nth
  turn, never every turn — resending a large payload each time trips Gemini's
  repetition filters and A/B-test modals. The **tool anchor** (names only, 56
  tokens) rides every turn anyway, because the model does not gradually forget
  its tools: it forgets them completely and then denies having any.
- **One list of tools** (`core/tool-catalog.js`). Four places had to agree about
  which tools exist and nothing checked any pair, which is how `recall_history`
  and `get_diagnostics` shipped registered, implemented and **unreachable**.
- **One lane per tab** — `main:<model>` and `sub:<requestId>` — so a background
  background turn and your own prompt genuinely overlap instead of queueing.
- **The extension addresses tabs by identity.** It used to take whatever tab was
  last, so your prompt could land in the middle of a subagent's conversation.
- **Removed: `semantic_search` and the whole retrieval subsystem** (~290 lines,
  the `madge` dependency, and a full-repo read at every startup). *Why:* its
  tokenizer split on non-alphanumerics only, so `getUserById` was one token and
  the query `user` could never match it — broken for the query type that
  dominates code search.
- **Removed: the Claude bridge, `swarm` topology and `ask_reasoner`** (~520
  lines, 14 DOM selectors). *Why:* cross-model review is the point and two
  bridges deliver it; the third was maintenance for something a second model
  already provided.

#### Search and context
- **`find_symbol` / `find_references`** — exact and structural. They return the
  definition rather than the forty call sites, and never the name in a comment
  or a string. For a **method**, `x.name()` uses are included and marked, because
  that is the only way a method is ever called — without that, "who calls this?"
  answered *nothing* for every method in a codebase.
- **`grep_search` takes several patterns at once**, because when you do not know
  what a codebase calls something, guessing one term at a time costs a round
  trip per guess.
- **Session recall** — the agent can look up turns that compaction replaced with
  a summary. Better than making compaction cleverer, because it does not require
  deciding in advance what will matter.
- **Removed: `ast-chunker`.** *Why:* it walked `ast.body` only, so every class
  method and every `export const foo = () => {}` was invisible — it resolved
  **24%** of this repo's own top-level symbols. Its replacement uses
  `acorn-walk` and `acorn-jsx` and resolves 282 of 282.
- **Rejected: an embedding index**, considered and argued down rather than
  overlooked. The context window here is a browser chat tab, so twenty retrieved
  chunks is 10,000 tokens typed into Gemini per query, most of it unread.

#### Telling the agent about your project
- **`AGENT.md`, walked up from the code** so the nearest file wins, and a
  Context tab listing every instruction source with its state — loaded, empty,
  missing, or *an unedited template*. That last state was found by pointing the
  detector at this repo.
- **Removed: `rules.md`, `mistakes.md`, `contextFolders`,
  `/context add|remove|list`, `/init-skills`.** *Why:* seven mechanisms existed
  for "tell the model about this project", with six different discovery rules
  between them. The count of *rules* was the mess. Two axes, one mechanism each:
  **where the file is** decides who it applies to, **which file** decides whether
  it is always in context (`AGENT.md`) or fetched on request (`skills/`).
  Retired files are **named, never moved** — `AGENT.md` is usually tracked in
  git, so folding `rules.md` into it would write an unasked-for diff into your
  repo on startup.
- **Removed: `memory.json`**, converted to `memory.md`. *Why:* a learned fact is
  exactly the thing that is subtly wrong six weeks later, and a fact you cannot
  correct in an editor does not get corrected.
- **Fixed twice: the write-only trap.** `manage_memory` wrote facts to disk and
  no prompt ever carried one back — a tool call per fact, forever, for nothing.
  The same shape turned up again in `.agent/artifacts/task.md`: the model was
  told to keep a checklist and tick it off, and never saw the file again, so
  ticking meant guessing the exact line text. Both ride the prompt now.

#### Safety
- **Every write becomes a diff** with per-hunk accept/reject, a backup and
  `undo()`. Nothing reaches disk unreviewed.
- **A shell lexer**, because the command classifier could be walked straight
  past: `echo hi; rm -rf /tmp/x` classified as *safe* on its first word. Every
  segment is classified now and the worst one wins.
- **The bridge binds to `127.0.0.1` and checks `Origin`.** It used to bind to
  every interface with no auth, on a tool that runs shell commands.
- **An audit trail** — `.agent/logs/commands/<date>.jsonl`, every command run,
  blocked or rejected. Nothing reads it back into a prompt. `git push --force`
  does not fail, so the error log never sees the one command you would most want
  to find later.
- **`/logs rates`** — how often the text channel itself fails, as a rate. Seven
  parse failures is not something you can act on; seven in 412 turns is.

#### The terminal UI
- **Settled turns go to scrollback**, only the in-flight turn is live, and every
  live row is bounded. When Ink's frame outgrows the viewport it clears the
  screen on *every* render: measured at 108 full clears and 3.85 MB of escape
  codes in 15 seconds, which is what "it flickers and I can't scroll or copy"
  actually was. A later measurement found the same fault from *below* — the
  frame had a minimum height, so a terminal under 13 rows overflowed however
  much the turn gave up.
- **Code blocks you can drag-select cleanly**, with the language on a dim rule
  outside what a drag picks up, and `ctrl+y` for the last block.
- **A real multi-line prompt**, bounded to a third of the viewport.
- **Removed: mouse tracking, permanently.** *Why:* a terminal that is tracking
  hands the app the wheel and suppresses drag-select. Everything clickable
  became a keybinding, so scroll, selection and copy stay your terminal's.
- **Removed: the transcript selection model.** *Why:* Ink cannot repaint what it
  has committed, so there is nothing to point at a single row with. `ctrl+e`
  toggles every step at once instead.

#### Configuration
- **Removed: `reasoningEffort`, `modelTier` and `reasoningLevel` as stored
  keys.** *Why:* nine states for five meanings, and the UI apologised for the
  impossible combinations at the point of use instead of preventing them. One
  ladder now — `flash`, `flash-thinking`, `brief`, `standard`, `deep` — with the
  rest derived, so they cannot disagree.
- **Removed: `topology` as a setting**, `/mode`, and the mode menu. *Why:* a
  derived value in a config file is one someone edits and is ignored for
  editing. It is a getter over `modelConfig` now.
- **Removed: the runtime scope switcher.** *Why:* its own doc comment said
  switching scope "is closer to opening a different project than to changing a
  setting" — which is the argument against having it as a setting. `--scope` at
  launch reaches the same place with no window where the transcript on screen
  belongs to the old scope.

#### Commands and configuration
- **`/update`** — notice when `main` has moved, pull it, and say exactly what
  that leaves you to reload. Three artifacts ship from this repo and pulling
  only updates one of them: the extension bundle needs a reload, content
  scripts a hard refresh, and the `.vsix` a reinstall. The reminder is derived
  from what actually changed, and it survives the restart until you say it is
  done.
- **`/name <text>`** — name the agent, which until now could only be done by
  editing a file that does not exist in a fresh clone. It had a reader (the
  banner) and no writer.
- **`find_symbol` / `find_references`** in the tool list, and `/logs rates`.

#### Housekeeping
- **Removed as dead:** `TokenCounter` (a 30-line class nothing could reach), five `paths.js`
  helpers with no caller — two of them leftovers of the deleted retrieval subsystem — and
  three test seams no test ever used. `chalk` as a dependency.
- **Fixed, found by the same audit:** `/set-workspace` has always had a **recent** category
  and nothing ever wrote the file it reads, so it silently offered nothing. One missing call.
- **A setting changed from `/settings` now shows that it changed.** Four screens ran the
  command and then put the reply in the transcript *after* reopening the settings page on
  top of it — so the change happened and the confirmation was invisible.
- **A restart no longer goes out from under a running turn.** `/workspace`, `/restart` and
  `/update` left immediately; the browser kept generating into a socket nobody was holding
  and the reply was never drawn.
- **Gemini's tables and nested lists survive the scrape.** The reply's DOM is converted by a
  walker now rather than a series of passes, so a tag nobody listed still comes out readable
  — `<table>`, `<blockquote>`, `<del>` and `<dl>` were all being concatenated or dropped.
- **`/open` uses the editor this terminal is running inside.** It fell back to a hardcoded
  `code`, which no VS Code *fork* installs, and then to the OS default for the file type —
  which is how a markdown file opened in RStudio.

#### Not done, on purpose
- **The two bridges were not collapsed** — and then one of them was deleted,
  on 2026-09-19, which settled the argument by removing its subject. Keeping
  ~600 duplicated lines was defensible while both shipped: the cost it removed
  was "fix it twice", and fixing the scrape twice took one commit. The jsdom
  tests still run, against the one bridge, and say in a comment not to restore
  a second target just to make the comparison mean something again.
- **An optional API backend** stays a fork rather than a plan. It would remove
  the ceiling — structured tool calls, real parallelism, caching — and it
  contradicts the standing "no API keys" decision that is the identity of the
  project.

---

### Beta v12 — 2026-09-07 · [PR #12](https://github.com/PratimeshTiwari/Agent-CLI/pull/12) · `fix/bridge-lock-and-cli`

- **Installed as `agent`**, running in the current directory.
- **The extension lock is handed back when a turn dies**, not only when it
  finishes. A wedged lock silently swallowed every later prompt.
- **A failed scrape is reported in seconds, not five minutes.**
- Extension renamed to "Gemini Agent Bridge" and bumped to 1.1.0.
- **Removed:** `jest`, a duplicate `esbuild`, and `ora`. *Why:* unused
  dependencies on a tool people install globally.

### Beta v11 — 2026-09-07 · [PR #11](https://github.com/PratimeshTiwari/Agent-CLI/pull/11) · `beta-11-followup`

- **Reworked what goes to the model and how often** — the turn-0-and-every-Nth
  rule this project's prompt economics still rest on.
- **Reasoning levels for the pro tier.**
- **Questions that can be answered, dismissed, or asked in a batch.**
- **The edit-approval prompt shows the change** it is asking about.
- **A live spinner on running tool rows**, and a refined GitHub dashboard.
- **`.agent/backups` is pruned.**
- **Fixed:** saving config destroyed keys it did not own; a rejected GitHub
  token could not be cleared.

### Beta v10 — 2026-09-05 · [PR #10](https://github.com/PratimeshTiwari/Agent-CLI/pull/10) · `beta-v10-code-cleanup`

The consolidation release.

- **All workspace state unified under `.agent/`**, with `paths.js` as the single
  source of truth.
- **`server/src` reorganised into named folders** — `core/`, `bridge/`,
  `context/`, `github/`, `mcp/`, `ui/`.
- **Claude-Code-style transcript**, slash palette.
- **The agent loop blocks on diff approval** instead of racing past it.
- **Removed: local LLM support.** *Why:* a second inference path with its own
  failure modes, competing with the browser bridge that is the point of the
  project.
- **Removed:** dead code and unused dependencies; the GitHub plans folder is no
  longer created just by constructing the handler.

### Beta v8 — 2026-09-05 · [PR #9](https://github.com/PratimeshTiwari/Agent-CLI/pull/9) · `beta-v8-ui`

- **Claude Code visual aesthetic**, and the first fix for the scroll glitches.
- **Fixed:** missing tabs and UI rendering issues.

### Beta v7 — 2026-09-04 · [PR #8](https://github.com/PratimeshTiwari/Agent-CLI/pull/8) · `beta-v7-parallel-subagents`

- **`<Static>` for native history scrolling** — the change the whole current
  frame-budget design grew out of.
- **The header became a footer**, so settled history flows into scrollback.
- **Chrome extension tab pooling and the wakeup protocol.**
- **Production edge cases:** compaction, fuzzy diff matching, OS-error retries,
  swarming.
- **Fixed:** subagent routing; explicit flex constraints so Ink stopped
  overlapping text.

### Beta v6 — 2026-09-02 · [PR #7](https://github.com/PratimeshTiwari/Agent-CLI/pull/7) · `beta-v6-system-prompts`

- **Tiered model profiles** and a GitHub PR agent rewrite.
- **Context routing, self-correction, and the command allowlist** — with a
  toggle, so it can be turned off without editing config.

### Beta v5 — 2026-08-30 · [PR #5](https://github.com/PratimeshTiwari/Agent-CLI/pull/5) · `beta-v5-github-agent`

- **The GitHub PR agent**: a headless agent loop, PR-specific directories, a
  concurrency queue, and a five-stage comment-analysis prompt.
- **Fixed:** background callbacks were not wired, so the agent never actually
  invoked the AI.

### Beta v4 — 2026-08-30 · [PR #4](https://github.com/PratimeshTiwari/Agent-CLI/pull/4) · `beta-v4-subagents`

- **Subagents**, reasoning profiles, a modularised extension, and UI
  virtualisation.
- **Local LLM support** (removed again in v10).

### Beta v3 — 2026-08-27 · [PR #3](https://github.com/PratimeshTiwari/Agent-CLI/pull/3) · `beta-v3`

- **The CLI UI**, and the first serious pass at the prompt.

### Beta v2 — 2026-08-27 · [PR #2](https://github.com/PratimeshTiwari/Agent-CLI/pull/2) · `beta-v2`

- **Multi-model support** — ChatGPT and Claude bridges alongside Gemini.
- **Fixed:** DOM reliability, error handling, and the CLI workflow.

### Beta v1 — 2026-08-27 · [PR #1](https://github.com/PratimeshTiwari/Agent-CLI/pull/1) · `beta-v1`

- **Smart context management**, image support, and extension stability.

### Initial release — 2026-08-18

The agent, straight onto `main` before the branch-and-PR rule existed: the
browser bridge, the agent loop, and tool-call parsing out of reply text. Four
commits, including two bug fixes for multi-line paste and the tool-call regex.
