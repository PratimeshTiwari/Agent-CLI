import { noteActivity } from '../transcript/activity.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import * as paths from '../../backend/core/paths.js';
import { mergeLoopHistory } from '../transcript/transcript.js';
import { FOCUS_INPUT } from '../constants.js';

/**
 * Keep the plan that is about to be replaced.
 *
 * `artifacts/plan.md` is one file the agent overwrites, so asking for a second
 * plan destroyed the first — including one you were part-way through
 * reviewing. Copy, not move: the live path has to keep working for the editor
 * that may already have it open.
 */
function archivePlan(workspace, planPath) {
  try {
    if (!fs.existsSync(planPath)) return;
    const dir = paths.ensureDir(paths.planArchiveDir(workspace));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(planPath, path.join(dir, `${stamp}-${path.basename(planPath)}`));
  } catch {
    /* an archive that fails must not stop the plan being written */
  }
}

/**
 * The bridge AgentLoop calls back into while a turn runs.
 *
 * sendToPanel deliberately ignores response_stream: re-rendering the whole
 * transcript 50+ times a second is what used to tear the terminal, so streamed
 * text is left to the live region and the status line keeps cycling instead.
 */
// Tool-call row ids. These were Date.now(), which collides whenever the agent
// fans out several calls in one tick — the parallel ask_* path does exactly that.
// React then warns about duplicate keys on every render, and both rows share one
// entry in the expanded-log set, so opening one opens the other.
let toolCallSeq = 0;
const nextToolCallId = () => `tc_${Date.now().toString(36)}_${toolCallSeq++}`;

