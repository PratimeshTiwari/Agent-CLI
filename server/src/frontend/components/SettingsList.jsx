import React from 'react';
import { Text, useInput } from 'ink';
import { T } from '../theme.js';
import { listWindow, settingTone } from '../panel.js';
import { controlParts, controlWidth, rowHint, stepValue, isFilterText, ROLE_COLOUR } from '../settings-view.js';


const OSC8_CLOSE = '\x1b]8;;\x1b\\';
const osc8Open = (url) => `\x1b]8;;${url}\x1b\\`;
/**
 * The `/settings` list: label, value, and the selected row's hint beside it.
 * The rules are in `frontend/settings-view.js`; this draws them and takes the keys.
 *
 * Its own list rather than `Choices`, because a row here is three cells with
 * their own colours and the keys mean more: ←/→ change the value in place,
 * and printable keys go to the filter above.
 *
 * Rows: `{label, value, hint?, control?, skip?, run?}` — `skip` is options
 * ←/→ pass over (Max where the account has no Argon).
 */
export function SettingsList({
  rows,
  at = 0,
  width = 80,
  room = 10,
  query = '',
  notes = {},
  onMove,
  onStep,
  onSelect,
  onQuery,
  isActive = true,
}) {
  const count = rows.length;
  const cursor = Math.max(0, Math.min(at, count - 1));

  useInput((input, key) => {
    if (key.upArrow || key.downArrow) {
      if (!count) return;
      onMove?.(key.upArrow ? (cursor === 0 ? count - 1 : cursor - 1) : (cursor === count - 1 ? 0 : cursor + 1));
      return;
    }
    if (key.leftArrow || key.rightArrow) {
      const row = rows[cursor];
      if (!row?.control) return;
      const value = stepValue(row, key.leftArrow ? -1 : 1, { skip: row.skip });
      if (value != null) onStep?.(row, value);
      return;
    }
    if (key.return) {
      if (rows[cursor]) onSelect?.(rows[cursor]);
      return;
    }
    if (key.backspace || key.delete) {
      // Nothing to delete is nothing to do: it must not close or move anything.
      if (query) onQuery?.(query.slice(0, -1));
      return;
    }
    if (isFilterText(input, key)) onQuery?.(query + input);
  }, { isActive });

  if (!count) return null;
  const view = listWindow({ count, cursor, room });
  const markers = Math.max(1, room) >= 3;
  const labelWidth = Math.min(28, Math.max(...rows.map((r) => String(r.label).length)));
  const valueWidth = Math.min(34, Math.max(...rows.map((r) => controlWidth(r, { skip: r.skip }))));

  return (
    <>
      {view.above && markers ? <Text color={T.muted} wrap="truncate">{`   ↑ ${view.above} more`}</Text> : null}
      {rows.slice(view.start, view.end).map((row, k) => {
        const sel = view.start + k === cursor;
        const parts = controlParts(row, { skip: row.skip });
        const drawn = controlWidth(row, { skip: row.skip });
        // A read-only value keeps one colour: attention, for something that is
        // waiting on you. Everything else is plain — colour marks the cursor.
        const warn = !row.control && settingTone(row) === 'attention';
        const hint = sel ? rowHint(row, { width, used: 3 + labelWidth + 2 + valueWidth, note: notes[row.label] }) : '';
        return (
          <Text key={row.label} wrap="truncate">
            <Text color={T.accent}>{sel ? ' ❯ ' : '   '}</Text>
            <Text color={row.staged ? T.attention : sel ? T.accent : undefined} bold={sel}>{String(row.label).padEnd(labelWidth)}</Text>
            {'  '}
            {/* An OSC 8 link around the value (v7.9): cmd+click opens it. Zero
                width, so the column and the truncation are unchanged. */}
            {row.link ? osc8Open(row.link) : null}
            {parts.map((p, i) => (
              <Text key={i} color={warn ? T.attention : ROLE_COLOUR[p.role] ? T[ROLE_COLOUR[p.role]] : undefined}
                underline={Boolean(row.link)} dimColor={p.role === 'dim'}>{p.text}</Text>
            ))}
            {row.link ? OSC8_CLOSE : null}
            {hint ? <Text dimColor>{' '.repeat(Math.max(0, valueWidth - drawn) + 3)}{hint}</Text> : null}
          </Text>
        );
      })}
      {view.below && markers ? <Text color={T.muted} wrap="truncate">{`   ↓ ${view.below} more`}</Text> : null}
    </>
  );
}
