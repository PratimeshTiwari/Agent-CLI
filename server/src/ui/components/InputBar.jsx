import React from 'react';
import { Box, Text, usePaste } from 'ink';
import { PromptInput } from './PromptInput.jsx';
import { RunningLine } from './RunningLine.jsx';
import { FOCUS_INPUT, modeColor } from '../constants.js';
import { applyPaste, nextPasteId } from '../paste.js';
import { recognizeDrop } from '../file-drop.js';
import { oneLine, taskProgress } from '../format.js';
import { hasClipboardImage } from '../clipboard-image.js';
import { T } from '../theme.js';
import { keyCell } from '../keys-view.js';

/** First `n` non-empty lines of an artifact, for the one-glance summary. */
/**
 * The bottom of the agent tab: the thinking line while a turn runs, then the
 * prompt with its slash palette.
 *
 * Everything here is bounded on purpose. It sits in Ink's repainted frame, so
 * an unbounded row — the artifact dump this used to render in full — pushes the
 * frame past the viewport and Ink starts clearing the terminal on every render.
 *
 * The text field is the only place keystrokes land. It is always mounted while
 * the prompt is visible, so there is no state in which typing goes nowhere.
 */
export function InputBar({
  hugTop = false,
  queued = [],
  activeMenu,
  addPaste,
  artifacts,
  artifactsOpen,
  artifactLines = 6,
  filedSession,
  history,
  diffRequest,
  setPaletteSuppressed,
  elapsed,
  extensionConnected,
  disconnectedText,
  focus,
  handleSubmit,
  attachImage,
  attachDropped,
  input,
  isProcessing,
  steered = [],
  isThinkingTooLong,
  isThinkingStuck,
  isToolRunningRef,
  mode,
  setInput,
  cursorRef,
  promptMaxRows,
  promptWidth,
  animTick,
  setSlashIdx,
  slashMatches,
  slashOpen,
  slashSelected,
  keysGrid = null,
  status,
  syncTokenEstimate,
  liveTally = '',
  terminalOpen,
  pastes,
  thinkingText,
  verbose,
  compact,
}) {
  // The filed-session row goes for good on the first keystroke (see its row).
  const [filedDismissed, setFiledDismissed] = React.useState(false);
  React.useEffect(() => { if (input) setFiledDismissed(true); }, [input]);
  const hasArtifacts = Boolean(artifacts?.task || artifacts?.review || artifacts?.walkthrough);

  /**
   * `3/6 done` on the header row, so the panel answers the question it exists
   * for without being opened at all. Counted from the file, which is the only
   * copy either the user or the model can be looking at.
   */
  const progress = (() => {
    const p = taskProgress(artifacts?.task);
    return p ? `${p.done}/${p.total} done` : '';
  })();

  /**
   * Counted before it is cut, or the count is always zero.
   *
   * The first version ran `head(task, artifactLines)` and *then* sliced to
   * `artifactLines`, so the overflow was the difference between a number and
   * itself — the `… +N more` row could never appear, and a list cut to two
   * lines looked like a list with two items.
   */
  const artifactBody = [artifacts?.task, artifacts?.review, artifacts?.walkthrough]
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .filter((l) => l.trim());
  const shownArtifactLines = artifactBody.slice(0, artifactLines);
  const artifactOverflow = artifactBody.length - shownArtifactLines.length;
  const promptVisible = !diffRequest && !terminalOpen && !activeMenu;

  // Bracketed paste, which this hook turns on, is what separates "the user
  // pasted forty lines" from "the user typed forty lines very fast". Ink routes
  // the text here instead of through useInput, so a paste can never be
  // misparsed as keystrokes — and a big one is folded to a marker rather than
  // rendered at full height into a frame that must stay short.
  usePaste((text) => {
    // **An empty paste is how a pasted image arrives.**
    //
    // `Cmd+V` in a terminal on macOS is the *terminal's* paste, not ours: it
    // sends the clipboard as text, and a screenshot has no text, so the
    // terminal dutifully sends a bracketed paste with nothing between the
    // markers and the app is never told a picture was involved. That is why
    // pasting a screenshot looked broken — `ctrl+v` was bound and working, and
    // it is not the key anybody presses.
    //
    // Ink emits that as `{paste: ''}` (verified against its own parser — there
    // is no emptiness check on the slice), and nothing else produces one, so it
    // is a signal rather than a guess. The clipboard probe costs ~60ms and runs
    // only on this path, which is already the rare one.
    if (text === '' && hasClipboardImage()) {
      attachImage();
      return;
    }

    // A paste that is nothing but existing absolute paths is a drop (v5.33):
    // each becomes a tag at the caret instead of text (`ui/file-drop.js`).
    const dropped = attachDropped ? recognizeDrop(text) : null;
    if (dropped) {
      attachDropped(dropped);
      return;
    }

    const { value, paste } = applyPaste(input, text, nextPasteId(pastes));
    setInput(value);
    setPaletteSuppressed(true);
    if (paste) addPaste(paste);
  }, { isActive: promptVisible && focus === FOCUS_INPUT });

  return (
    <>
      {/*
        The blank row sits *above* the spinner, between it and the last action
        (reported: "read_file … and this vibing thing should have space"). It
        used to sit below, where the prompt box's own top margin already put
        one — two blank rows there, none here. Same height either way, so the
        live-frame budget is unchanged.
      */}
      {isProcessing && !diffRequest && (
        <Box flexDirection="column" marginTop={compact ? 0 : 1}>
          <Text color={T.accent}>
            <RunningLine tick={animTick} text={isToolRunningRef.current ? status : thinkingText} />
            <Text dimColor>
              {' ('}{elapsed}s
              {syncTokenEstimate > 0 ? ` · ↑ ${syncTokenEstimate >= 1000 ? `${(syncTokenEstimate / 1000).toFixed(1)}k` : syncTokenEstimate} tokens` : ''}
              {liveTally ? ` · ${liveTally}` : ''}
              {' · esc to stop)'}
            </Text>
          </Text>
          {/*
            One row, two messages — never both, because the live frame budgets
            this line and a row that wraps is charged as one and drawn as two.
            Past five minutes the tab advice is no longer the likely cause, so
            it is replaced rather than added to.
          */}
          {isThinkingStuck ? (
            <Text color={T.attention}>  (Still waiting — press esc, or type :stop, to take the turn back)</Text>
          ) : isThinkingTooLong && (
            <Text color={T.attention}>  (Taking a while — make sure the Chrome tab is not minimised)</Text>
          )}
        </Box>
      )}

      {/*
        A blank row above the prompt. Without it the input box sits directly
        against the last line of the transcript, and the two read as one block —
        there is nothing to tell you where the agent stopped talking and where
        you start typing. RESERVED_ROWS pays for this row; raising one without
        the other is how the frame outgrows the viewport.
      */}
      {promptVisible && (
        // `hugTop`: App drew this blank row above its notices instead (v7.9).
        <Box flexDirection="column" marginTop={compact || hugTop ? 0 : 1}>
          {/*
            What happened to the last conversation.

            Starting without `--continue` files it and clears the screen, which
            from the outside is indistinguishable from losing it. The storage,
            the flags and the picker were all built and nothing ever said a
            session had been put anywhere — asked directly: "didn't we plan on
            displaying the session id for resume?"

            One row, once, and only on the run that filed something. It is
            dismissed by the first message, because after that it is history
            rather than an offer.

            **It used to print `--resume <id>`, and that was the wrong offer.**
            A 28-character timestamp id is not something anyone reads or types,
            and the command it belonged to only works at launch — so the CLI's
            answer to "where did my last chat go?" was to quit and start again.
            Reported as exactly that. `/history` is in the session you are
            already in, lists every conversation rather than the most recent
            one, and says per row whether the model still remembers it.
          */}
          {/*
            A bullet, and gone the moment you type (v5.24 — the `↺` row was
            reported as looking odd, and it outstayed its use: once you are
            writing a message you have decided not to reopen anything).
            Dismissed for good rather than while the box is empty, so deleting
            what you typed does not bring it back.
          */}
          {/*
            `!input` as well as the dismissal: the effect that dismisses it runs
            after the render, so for one frame the row (two rows, uncharged) sat
            beside the `/` list it opened — 2 full clears at 13 rows.
          */}
          {filedSession && !filedDismissed && !input && !isProcessing && history.length === 0 && (
            <Box marginBottom={1}>
              <Text dimColor wrap="truncate">
                {'• Previous conversation filed'}
                {filedSession.turns ? ` (${filedSession.turns} turns)` : ''}
                {' · '}
                <Text color={T.link}>/history</Text>
                {' to reopen it'}
              </Text>
            </Box>
          )}

          {/*
            Prompts waiting their turn.
            
            They used to be discarded: the loop returns early when busy, and
            the only trace was a status line the thinking cycle painted over —
            while the transcript had already echoed the message and the input
            box had already been cleared. It looked sent. Reported after
            typing four prompts and getting one reply.
            
            Bounded, because this is the live frame: three rows and a count.
            `wrap="truncate"` for the same reason — a queued prompt can be a
            paragraph, and a row that wraps is charged as one and drawn as two.
          */}
          {(queued.length > 0 || steered.length > 0) && (
            <Box flexDirection="column" marginBottom={1}>
              {/* Steered first: they reach the model before anything queued. */}
              {steered.slice(0, 3).map((q, i) => (
                <Text key={`s${i}`} color={T.accent} wrap="truncate">
                  {'  ↳ steering  '}{oneLine(q, 48)}<Text dimColor>{'  · goes in with the next tool results'}</Text>
                </Text>
              ))}
              {queued.slice(0, Math.max(0, 3 - Math.min(steered.length, 3))).map((q, i, shown) => (
                <Text key={i} dimColor wrap="truncate">
                  {'  ⏸ queued  '}{oneLine(q, isProcessing ? 40 : 64)}
                  {/* The take-back had no affordance. On the last row, where
                      truncation reaches it first and the text survives. The
                      steer hint only while there is a turn to steer into. */}
                  {i === shown.length - 1 && queued.length === shown.length
                    ? `${isProcessing ? '  · ctrl+x ctrl+s to steer' : ''}  · ↑ to take back` : ''}
                </Text>
              ))}
              {queued.length + steered.length > 3 && (
                <Text dimColor wrap="truncate">{'  ⏸ '}… {queued.length + steered.length - 3} more queued  · ↑ takes back the last</Text>
              )}
            </Box>
          )}

          {hasArtifacts && !isProcessing && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color={T.accent} wrap="truncate">
                {artifactsOpen ? '▾ ' : '▸ '}
                {[artifacts.task && 'task.md', artifacts.review && 'review.md',
                  artifacts.walkthrough && 'walkthrough.md'].filter(Boolean).join(' · ')}
                {progress ? <Text dimColor>{'  '}{progress}</Text> : null}
                <Text dimColor>{artifactsOpen ? ' — ctrl+o to collapse' : ' — ctrl+o to expand'}</Text>
              </Text>
              {/*
                Bounded, because this is the live frame. Unbudgeted it cost
                4 clears at 13x80 on a six-item list, on top of the two the
                toggle itself pays — and the toggle used to be ctrl+e, which
                reprints the whole transcript to show you six lines.

                `truncate` per row for the same reason the GitHub rows have
                it: a row that wraps is charged as one and drawn as two.
              */}
              {artifactsOpen && shownArtifactLines.map((line, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <Text key={i} dimColor wrap="truncate">{'  '}{line}</Text>
              ))}
              {artifactsOpen && artifactOverflow > 0 && (
                <Text dimColor>{'  '}… +{artifactOverflow} more — open the file</Text>
              )}
            </Box>
          )}

          {!extensionConnected && (
            <Text color={T.attention} wrap="truncate">{disconnectedText}</Text>
          )}

          {keysGrid && (
            <Box flexDirection="column" paddingX={1}>
              {keysGrid.map((row, r) => (
                <Text key={r} wrap="truncate">
                  {row.map((cell, c) => {
                    const { key, desc } = keyCell(cell);
                    return <Text key={c}><Text color={T.menu}>{key}</Text><Text dimColor>{desc}</Text></Text>;
                  })}
                </Text>
              ))}
            </Box>
          )}

          {slashOpen && (
            <Box flexDirection="column" paddingX={1}>
              {slashMatches.map((cmd, idx) => (
                // Truncated: a description that wraps is a row drawn and not
                // charged, and `/subagents`'s did at 80 columns (1 clear at 13
                // rows under the pty, 2026-10-26).
                <Text key={cmd.name} color={idx === slashSelected ? T.menu : T.muted} bold={idx === slashSelected}
                  wrap="truncate">
                  {(idx === slashSelected ? '❯ ' : '  ') + `/${cmd.name}`.padEnd(16)}
                  <Text dimColor>{cmd.desc}</Text>
                </Text>
              ))}
            </Box>
          )}

          {/*
            The border is the mode. Plan vs auto is the answer to "will this
            edit happen without asking me?", and it used to be a yellow chip two
            rows *below* the box it governs — the most consequential state on
            screen rendered as a footnote, for two rows of frame budget. The
            border is already the most visible line here and it costs nothing.
          */}
          {/*
            A rule above and a rule below, no sides (Look A, 2026-10-25 —
            Claude Code's shape). The side borders were copied with the text:
            drag-select a multi-line prompt and every line began with `│`.
            Same three rows as the box, so the frame budget is unchanged.
          */}
          <Box
            flexDirection="row"
            borderStyle="single"
            borderLeft={false}
            borderRight={false}
            borderColor={focus === FOCUS_INPUT ? modeColor(mode) : T.muted}
            width="100%"
          >
            {/* flexShrink 0 (v7.9): beside a wrapped prompt Yoga shrank `❯ ` to
                one column, and every row was drawn a column off. */}
            <Box flexShrink={0}>
              <Text bold color={focus === FOCUS_INPUT ? modeColor(mode) : T.muted}>{'❯ '}</Text>
            </Box>
            <PromptInput
              focus={focus === FOCUS_INPUT}
              value={input}
              cursorRef={cursorRef}
              maxRows={promptMaxRows}
              width={promptWidth}
              placeholder="Ask anything, or / for commands"
              onChange={(v) => {
                setInput(v);
                setSlashIdx(0);
                // Typing is what opens the palette; history recall is not.
                setPaletteSuppressed(false);
              }}
              onSubmit={(value) => {
                // Deferred a tick, as it always was. It used to check a flag
                // that any newline set and only an Enter cleared, so the first
                // Enter after shift+enter, Esc+Enter or ctrl+j was eaten (v7.9).
                // The field decides newline against submit on its own.
                setTimeout(() => {
                  if (slashOpen) {
                    const picked = `/${slashMatches[slashSelected].name}`;
                    setInput('');
                    setSlashIdx(0);
                    handleSubmit(picked);
                    return;
                  }
                  handleSubmit(value);
                }, 0);
              }}
            />
          </Box>
        </Box>
      )}
    </>
  );
}