export function buildAgentCallbacks({
  agentLoop,
  isToolRunningRef,
  setActiveMenu,
  setActiveToolCalls,
  setDiffRequest,
  setFocus,
  setHistory,
  setInputAtEnd,
  setIsProcessing,
  setPlanReviewReady,
  setStatus,
  setWalkthroughReady,
  setSteered,
  streamRef,
  wsServer,
}) {
  /*
   * Work is still being reported, so the turn is still running.
   *
   * The backstop for every path that lowers the busy flag mid-turn and has no
   * matching raise — a diff approval lowers it to draw the prompt, and nothing
   * raised it again when the loop carried on. Read from the loop, never from
   * React's copy: after `:stop` the loop says idle, and a late status must not
   * resurrect a spinner for a turn that was stopped.
   */
  const reassertBusy = () => {
    if (agentLoop.isProcessing) setIsProcessing(true);
  };

  return {
    sendToPanel: (msg) => {
      noteActivity();
      /*
       * A running command's tail is the terminal's alone. Four messages a
       * second for the length of a build, to a side panel that draws none of
       * them, is a service worker never allowed to idle — the cost CLAUDE.md
       * records the 3-second nudge paying. Still counts as activity above:
       * a command printing output is not a silent turn.
       */
      if (msg.type === 'tool_output') {
        const { name, lines, total } = msg.payload || {};
        setActiveToolCalls((prev) => {
          const idx = prev.findIndex((c) => c.result === undefined && c.name === name);
          if (idx < 0) return prev;
          const next = prev.slice();
          // The clock starts at the first view, which the loop sends as the
          // command starts — not at `tool_call`, which arrives before the
          // approval prompt and would count the time spent deciding.
          next[idx] = { ...prev[idx], output: lines, outputTotal: total, runningSince: prev[idx].runningSince ?? Date.now() };
          return next;
        });
        return true;
      }
      /*
       * Kept, and returned. The CLI's copy of this dropped the answer on the
       * floor, so `_toExtension` could not tell "the browser did not reply"
       * from "there was no browser to ask" — the ambiguity that made the model
       * switch undiagnosable from the terminal.
       */
      const delivered = wsServer.broadcast('extension', msg);
      if (msg.type === 'agent_response') {
        // Append what the loop has gained; never replace. See mergeLoopHistory —
        // replacing dropped every UI-only message and took a real turn off the
        // screen with it, because <Static> counts what it has printed by index.
        setHistory((prev) => mergeLoopHistory(prev, agentLoop.conversationHistory, agentLoop.historyOffset || 0));
        // Prose that arrives with tool calls is not the end of the turn. Clearing
        // here is what dropped the spinner while tools ran and the next round
        // was written — and, because the task panel draws only when idle, what
        // put the checklist under the prompt in the middle of a turn.
        if (!msg.payload?.continuing) setIsProcessing(false);
        setActiveToolCalls([]);
      } else if (msg.type === 'ask_question') {
        setActiveMenu({ type: 'ask_question', payload: msg.payload });
        setFocus(FOCUS_INPUT);
      } else if (msg.type === 'request_command_approval') {
        setActiveMenu({ type: 'command_approval', payload: msg.payload });
        setFocus(FOCUS_INPUT);
      } else if (msg.type === 'status') {
        setStatus(msg.payload.message || 'Processing...');
        // A progress status (compaction's bar) is the line to show, not one the
        // thinking cycle may paint over — the same switch a running tool uses.
        isToolRunningRef.current = Boolean(msg.payload?.progress);
        reassertBusy();
      } else if (msg.type === 'steer_delivered') {
        // In the prompt now; the transcript row comes with the next merge.
        setSteered?.([]);
      } else if (msg.type === 'tool_call') {
        setStatus(`Running ${msg.payload.name}...`);
        reassertBusy();
        isToolRunningRef.current = true;
        setActiveToolCalls(prev => [...prev, { id: nextToolCallId(), type: 'call', name: msg.payload.name, args: msg.payload.args }]);
      } else if (msg.type === 'tool_result') {
        /*
         * A finished call leaves the live list and joins the transcript, now.
         *
         * It used to stay in the live list as `✔ name` until the next
         * `agent_response`, while a merge from an earlier round had already
         * drawn the same call above it as `⏺ name args · result` — so a running
         * turn listed its finished tools twice, and the duplicate was charged
         * to nothing, which is what overflowed the frame at 13–16 rows with a
         * prompt queued (28 full clears at 13x72). The loop pushes the call and
         * result turns *before* sending this message, so the merge has them.
         *
         * Matched by name, first still-running call first: parallel calls
         * finish out of order, and the old code wrote every result onto the
         * last row whatever its name.
         */
        const { name, success } = msg.payload || {};
        setActiveToolCalls((prev) => {
          let idx = prev.findIndex((c) => c.result === undefined && c.name === name);
          if (idx < 0) idx = prev.findIndex((c) => c.result === undefined);
          return idx < 0 ? prev : prev.filter((_, j) => j !== idx);
        });
        setHistory((prev) => mergeLoopHistory(prev, agentLoop.conversationHistory, agentLoop.historyOffset || 0));

        // `write_to_file` and `TargetFile` used to be tested for here. Neither
        // exists: the tools are `create_file` and `edit_file`, and both take
        // `path`. The args come from the loop's own record of the call, which
        // is the last `tool_call` turn by that name.
        if (success && (name === 'create_file' || name === 'edit_file')) {
          const callTurn = [...(agentLoop.conversationHistory || [])].reverse()
            .find((t) => t?.type === 'tool_call' && t.toolName === name);
          const pathArg = callTurn?.args?.path;
          if (pathArg && (pathArg.endsWith('implementation_plan.md') || pathArg.endsWith('plan.md')) && agentLoop.mode === 'plan') {
            archivePlan(agentLoop.workspace, paths.artifactPath(agentLoop.workspace, path.basename(pathArg)));
            setPlanReviewReady(true);
          }
          if (pathArg && pathArg.endsWith('walkthrough.md')) {
            setWalkthroughReady(true);
          }
        }
      } else if (msg.type === 'error') {
        /*
         * **The turn is over, and this is the only thing that says so.**
         *
         * `_onExtensionStall` clears `isProcessing` on the *loop* after the
         * seven-minute backstop and reports why through here — and there was no
         * `error` arm, so the message was delivered to a handler that ignored
         * it. React's own `isProcessing` is separate and is set by the function
         * that submits, so nothing cleared it: the spinner ran on with no turn
         * behind it. Reported from use at **25,742 seconds** — seven hours —
         * with `esc to stop` the only way out.
         *
         * CLAUDE.md states the rule about the side panel: a surface that
         * ignores an unknown message type is not equally harmless for every
         * type, and dropping a *request* deadlocks whoever waits on the answer.
         * This is worse than a notification — it is the end of the turn.
         */
        setHistory((prev) => [...prev, {
          role: 'assistant',
          content: `! ${msg.payload?.message || 'The browser stopped responding.'}`,
          isLocal: true,
          timestamp: Date.now(),
        }]);
        setIsProcessing(false);
        setActiveToolCalls([]);
        isToolRunningRef.current = false;
      } else if (msg.type === 'response_stream') {
        // A ref, never state: it is read on the spinner's own tick (v7.10).
        if (streamRef && typeof msg.payload?.content === 'string') {
          streamRef.current = { chars: msg.payload.content.length, base: agentLoop.contextChars };
        }
        // Intentionally do NOT update status here to prevent UI tearing and scroll glitches
        // caused by re-rendering the entire history component 50+ times per second.
        // This also allows the 'Thinking...' messages to continue cycling during generation!
      }
          return delivered;
    },
    injectPrompt: (msg) => {
      const success = wsServer.broadcast('extension', {
        id: crypto.randomUUID(),
        type: 'inject_prompt',
        // Stamped as `sendInjectPrompt` stamps it: the tab records the gap to
        // its own receipt as `deliver` (v6.6, #104).
        payload: { ...msg, sentAt: Date.now() },
        timestamp: Date.now(),
      });
      
      if (!success) {
        try {
          const startUrl = 'https://gemini.google.com/app';
          if (process.platform === 'darwin') exec(`open "${startUrl}"`);
          else if (process.platform === 'win32') exec(`start "" "${startUrl}"`);
          else exec(`xdg-open "${startUrl}"`);
        } catch (e) {}

        agentLoop.isProcessing = false;
        agentLoop.abortExtensionWork();
        setIsProcessing(false);

        // Take the turn back out before asking for it again.
        //
        // `handleUserMessage` pushes the user's message to `conversationHistory`
        // *before* it tries to send, so by the time we get here it is already
        // recorded — and telling someone to "submit your prompt again" then put
        // it in twice. The prompt is handed back to the input box instead, so
        // retyping is not needed at all.
        const dropped = agentLoop.conversationHistory
          .slice().reverse().find((t) => t.role === 'user');
        if (dropped) {
          const at = agentLoop.conversationHistory.lastIndexOf(dropped);
          if (at !== -1) {
            agentLoop.conversationHistory.splice(at, 1);
            // The session file is append-only, so the turn is already in it.
            // Rewriting keeps the two copies agreeing — otherwise `--continue`
            // resurrects a turn that was never sent.
            try { agentLoop.sessionStore?.saveHistory?.(agentLoop.conversationHistory); } catch { /* not worth failing the notice */ }
          }
          setInputAtEnd?.(dropped.content || '');
        }

        setHistory(prev => [
          ...prev,
          // `isLocal`, like every other UI-only message: it is not in
          // `conversationHistory`, and counting it as loop history shifts
          // `mergeLoopHistory` by one and costs a turn on screen.
          {
            role: 'assistant',
            isLocal: true,
            timestamp: Date.now(),
            content: '⚠️ **Gemini Extension Reconnecting…**\n\nOpened '
              + '`https://gemini.google.com/app` in your browser. Your prompt is back in '
              + 'the input box — press enter once the tab is up.',
          },
        ]);
      }
    },
    requestDiffApproval: (diff) => {
      setDiffRequest(diff);
      setIsProcessing(false);
    }
  };
}
