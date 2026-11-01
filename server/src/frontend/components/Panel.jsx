import React from 'react';
import { Box, Text, useInput } from 'ink';
import { T } from '../theme.js';
import { listWindow } from '../menus/panel.js';

/**
 * Every menu's frame, drawn the way `/help` is (`head` replaces the title row
 * where a menu has tabs instead): a rule, the title, a dim line
 * or two saying what it is for, the body, one line of keys. No border and no
 * padding — see `frontend/menus/panel.js` for why, and for the row arithmetic.
 *
 * `tone` colours the title, and the rule too when it is not an ordinary menu:
 * an approval or a destructive confirmation should not look like a picker.
 *
 * `statusTone` colours the status beside the title by role (v6.3): a menu that
 * is a switch says `● on` in the success colour and `○ off` muted, which the
 * owner found "very dull" as plain dim text. Without it the status is dim.
 */
const TONES = {
  menu: () => T.accent,
  attention: () => T.attention,
  danger: () => T.danger,
  review: () => T.review,
};

export function Panel({ ruled = true, head = null, title, status = null, statusTone = null, tone = 'menu', sub = [], tight = false, width = 80, keys, children }) {
  const colour = (TONES[tone] || TONES.menu)();
  return (
    <Box flexDirection="column">
      {ruled && <Text color={tone === 'menu' ? T.muted : colour} wrap="truncate">{'─'.repeat(Math.max(1, width))}</Text>}
      {head ?? (
        <Text wrap="truncate">
          {' '}<Text bold color={colour}>{title}</Text>
          {status ? (
            <Text color={statusTone ? T[statusTone] ?? undefined : undefined} dimColor={!statusTone}>{'  '}{status}</Text>
          ) : null}
        </Text>
      )}
      {sub.map((line, i) => <Text key={i} dimColor wrap="truncate">{` ${line}`}</Text>)}
      {tight ? null : <Text> </Text>}
      {children}
      {tight ? null : <Text> </Text>}
      {keys ? <Text dimColor wrap="truncate">{` ${keys}`}</Text> : null}
    </Box>
  );
}

/**
 * The choices: `❯` on the selected one, in the accent; a dim second column;
 * `✔` beside the one already in effect; `↑ N more` / `↓ N more` when the list
 * is longer than its room.
 *
 * It replaces `ink-select-input`, which drew its own indicator and knew
 * nothing of a second column or a row budget. Same contract otherwise: ↑/↓
 * move (wrapping), enter calls `onSelect(item)`, `onHighlight(item)` on every
 * move. Escape is not handled here — `Menus` owns it, one step back.
 *
 * `numbered` shows `1.`–`9.` and lets the digit pick, as Claude Code's
 * pickers do. Off for anything that approves or destroys: a digit typed into
 * a prompt that appeared under the keyboard must not answer it.
 *
 * Items: `{label, value, key?, detail?, current?, colour?, tone?, glyph?, glyphTone?}`.
 * `tone` is a theme role for the detail; without one the detail is dim.
 * `glyph` leads the label (`● On`, `+ Allow a command…`), coloured by the role
 * `glyphTone` (v6.3). A list with glyphs hides the `1.` column — the glyph is
 * the first thing read — and digits still pick when `numbered`.
 */
/** Exactly `width` columns: padded, or cut with an ellipsis. */
export function fitLabel(text, width) {
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width);
}

export function Choices({
  items,
  onSelect,
  onHighlight,
  initialIndex = 0,
  limit = 10,
  numbered = false,
  isActive = true,
}) {
  const count = items.length;
  const clamp = (n) => Math.max(0, Math.min(n, count - 1));
  const [index, setIndex] = React.useState(() => clamp(initialIndex));

  // A different list (a filter typed, a tab switched) starts again where the
  // caller says. The same list re-rendered keeps its place.
  const signature = items.map((it) => it.key ?? it.value).join('\u0000');
  const seen = React.useRef(signature);
  if (seen.current !== signature) {
    seen.current = signature;
    const next = clamp(initialIndex);
    if (next !== index) setIndex(next);
  }
  const at = clamp(index);

  const move = (to) => {
    setIndex(to);
    if (items[to]) onHighlight?.(items[to]);
  };

  useInput((input, key) => {
    if (!count) return;
    if (key.upArrow) { move(at === 0 ? count - 1 : at - 1); return; }
    if (key.downArrow) { move(at === count - 1 ? 0 : at + 1); return; }
    if (key.return) { onSelect?.(items[at]); return; }
    if (numbered && /^[1-9]$/.test(input)) {
      const n = Number(input) - 1;
      if (n < count) { move(n); onSelect?.(items[n]); }
    }
  }, { isActive });

  if (!count) return null;
  const view = listWindow({ count, cursor: at, room: limit });
  const markers = Math.max(1, limit) >= 3;
  const hasDetail = items.some((it) => it.detail);
  const labelWidth = hasDetail ? Math.min(28, Math.max(...items.map((it) => String(it.label).length))) : 0;
  const numWidth = String(Math.min(count, 9)).length + 2;
  const glyphs = items.some((it) => it.glyph);
  const showNumbers = numbered && !glyphs;

  return (
    <>
      {view.above && markers ? <Text color={T.muted} wrap="truncate">{`   ↑ ${view.above} more`}</Text> : null}
      {items.slice(view.start, view.end).map((item, k) => {
        const i = view.start + k;
        const sel = i === at;
        // A label past the cap is cut, not let through: one long label pushed
        // its own detail a column right of the others (v7.9, "a bit left/right").
        const label = hasDetail ? fitLabel(String(item.label), labelWidth) : String(item.label);
        return (
          <Text key={item.key ?? item.value ?? i} wrap="truncate">
            <Text color={T.accent}>{sel ? ' ❯ ' : '   '}</Text>
            {showNumbers ? <Text color={sel ? T.accent : undefined} dimColor={!sel}>{(i < 9 ? `${i + 1}.` : '').padEnd(numWidth)}</Text> : null}
            {glyphs ? <Text color={item.glyphTone ? T[item.glyphTone] ?? undefined : undefined}>{`${item.glyph || ' '} `}</Text> : null}
            <Text color={sel ? T.accent : item.colour} bold={sel}>{label}</Text>
            {item.detail ? (
              // `text` is the terminal's own foreground, never the palette's
              // white, which vanishes on a light background. The selected row
              // does not recolour it: only the label takes the accent, or the
              // row you are on is the hardest one to read (owner, 2026-10-27).
              <Text color={item.tone && item.tone !== 'text' ? T[item.tone] : undefined}
                dimColor={!item.tone || item.tone === 'muted'}>{'  '}{item.detail}</Text>
            ) : null}
            {item.current ? <Text color={T.success}>{'  ✔'}</Text> : null}
          </Text>
        );
      })}
      {view.below && markers ? <Text color={T.muted} wrap="truncate">{`   ↓ ${view.below} more`}</Text> : null}
    </>
  );
}
