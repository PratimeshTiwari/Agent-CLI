/**
 * Compaction: summarise the older turns and hand the thread over.
 *
 * Lifted out of `agent-loop.js` verbatim, as a function taking the loop — the
 * same shape `slash-commands.js` already uses, so the dependency reads in the
 * signature rather than as a dozen implicit `this.` references. That file was
 * 2,669 lines and held the turn loop, tool dispatch, approval, subagents,
 * compaction, model switching and the handover audit; nearly every bug found on
 * 2026-09-19 lived in it or one call away.
 *
 * The one thing worth knowing before touching it: **compaction is a handover,
 * not a truncation.** Since v5.9 it asks the *current* chat for the summary
 * (it holds everything), opens a new chat, and hands the summary to the next
 * prompt as `<compacted_context>` — which, until v5.9, nothing did: the summary
 * was written to history and never sent, so every compaction left the model
 * with no memory of the task. It runs between turns or between rounds, never
 * beside a running prompt, and the count restarts only if the browser confirms
 * the new chat.
 */
import { randomUUID } from 'crypto';
import { archiveTurns } from './session-recall.js';
import { logNotice } from './error-log.js';

/**
 * How long to wait for the thread's summary before condensing locally.
 *
 * Longer than the 30 s the cold-tab summary had, because this is a reply the
 * model writes from a long thread, and the person is watching a progress bar
 * with `esc` on it rather than an unexplained spinner. The local fallback is
 * still there, so the worst case is a blunter summary, never a lost turn.
 */
const SUMMARY_TIMEOUT_MS = 90_000;

/** Rows, not exchanges — three short Q&A pairs is already eight rows. */
const MIN_ROWS = 6;

/**
 * Below this, the round trip costs more than the summary saves.
 *
 * `/compact` exists to free room in the browser thread. Asking the model to
 * summarise a few hundred characters spends a full inject → think → scrape
 * cycle — 4,673ms median, 14,913ms p90 — to save almost nothing, and the reply
 * is longer than the input as often as not.
 *
 * Reproduced: at eight rows the old guard passed and `slice(0, -5)` left
 * **three rows** to summarise. The guard counted rows and the cost is in
 * characters, so it was measuring the wrong thing.
 */
const MIN_COMPACT_CHARS = 2000;

const charsOf = (turns) => turns.reduce((n, t) => n + (t.content?.length || 0), 0);

/** The question asked of the thread. Short: the thread already has everything. */
export function summaryPrompt(focus) {
  return [
    '[Compaction request — not a task. Do not call any tools and do not continue the work.]',
    'This conversation is about to move to a fresh chat that will see only what you write now plus',
    'the last few messages. Write the handover for that session: the goal and where the task stands;',
    'every file read or changed, by path, and what was learned or changed in it; decisions made and',
    'why; errors hit and their causes; what is left to do. Plain prose and lists, under 600 words.',
    focus ? `Pay particular attention to: ${focus}` : '',
  ].filter(Boolean).join('\n');
}

