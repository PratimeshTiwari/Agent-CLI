import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { backspaceAt } from '../image-attach.js';
import { visualRows, rowOf, moveVertical } from '../prompt-rows.js';

/**
 * The prompt field. Replaces `ink-text-input`, which could not do two things
 * this needs.
 *
 * **It owns its cursor and never gives it back.** `ink-text-input` reads
 * `value.length` into `cursorOffset` once, on mount, and its only effect clamps
 * the offset *down* when the value shrinks — nothing moves it forward when the
 * value grows, and there is no prop to set it. So text put into the prompt from
 * outside the keyboard (an editor selection, a failed terminal command, a
 * recalled history entry, a completed slash command) left the caret at column
 * zero and the next thing typed landed in front of the paste. The workaround was
 * to remount the field on every such write, which is a strange thing for the
 * most-used component in the app to be doing.
 *
 * **It has no idea what a line is.** A prompt long enough to need a second line
 * is ordinary — a stack trace, a spec, a paragraph of context — and up/down
 * inside one has to mean "move a line", not "recall the previous command".
 * That decision cannot be made without knowing which line the caret is on.
 *
 * Deliberately *not* handled here: up and down. Those stay in
 * `use-key-bindings`, where the precedence between the slash palette, line
 * movement and input history already lives; it calls `moveUp`/`moveDown`
 * through `cursorRef` and uses the boolean they return to decide whether the
 * keypress was spent. Ink has no way to stop a handler running, so the rule is
 * that exactly one place answers a given key.
 *
 * Newlines are `shift+enter` where the terminal reports it (the kitty keyboard
 * protocol, or Esc+Enter, which the VS Code companion binds shift+enter to),
 * and `ctrl+n` (a hotkey) or `ctrl+j` (a literal line feed) in any terminal.
 * Enter on its own always submits.
 */
