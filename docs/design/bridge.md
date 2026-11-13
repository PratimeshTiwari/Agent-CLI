# The bridge and the reply path

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Bridge liveness and the reply path — the rules

The investigations behind each of these (measurements, wrong theories, the reports that started
them) are in [`docs/history.md`](../history.md#bridge-liveness-and-the-reply-path). Read the
entry before changing the mechanism it describes.

- **The reconnect alarm is periodic and permanent.** `stopKeepAlive` must not clear it: it is the
  only thing that revives a worker Chrome collected while it believed it was connected.
  `watchdog-alarm.test.js` pins it, including a source assertion.
- **An undelivered prompt is held, not dropped.** `sendInjectPrompt` honours `broadcast`'s return;
  `flushPendingInjects` drains when a client *identifies as an extension* (not on socket open);
  past `INJECT_BUFFER_TTL_MS` it is dropped, because the lane watchdog has abandoned that turn.
- **Readiness is a handshake, not a sleep.** `waitForBridge` reports `ready` and `canType`; the last
  40% of its budget accepts `ready` alone so a broken selector fails readably instead of slowly.
  The `connect` nudge backs off from 3s to 30s once connected.
- **In a hidden tab only the page's own timers are throttled** (to ~1/min). MutationObserver,
  layout and Worker/service-worker timers run at full rate. So the clock lives in the service
  worker (`startCompletionTicks` → `tick_completion`), the tab's interval is a backstop, and focus
  is returned as soon as the send lands. **A clock fix has as many sites as the clock has
  callers**: `waitForDom`, the paste-settle check and `waitForSendButton` all run on the observer
  clock, and are tested with a `setTimeout` that never fires.
- **The picker is found by its selectors, then by shape, and checked (v9.9.8, extension 1.67.0).**
  Read live 2026-11-13: entries turned round, purpose above model ("Code and analysis / 4 Argon"),
  so the line that starts with a version is the name wherever it sits. Reported 2026-11-14 from a
  work account ("Chat" picker): the structural search raced the selectors on a fresh tab and opened
  the "+" menu, so effort offered "Upload files". Selectors now get their whole wait first; a menu
  with no `data-mode-id` that offers to upload is refused by name; a missed picker logs the page's
  menu buttons.
- **A reply's finished row ends the wait (v9.9.4, #104, extension 1.66.0).** Read live: Gemini's
  copy row under a reply lands ~0.6 s after its last text. Once the text is still for 250 ms and the
  newest `model-response` (never `initialLastReply`, the previous turn's) has it, the turn completes
  (`finishedBy: 'row'`); otherwise the quiet checks below decide.
- **Completion needs consecutive quiet checks**, and `confirmSoon` brings the confirming look
  forward. `completionConfirms` holds that look so a stop cancels it (it leaked and compounded).
- **The picker cannot kill a turn.** `NON_FATAL_EXTENSION_OPS`, and a notice is never fatal
  (checked after the settle and `session_lost` branches). `dismissStuckMenu` runs on every inject:
  synchronous, unbudgeted, cannot throw, Escape before the trigger (it toggles), and it waits for
  `trackPicker`'d operations so it never closes a busy menu. `switch_model` has the `isInjecting`
  guard.
- **Typing:** an unclaimed synthetic paste goes straight to the `insertText` fallback; only a
  claimed paste or an image waits. The send-button fallback vetoes `Expand input to Fullscreen`.
- **Repairs:** `prepareTabForTurn` (no discarding, reload a discarded tab); `sendWithRepairs` —
  send, re-inject, reload, and **never a fresh tab on a new chat** (a new conversation answers a
  question it never saw). Since 1.56.0 the reload bypasses the cache, a failed inject carries the
  page's reason (`lastInjectError`, in `/logs extension`), and **the main lane no longer re-injects
  or reloads**: one send (`sendOnce`), then the **same** `/app/<id>` in a fresh tab
  (`reopenInFreshTab`: the tab's URL, else `threadUrl`; the old tab is closed only once the new one
  is up, and kept if it cannot open), then the error. Subagents keep `sendWithRepairs`. The terminal then says one line
  and the chat's link (`bridge/tab-failure.js`; owner: "too verbose, keep it simple"). The bridge is an IIFE with a `__agentBridgeStop` handover so re-injection replaces
  an orphan. An unsubmitted prompt (`!sawGenerating`) is resent once, **verbatim**
  (`_lastMainPrompt`; rebuilding has side effects). Not retried: `timedOut` with partial text, and a
  delivered prompt after a disconnect — both risk a double answer.
- **Two minutes without a word is resent once, in a fresh tab (v8.0, `SILENT_REPLY_MS`,
  `_onSilentReply`, extension 1.57.0 `freshTab`).** Reported with screenshots: Gemini took a
  tool-results prompt, showed its thinking dots and wrote nothing; after a reload the chat did not
  hold that prompt. The tab's watchdog counts the dots as busy and waits 5 minutes, and a turn that
  saw generation is never resent, so it simply died. Now the server arms a clock on every main
  `_sendToGemini`; the first streamed text (or a reply, or esc) stops it. On expiry the same
  prompt goes again, verbatim, with `freshTab`: the extension reopens the chat on its own
  `/app/<id>`, then closes the stuck tab, which ends the silent generation so it cannot answer
  late. A second silence ends the turn with the failed-send line. Caveat: a model that thinks for
  over two minutes without text is resent too. Pty (`FAKE_SILENT_FIRST=1`, the real two minutes).
- **A closed tab is noticed (v8.10, `noteTabClosed`, extension 1.61.0 `tab_closed`, `whoseTab`).**
  Owner: end the turn and say so, never reopen and resend. Decided by the **lane**, not
  `pendingGeminiResponse`, which no reply clears: a reply owed ends the turn and carries the message;
  idle is a row; between rounds of tools the turn goes on and the next prompt reopens the chat. Every
  close the extension makes must let go of the tab first. With no window left, `tabs.create` rejects
  (`No current window`, the silent "failed to reopen"), so `openTab` opens a window. Chrome quitting
  is not covered: nothing watches the socket, so it waits for the two-minute clock.
- **A message the tab never sent is carried (v7.10, `noteUndelivered`, `carryUndelivered`).**
  Reported with a screenshot: a question failed with `tab_unreachable`, the next message was "try
  again", and Gemini answered the question before it. On a fatal `tab_unreachable` or `no_tab`
  (raised only when the prompt was not submitted) in a turn with no reply at all
  (`_turnAnswered`), the message is kept and sent in front of the next one, marked as never
  received; the record keeps what was typed, a `↻` row says so, and `/new` drops it. If the lost
  prompt was turn 0 (`<system_state`), the builder had already marked it sent, so it is reset and the
  next message teaches the chat. Pty (`FAKE_FAIL_SENDS=1`): 0 clears at 13 and 24 rows.
- **Tool amnesia is a thread change.** `_recordThread` calls `resetPromptState()` when the thread
  id changes from a previous one. `looksLikeCapabilityDenial` judges the *subject* (tooling, not
  code); `denial-corpus.test.js` holds both directions.
- **One recovery table** (`core/turn/reply-recovery.js`): a provider error re-sends the failed prompt
  verbatim after 3s then 8s (±20%, cancelled by `abortExtensionWork`); a usage limit is never
  retried on the same model — it steps down (v5.28).
- **Traces:** five stages per turn; `first_token` is marked when the observer first sees text. Since
  v7.2 (#104) each trace also says how the prompt was typed (`typed`: `pasted` / `pasted_late` /
  `inserted`, `lines`, `hidden`) and `/logs speed` splits `type` by it; `generating_start` is
  marked by the observer, because the check's 3 s guard and 2 s tick made it read ~4 s every time.
  Measured first: typing is most of the gap between turns (0.6 s median, 35 s for 28k
  characters). The ~2 s completion settle is the other part, and shortening it once truncated
  replies, so it waits for the live page.
  Rounds per turn are on every `tool-usage.jsonl` row. Prompt length is not what a turn costs —
  round trips are.
- **The screen:** `mergeLoopHistory` uses recorded positions (`__loopIndex`, `__echo`), never a
  count. A committed turn that grows remounts `<Static>`; keeping `isProcessing` up for the whole
  turn was 1,228 clears — do not retry it. `agent_response` carries `continuing`. Frame numbers
  only from a driver that waits on output, never on wall-clock sleeps.
- **Still unexamined:** narrowing the MutationObserver from `document.body` to the response
  container — wants measuring on the live page.

## Prompt economics

**A fresh session starts in a new chat (v7.9, `_freshChatOwed`, extension 1.55.0).** Reported with a
screenshot: a warm start's setup went in under the previous session's last reply. The extension
types into the tab it owns, and nothing moved that tab off the last conversation, so a cold start's
first message went there too. A launch without `--continue`/`--resume` (or one that recaps, or
finds no history) owes a new chat; `_startFreshChatIfOwed` spends it through `startNewChat` before
the warm-up's prompt and before the first message (after compaction, before the model switch).
`startNewChat` answers `false` at once when nothing is connected, and the debt stays for the next
prompt. The extension skips the navigation when the tab is already on `/app`, keeps a `/u/<n>`
account prefix (`background/chat-url.js`), and **waits for the load** before acking: the content
script used to set `location.href` and ack at once, which `/new` never noticed, but a warm-up
sends the moment the ack lands. The "Ready" row shows until the first *user* message, not while the
transcript is empty, or `/new`'s own row hid it. Pty: `new_chat` before prompt 0 and before the
warm-up after `/new`; the one `ESC[2J` is `/new`'s reset.

**A reopened tab goes back to the conversation (v7.9, `threadUrl`).** Reported: after the extension
was reloaded (which clears `chrome.storage.session`, so it no longer knows its own tab),
`ensureModelTab` opened a blank `/app` and a 508-character short turn went into a chat that had
never seen the task; the reply was an essay about LLM agents, and `thread_changed` fired only
after it. `_enqueueExtensionRequest` now adds `threadUrl` to every main-lane prompt (the tab's own
URL when it is this chat, which keeps `/u/<n>`), and a tab the extension has to open goes there.
Subagents and a new chat send none. Owned tabs are still the only ones adopted.

## Tools

**A subagent's tab failure is the subagent's (v8.1, extension 1.58.0).** Reported with
screenshots: digests of CLAUDE.md and CHANGELOG.md failed and the user's turn ended with the
failed-send line. The worker kept a session tab only when the reply carried `sessionId`, which the
page never sends, so each session tab closed after turn 1 (`isSessionTab` asks the worker's map
now); and `tab_unreachable` ended the main turn whoever sent the prompt (it carries `isSubagent`
and `requestId` now, and settles that request only). **The tab is put back on the session's chat
before every main prompt** (`ensureOnChat`, `chatToReturnTo`; owner: "the agent should check
whether it is continuing on the same chat"): `threadUrl` names it, the tab's account is kept. If it
will not load there nothing is typed: `chat_unreachable`, one warning naming `/chat <link or id>`
(`openChat`) and `/new`, and the message is carried. A reply from another chat says so too.
`_cleanJsonString` is a scan now: its regex did not know `\"`, so a long edit's newlines after
the first escaped quote stayed raw ("Bad control character", a lost round). An extension
since 1.58.0 that is older than the checkout is asked to reload itself (`reload_extension`), once
per version and only between turns: no app on macOS opens a `chrome://` link.

## One Chrome profile

**Prompts go to one profile (v9.3, `/chrome`, `core/workspace/profile-binding.js`, extension 1.62.0).**
`broadcast` reaches every extension, so a second profile typed every prompt into a second account. A profile
cannot be named from inside, so it is proved: the agent opens it on a `#agent-pair=<token>` link and that
extension answers with its `storage.local` id. Bound, nothing else is admitted and a closed profile makes prompts
wait: **never a fallback.** Unbound, the first install connected wins. Harness: `run-two.sh`, `run-chrome.sh`.

## From Gotchas

- **A formula is scraped as its TeX, once (v7.1).** KaTeX draws maths three times (MathML, a
  TeX annotation, the glyphs), and the walker read all three: `≥80%\ge 80\%≥80%` went into history
  and compaction summaries. `extractTextContent` returns `$tex$` (`$$…$$` for `katex-display`),
  preferring `data-math`, then the annotation, then the glyphs once. The terminal draws a formula
  of known symbols as text (`texToText` in `markdown.js`: `≥ 80%`, `π r²`) and leaves anything
  else as TeX; `$5 to $10` is not maths. Fixtures are KaTeX's standard markup, not a capture of
  Gemini's page, which v7.6 should check.

- Content-script DOM selectors break when the chat sites change; `extractLatestResponse` must
  wait for a *new* block before scraping. Gemini's editor only ingests text via a synthetic
  `ClipboardEvent('paste')` — setting `innerHTML` breaks it.