/** A summary is unusable if it is empty or the model answered with tool calls. */
export function usableSummary(text) {
  const t = String(text || '').trim();
  if (t.length < 40) return false;
  return !/```(json)?\s*[\[{][\s\S]*?"name"\s*:/.test(t);
}

/** What tells the fresh chat where the rest is. `recall_history` has had no calls, so say *when*. */
export const HANDOVER_POINTER = 'The full earlier conversation is saved on disk. When you need a detail this '
  + 'summary does not have — an exact error, a path, the reason for a decision — call recall_history '
  + 'with a literal search term before guessing or asking the user to repeat it.';

/**
 * The kept turns, as the fresh chat sees them: conversation only, each one
 * capped head-and-tail, the lot capped too. The full text is in history.jsonl
 * and reachable through `recall_history`.
 */
export function recentMessages(turns, { perTurn = 1500, total = 6000 } = {}) {
  const lines = turns
    .filter((t) => ['user', 'assistant', 'agent'].includes(t.role) && typeof t.content === 'string' && t.content.trim())
    .map((t) => {
      const c = t.content.trim();
      const body = c.length > perTurn
        ? `${c.slice(0, perTurn * 0.7)}\n… ${(c.length - perTurn).toLocaleString()} characters trimmed …\n${c.slice(-perTurn * 0.3)}`
        : c;
      return `[${t.role === 'agent' ? 'assistant' : t.role}] ${body}`;
    });
  let out = lines.join('\n\n');
  if (out.length > total) out = `…\n${out.slice(-total)}`;
  return out;
}

const STAGES = ['summarising in this chat', 'opening a fresh chat', 'handing over'];

/** One row in the live frame: `Compacting ▰▰▱ opening a fresh chat`. */
export function progressText(step) {
  const n = STAGES.length;
  return `🗜 Compacting ${'▰'.repeat(step)}${'▱'.repeat(n - step)} ${STAGES[step - 1]}…`;
}

function progress(loop, step) {
  loop.callbacks?.sendToPanel?.({
    id: randomUUID(),
    type: 'status',
    payload: { message: progressText(step), progress: { step, of: STAGES.length } },
    timestamp: Date.now(),
  });
}

export async function compactHistory(loop, focus, { auto = false } = {}) {
  /*
   * Asked for during a turn: run when it ends. Compacting under a running
   * turn is the bug this module was rewritten for (v5.9).
   */
  if (!auto && loop.isProcessing) {
    loop._compactAfterTurn = true;
    return { message: 'A turn is running — compaction will run as soon as it finishes.' };
  }

  // Auto-compaction skips the size guards: it fires because the *browser
  // thread* is full, and a few huge tool results fill it as surely as many
  // turns. The guards are about whether a person's `/compact` is worth a trip.
  if (!auto && loop.conversationHistory.length < MIN_ROWS) {
    return { message: 'Conversation is too short to compact.' };
  }

  const pending = loop.conversationHistory.slice(0, -5);
  const pendingChars = charsOf(pending);
  if (!auto && pendingChars < MIN_COMPACT_CHARS) {
    // The two numbers here measure different things, and side by side they
    // used to read as the tool contradicting itself — "only 114 characters"
    // next to "~23,248 tokens" with nothing saying why. This one is
    // `conversationHistory.slice(0, -5)`: everything /compact would actually
    // summarise, which is small because there just isn't much history yet.
    // `loop.contextTokens` is everything ever typed into the browser tab —
    // system prompt, tool definitions, every prior turn — which starts large
    // on turn 0 and stays large. Both are true; they answer different
    // questions, so the message now says which is which instead of leaving
    // the reader to guess.
    return {
      message: `Nothing worth compacting yet — the older turns eligible for compaction `
        + `(everything but the last 5) are only ${pendingChars.toLocaleString()} characters, `
        + `below the ${MIN_COMPACT_CHARS.toLocaleString()}-character threshold where a browser `
        + `round trip pays for itself.\n\n`
        + `_That's not the number in the status bar. This one is just the turns \`/compact\` `
        + `would summarise; context is ~${loop.contextTokens.toLocaleString()} tokens — `
        + `everything ever typed into the tab, including the system prompt — `
        + `and auto-compaction runs off that one, past 80% of the rung's budget._`,
    };
  }

  loop.isCompacting = true;
  // The ask needs the loop busy (an idle loop discards main-lane replies as
  // stale), and busy is also what makes prompts typed meanwhile queue.
  const ownsBusy = !loop.isProcessing;
  if (ownsBusy) loop.isProcessing = true;

  try {
    const keep = Math.min(5, loop.conversationHistory.length);
    const toCompact = loop.conversationHistory.slice(0, loop.conversationHistory.length - keep);
    const toKeep = loop.conversationHistory.slice(loop.conversationHistory.length - keep);

    // Deterministic condensation — the fallback when the thread does not answer.
    const localSummary = toCompact.map((turn) => {
      if (turn.role === 'system' && turn.content) {
        if (turn.content.includes('**Command Output:**')) return '[System: Command executed. Output truncated for context compaction.]';
        if (turn.content.includes('**File Contents:**') || turn.content.includes('**Search Results:**')) return '[System: File/Search data truncated for context compaction.]';
        if (turn.content.length > 500) return `[System: Output truncated. Original length: ${turn.content.length}]`;
      }
      return `[${turn.role.toUpperCase()}]: ${turn.content}`;
    }).join('\n\n');

    /*
     * Step 1: ask the thread. It holds the whole conversation, tool results
     * included, so this is a few hundred characters out and a summary built
     * from the real thing — where the old way pasted every older turn, with
     * the results replaced by placeholders, into a cold tab.
     */
    progress(loop, 1);
    const startedAt = Date.now();
    const asked = await loop._askThread(summaryPrompt(focus), { timeoutMs: SUMMARY_TIMEOUT_MS });
    if (asked.cancelled) {
      return { message: 'Compaction cancelled — nothing changed; this chat carries on as it was.' };
    }
    const fromThread = asked.ok && usableSummary(asked.text);
    const summary = fromThread ? asked.text.trim() : localSummary;

    logNotice(loop.workspace, {
      flow: 'agent', op: 'compaction',
      message: fromThread ? 'Compacted from the thread\'s own summary'
        : `Compacted locally — the thread ${asked.timedOut ? 'did not answer in time' : 'gave no usable summary'}`,
      meta: { auto, path: fromThread ? 'thread' : 'local', ms: Date.now() - startedAt,
        summaryChars: summary.length, turns: toCompact.length },
    });

    const compactedTurn = {
      role: 'system',
      type: 'compaction_summary',
      content: `[Context Summary of older turns]\n${summary}\n\n${HANDOVER_POINTER}`,
      timestamp: Date.now(),
    };

    // Archive before the rewrite: `saveHistory` overwrites both copies of
    // history.jsonl, and `recall_history` searches what lands here.
    archiveTurns(loop.workspace, toCompact);
    // The screen counts what it has drawn by absolute position; tell it how far
    // the front moved (mergeLoopHistory's `offset`).
    loop.historyOffset = (loop.historyOffset || 0) + toCompact.length - 1;
    loop.conversationHistory = [compactedTurn, ...toKeep];
    loop.sessionStore.saveHistory(loop.conversationHistory);
    // No resetPromptState here: `startNewChat` resets it when the chat really
    // changes, and a full turn-0 payload into the *old* thread — which already
    // has it — is the repetition-filter risk recorded in that function.

    // Steps 2 and 3: the fresh chat, and the count reset only if it happened —
    // resetting against a thread that never changed is the bug recorded in
    // `startNewChat`'s history.
    progress(loop, 2);
    const handedOver = await loop.startNewChat();
    progress(loop, 3);
    if (handedOver) {
      // The next prompt carries the summary; it is the only thing the fresh
      // chat will know. And the count restarts at zero rather than at the
      // history's size: `_sendToGemini` adds what is actually typed, and the
      // kept turns are bounded below — counting them in full re-triggered
      // compaction on the very next turn (a 335k-character reply, measured).
      if (loop.promptBuilder) {
        loop.promptBuilder.pendingCompactedContext = {
          summary: `${summary}\n\n${HANDOVER_POINTER}`,
          recent: recentMessages(toKeep),
        };
      }
      loop._resetContextCount(0);
      loop._compactFailedAt = null;
    } else {
      // Do not try again every turn: wait until the thread has grown further.
      loop._compactFailedAt = loop.contextTokens;
    }

    const how = fromThread
      ? 'summarised by this chat'
      : `condensed locally (the chat ${asked.timedOut ? 'did not answer in time' : 'gave no usable summary'})`;
    const where = handedOver
      ? 'The tab has moved to a fresh conversation; the summary goes into it with your next message, '
        + 'and the full history stays searchable on disk.'
      : '⚠️ **The browser did not start a new conversation**, so the tab is still on the old one.\n\n'
        + '**Please open a new chat in the Gemini tab yourself** (the ✚ / *New chat* button). '
        + 'The next message will pick it up automatically.\n\n'
        + '_Not `/new` — that clears the conversation here, and this summary with it._';

    return {
      handedOver,
      turns: toCompact.length,
      summary,
      message: handedOver
        ? `✓ Compacted ${toCompact.length} turn${toCompact.length === 1 ? '' : 's'}, ${how}; `
          + 'continuing in a fresh chat, with the full history still searchable.'
        : `✓ Compacted ${toCompact.length} turn${toCompact.length === 1 ? '' : 's'}, ${how}. `
          + `Kept the last ${toKeep.length} as they were.\n\n${where}`,
    };
  } finally {
    loop.isCompacting = false;
    if (ownsBusy) loop.isProcessing = false;
  }
}