export function PromptInput({
  value,
  onChange,
  onSubmit,
  onNewline,
  focus = true,
  placeholder = '',
  cursorRef,
  maxRows = 0,
  // Columns the text has (v7.9): rows are counted as drawn, wraps included.
  width = 0,
}) {
  /**
   * What the field holds *now*: text and caret, ahead of the render.
   *
   * **Every handler reads this, never the render's `value`.** Ink delivers
   * keys as they arrive and React renders when it gets round to it, so on a
   * busy event loop several keys land between two renders. Reading the
   * render's `value` made each of them edit the same stale text — and a
   * ctrl+v tag put in between was overwritten by the next letter. Measured
   * under the pty, 2026-10-26: `look at` + ctrl+v + `please` sent
   * `look atplease`, no tag, no image.
   */
  const live = useRef({ value, offset: value.length });
  const [, redraw] = useState(0);

  /**
   * The values this field handed to `onChange` that have not come back yet.
   *
   * Everything here is a controlled edit: a keystroke calls `onChange`, the
   * parent stores it, and it comes back as a new `value`. A value that is one
   * of ours is our own work arriving late — possibly older than `live`, when
   * keys outran the render — and must not move anything. Without a way to
   * recognise its own work the field treats every edit as text arriving from
   * outside and drags the caret to the end — so backspacing in the middle of a
   * line deleted the right character and then put the caret after the last
   * one, and the next keystroke landed at the end.
   */
  const produced = useRef([]);
  const seen = useRef(value);

  // Text that arrived from somewhere else — a paste, a recalled history entry, a
  // cleared prompt — puts the caret at the end, which is where someone who has
  // just been handed text wants to carry on typing. Decided during render, not
  // in an effect, so a key arriving before the effect runs edits the new text.
  if (value !== seen.current) {
    seen.current = value;
    const ours = produced.current.indexOf(value);
    if (ours >= 0) produced.current.splice(0, ours + 1);
    else {
      produced.current = [];
      live.current = { value, offset: value.length };
    }
  }

  const setCaret = (at) => {
    live.current = { ...live.current, offset: at };
    redraw((n) => n + 1);
  };

  const edit = (next, nextOffset) => {
    live.current = { value: next, offset: nextOffset };
    produced.current.push(next);
    if (produced.current.length > 64) produced.current.shift();
    redraw((n) => n + 1);
    onChange(next);
  };

  // Up and down by drawn row (v7.9): a wrapped line is several rows, and
  // only past the first or last does the key belong to history.
  const moveByLine = (delta) => {
    const { value: text, offset: at } = live.current;
    const next = moveVertical(text, at, delta, width || Infinity);
    if (next === null) return false;                           // the caller takes it
    setCaret(next);
    return true;
  };

  // The imperative handle use-key-bindings reaches through. A ref rather than
  // props because the answer ("did that arrow move the caret?") has to come back
  // synchronously, inside the keypress.
  //
  // `apply` is how text goes in at the caret from outside the keyboard — an
  // `[Image #n]` tag on ctrl+v. Through `edit`, so the key after it sees it.
  if (cursorRef) {
    cursorRef.current = {
      moveUp: () => moveByLine(-1),
      moveDown: () => moveByLine(1),
      isMultiline: () => live.current.value.includes('\n'),
      toEnd: () => setCaret(live.current.value.length),
      apply: (fn) => {
        const next = fn(live.current.value, live.current.offset);
        edit(next.value, next.offset);
      },
    };
  }

  useInput((input, key) => {
    const { value, offset } = live.current;
    // Up and down belong to use-key-bindings; see the note above.
    if (key.upArrow || key.downArrow) return;
    if (key.tab) return;                       // cycles menus elsewhere

    if (key.leftArrow) { setCaret(Math.max(0, offset - 1)); return; }
    if (key.rightArrow) { setCaret(Math.min(value.length, offset + 1)); return; }

    if (key.return) {
      // Shift+Enter, or Esc+Enter arriving as meta, means a newline. The parent
      // owns the distinction because it also has to stop `onSubmit` firing.
      if (key.shift || key.meta) {
        onNewline?.();
        edit(`${value.slice(0, offset)}\n${value.slice(offset)}`, offset + 1);
        return;
      }
      onSubmit?.(value);
      return;
    }

    if (key.backspace || key.delete) {
      if (offset === 0) return;
      // An `[Image #n]` tag goes in one press, and its image with it.
      const after = backspaceAt(value, offset);
      edit(after.value, after.offset);
      return;
    }

    if (key.ctrl || key.escape) {
      // ctrl+j is a line feed and is the newline that works in every terminal.
      if (input === '\n') {
        onNewline?.();
        edit(`${value.slice(0, offset)}\n${value.slice(offset)}`, offset + 1);
      }
      return;                                   // every other chord is handled upstream
    }

    if (!input) return;
    // A bare line feed can also arrive without the ctrl flag depending on the
    // terminal, and it means the same thing.
    if (input === '\n') {
      onNewline?.();
      edit(`${value.slice(0, offset)}\n${value.slice(offset)}`, offset + 1);
      return;
    }
    edit(value.slice(0, offset) + input + value.slice(offset), offset + input.length);
  }, { isActive: focus });

  if (!value) {
    return focus
      ? <Text><Text inverse>{placeholder.slice(0, 1) || ' '}</Text><Text dimColor>{placeholder.slice(1)}</Text></Text>
      : <Text dimColor>{placeholder}</Text>;
  }

  /**
   * Only ever draw `maxRows` of the prompt, scrolled to keep the caret in view.
   *
   * The prompt is in the live frame, and the live frame must never outgrow the
   * viewport — when it does, Ink answers with `ESC[2J ESC[3J` and a full repaint
   * on every render, which is what "it flickers and I can't scroll or copy" was.
   * Charging the extra lines to `liveBudget` is not enough on its own: that
   * budget has a floor, so a tall enough prompt pushes the total past the
   * viewport no matter what the in-flight turn gives up. Measured at 20 rows, a
   * ten-line prompt produced 17 clears in a second.
   *
   * So the prompt gets a bound like everything else here. One of the rows is
   * spent on the "N more" marker when there is anything off-screen, which keeps
   * the drawn height exactly `maxRows` whether it is scrolled or not.
   */
  // Windowed by drawn rows, so a wrapped line costs what it draws (v7.9).
  const rows = visualRows(value, width || Infinity);
  const at = Math.min(live.current.offset, value.length);
  const caretRow = rowOf(rows, at);

  let first = 0;
  let shownRows = rows.length;
  let hidden = 0;
  if (maxRows > 0 && rows.length > maxRows) {
    shownRows = maxRows - 1;                         // one row is the marker
    first = Math.min(Math.max(0, caretRow - Math.floor(shownRows / 2)), rows.length - shownRows);
    hidden = rows.length - shownRows;
  }

  // Where the caret sits inside the window, once the skipped rows are gone.
  const skipped = rows[first].start;
  const text = value.slice(skipped, rows[first + shownRows - 1].end);
  const localAt = Math.max(0, Math.min(at - skipped, text.length));

  // The caret is drawn rather than moved: Ink repaints the frame wherever it
  // likes, so a real terminal cursor would land in the wrong place.
  const body = focus ? (
    <Text>
      {text.slice(0, localAt)}
      <Text inverse>{text[localAt] === undefined || text[localAt] === '\n' ? ' ' : text[localAt]}</Text>
      {text[localAt] === '\n' ? text.slice(localAt) : text.slice(localAt + 1)}
    </Text>
  ) : <Text>{text}</Text>;

  if (hidden <= 0) return body;
  return (
    <Box flexDirection="column">
      {body}
      <Text dimColor>
        {`… ${hidden} more line${hidden === 1 ? '' : 's'}`}
        {first > 0 ? ' (scrolled)' : ''}
      </Text>
    </Box>
  );
}
