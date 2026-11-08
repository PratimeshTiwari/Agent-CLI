# Branching, product decisions and history pointers

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Branching and PRs

**Never commit or push to `main` directly. Work lands on a branch and merges through a PR.**

The branches in this repo are deliberate: they are the history. `beta-v1` … `beta-v10`,
`fix/bridge-lock-and-cli`, `v1-stable` are kept on purpose, not left behind. Do not delete
them, and do not squash their history away.

- Branch from `main`, named `vN.M/short-description`. The series reached **v3.27**;
  **v4 opened with `v4.0/honest-log`** — v3 was 34 PRs in six days that did not feel like
  progress, and the reason only became legible once the failure log stopped counting expected
  states as failures. v4 was the production-readiness plan in
  `.agent/artifacts/plans/2026-09-27-production-readiness.md` and closed with #62
  (`v4.2/fixes-from-use`). **v5 opens with `v5.0/clean-slate`**: cleanup, one recovery policy
  for the reply path, then an editor chat panel in the VS Code companion. **v6 opens with
  `v6.0/settings-and-update-fixes`** (owner, 2026-10-30): the open GitHub issues and the
  small UI asks first, then `.agent/artifacts/plans/2026-10-28-plan-by-effort.md` in order.
  **v7 opens with `v7.0/docs-refresh-and-screenshots`** (2026-10-30): v6 closed at v6.25 (#130),
  and v7 works through `.agent/artifacts/plans/2026-10-30-v7-plan.md`, quickest first. A v7.x
  branch is named for what it does, never for the file it touches. **v8 opens with
  `v8.0/silent-retry-and-cleaner-rows`** (2026-10-31, after v7.10 #141), owner: "push and merge
  uptil 7.10 and lets start v8". **v9 opens with `v9.0/mcp-client`** (2026-11-05, #158,
  `.agent/artifacts/plans/2026-11-05-custom-mcp.md`). **v8.1 is Jira and Confluence**
  (`.agent/artifacts/plans/2026-10-31-atlassian-tools.md`): built here, tested on the work laptop,
  and every write asks, in every mode.
  `/update` runs git in `server/`, and status names paths from the repo root — any path
  handed back to git there needs `:(top)` (#102).
- Open a PR into `main`. That is the only way work reaches `main`.
- A force-push to `main` is not a merge and is not covered by this: it is a repair, it needs
  the owner to ask for it explicitly, and it breaks every open PR targeting `main` plus every
  existing clone.

A conflict on a PR that *should* be a clean descendant almost always means the two sides no
longer share history — check `git rev-list --left-right --count main...<branch>` locally
before believing GitHub. If local says `0 <n>` and GitHub says conflicts, the remote branches
have diverged (a rewrite that was pushed to one side and not the other), and the fix is to
make both sides share the same base, not to resolve 120 files by hand.

## Product decisions

Standing constraints on this project. These are choices, not limitations to route around:

- **Gemini Web only.** Not "primary target" any more — the only one. ChatGPT was removed on
  2026-09-19 (see `docs/history.md`); a second provider is a decision to re-open, not a
  file to un-delete.
- **Purely local** — no hosted backend, no telemetry, no API keys. Inference happens in the
  user's own browser session, which is the whole point of the extension bridge.
- **Two front-ends** — the terminal CLI and the Chrome side panel are both supported surfaces.
- **One answer per turn** — never emit drafts or A/B alternatives for the user to pick between.
- **One bridge.** This used to read "the two bridges stay separate" — ~600 duplicated lines
  across `gemini-bridge.js` and `chatgpt-bridge.js`, kept apart because collapsing them risked
  breaking both at once, and defended by jsdom tests that ran against *both* files so a
  divergence failed the build. Deleting one settled that argument by removing its subject. The
  jsdom tests still run, against the one bridge, and say in a comment **not** to restore a
  second target to make the comparison mean something again: the comparison was a side-effect
  of having two, never a reason to have two.
- **An API backend is a fork, not a plan.** It would remove the ceiling — structured tool
  calls, real parallelism, caching, and `looksLikeCapabilityDenial` plus half of
  `PromptBuilder`'s economics become dead code — and it contradicts "no API keys" above,
  which is the identity of the project. The framing that preserves the thesis: the browser
  bridge stays the default, an API backend is opt-in for people who already have a key.

## Standing decisions from `HANDOFF.md`

No reply envelope; the jitter's second half and the emoji sweep are not happening; terminal
failures are opt-in per terminal; a test can pin the bug; never write a derived number into a
document here. The reasoning is in [`docs/history.md`](../history.md#standing-decisions-rescued-from-handoffmd).

## Measured and discarded

The reconnect address theory, the audio hack, the batch re-serialisation "fix": measured and
dropped, in [`docs/history.md`](../history.md#measured-and-discarded).

## History

Long-form records of what was removed, measured and decided — bridge liveness and the reply
path (moved 2026-10-30), the GitHub agent and ChatGPT
removals, the dead-code audits, the Direction phases, P0–P3 and "The fork" — live in
[`docs/history.md`](../history.md). They moved out on 2026-10-25 because this file had reached
167.9k characters, past the 150k Claude Code loads. Read that file before re-opening any of those
decisions; this one keeps what governs the code as it is today.
