/**
 * Turning a diff into something the terminal can draw.
 *
 * The approval box used to show a file path and a hunk count, which is not
 * enough to approve on: you either trusted it blindly or rejected and asked to
 * see the change. This builds the unified diff the engine produced, capped so a
 * large edit cannot push the prompt itself off screen.
 *
 * It reads the **patch string**, which is the one form both callers have.
 * `previewRows` and `summarizeDiff` used to live here and read structured hunks
 * — `lines`, `oldLines`, `newLines` — and were only ever handed the *tool's*
 * hunks, which `edit_file` trims to an id, a start and a preview so the copy
 * that could reach the model stays small. The two shapes never matched, so the
 * approval screen drew `@@ -1,undefined +1,undefined @@`, `+0 / -0` and no diff
 * for as long as it has existed. They are gone rather than fixed: one renderer
 * reading the form everyone actually has beats two where one is unreachable.
 */

/**
 * The same display rows, built from a unified-diff string.
 *
 * The approval prompt is handed the engine's structured hunks, which carry
 * their `lines`. The transcript is not: `edit_file` returns hunks trimmed to an
 * id, a start and a ten-line `preview` string, because that return value is
 * also what would reach the model, and the prompt economics here exist to keep
 * exactly that kind of payload small.
 *
 * What the transcript does have is `patch` — the whole unified diff, already in
 * the result. Parsing it costs nothing at the source and keeps the model's copy
 * of the result as small as it is today.
 *
 * @returns {Array<{type, text, oldNo, newNo}>} same shape as `previewRows`
 */
export function rowsFromPatch(patch, { maxLines = 16 } = {}) {
  if (typeof patch !== 'string' || !patch) return [];

  const rows = [];
  let oldNo = 0;
  let newNo = 0;
  let shown = 0;
  let skipped = 0;

  for (const line of patch.split('\n')) {
    // The file headers `createPatch` puts on the front say nothing the
    // transcript has not already said on the tool row.
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:')
        || line.startsWith('===')) continue;

    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      if (shown < maxLines) rows.push({ type: 'header', text: line, oldNo: null, newNo: null });
      continue;
    }

    if (shown >= maxLines) { skipped++; continue; }

    if (line.startsWith('+')) {
      rows.push({ type: 'add', text: line, oldNo: null, newNo });
      newNo++; shown++;
    } else if (line.startsWith('-')) {
      rows.push({ type: 'del', text: line, oldNo, newNo: null });
      oldNo++; shown++;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — true, and not worth a row.
      continue;
    } else {
      rows.push({ type: 'ctx', text: line, oldNo, newNo });
      oldNo++; newNo++; shown++;
    }
  }

  // A trailing blank from the split is not a context line.
  while (rows.length && rows[rows.length - 1].type === 'ctx'
         && rows[rows.length - 1].text === '') rows.pop();

  if (skipped > 0) {
    rows.push({ type: 'more', text: `… ${skipped} more line${skipped === 1 ? '' : 's'}`, oldNo: null, newNo: null });
  }
  return rows;
}

/** Approve and Reject, and in plan and strict "Approve, and stop asking". */
export const diffChoiceCount = (mode) => (mode === 'plan' || mode === 'strict' ? 3 : 2);

/** Rows under the diff box: the spacing row and the status bar, plus one, because Ink repaints a frame as tall as the screen. */
export const DIFF_BOX_BELOW = 3;

/**
 * What the diff approval box draws in `terminalHeight` rows (v9.9.6).
 *
 * The box asked for 16 diff lines whatever the terminal, and its spacing and
 * reason line on top. At 13 rows a two-line edit drew a frame exactly as tall
 * as the screen, and Ink clears the screen and scrollback for that: once when
 * the box appeared, and again on every redraw of it, such as a mode switched
 * from it. What gives way, in order: diff lines down to three, the spacing
 * around them, the reason line, then diff lines down to one. The choices and
 * the title never do.
 *
 * @returns {{rows: Array, margins: boolean, reason: boolean, hint: boolean, height: number}}
 */
export function diffBoxLayout({ patch, choices = 3, reason = false, expanded = false, terminalHeight = 24, maxRows = null, collapsed = 16 } = {}) {
  // `maxRows`: what App gives the box, the input's rows and the live frame's
  // past one row of the turn (as the command box). Else the screen's height.
  const room = Math.max(1, maxRows ?? terminalHeight - DIFF_BOX_BELOW);
  const start = expanded ? Math.max(collapsed, terminalHeight) : collapsed;
  const levels = [
    { margins: true, reason, floor: 3 },
    { margins: false, reason, floor: 3 },
    { margins: false, reason: false, floor: 1 },
  ];
  let last = null;
  for (const level of levels) {
    for (let maxLines = start; maxLines >= level.floor; maxLines--) {
      const rows = rowsFromPatch(patch, { maxLines });
      const hint = expanded || rows.some((r) => r.type === 'more');
      const height = 2 + choices + (level.reason ? 1 : 0)
        + (rows.length ? rows.length + (level.margins ? 2 : 0) : 0) + (hint ? 1 : 0);
      last = { rows, margins: level.margins, reason: level.reason, hint, height };
      if (height <= room) return last;
    }
  }
  return last;
}
