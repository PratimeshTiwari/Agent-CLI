/**
 * Tool: edit_file
 *
 * Propose edits to an existing file. Generates a diff and queues
 * it for user approval via the side panel.
 */

import { existsSync, readFileSync } from 'fs';
import { displayPath, resolveToolPath } from '../../core/workspace/paths.js';

/**
 * A rewrite that only adds to the end, as an append (v9.9.4).
 *
 * Seen from use: building a document section by section, Flash sent the whole
 * file back as `oldText` and the whole file plus a section as `newText`. One
 * edit whose `oldText` runs to the end of the file and whose `newText` starts
 * with it adds only the rest, so that is what is proposed: an addition-only
 * diff, which auto mode does not stop on. Returns the text to append, or null.
 */
export function appendHiddenInEdit(content, edits) {
  if (!Array.isArray(edits) || edits.length !== 1) return null;
  const { oldText, newText } = edits[0] || {};
  if (typeof oldText !== 'string' || typeof newText !== 'string' || oldText.trim().length < 40) return null;
  const at = content.indexOf(oldText);
  if (at === -1 || content.indexOf(oldText, at + 1) !== -1) return null;
  if (content.slice(at + oldText.length).trim() !== '') return null;
  if (!newText.startsWith(oldText) || newText.length === oldText.length) return null;
  let rest = newText.slice(oldText.length);
  // The file's own last newline is kept by an append; do not add a second.
  if (content.endsWith('\n') && rest.startsWith('\n')) rest = rest.slice(1);
  return rest.trim() ? rest : null;
}

export async function editFile(args, context) {
  const { path: filePath } = args;
  let { edits, append } = args;
  const { workspace, diffEngine } = context;

  const absPath = resolveToolPath(workspace, filePath);
  // Relative inside the workspace, absolute outside it. These tools accept
  // absolute paths, and a bare `relative()` turns one into `../../../tmp/x`
  // in the error the model then reads — a path it never used.
  const relPath = displayPath(workspace, absPath);

  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${relPath}. Use create_file to create a new file.`);
  }

  const appending = typeof append === 'string' && append.length > 0;
  if (!appending && (!edits || !Array.isArray(edits) || edits.length === 0)) {
    throw new Error('Give `edits` (a non-empty array of { oldText, newText }) or `append` (text to add at the end)');
  }

  // Validate each edit has required fields
  for (let i = 0; i < (edits || []).length; i++) {
    const edit = edits[i];
    if (typeof edit.oldText !== 'string') {
      throw new Error(`Edit ${i}: 'oldText' must be a string`);
    }
    if (typeof edit.newText !== 'string') {
      throw new Error(`Edit ${i}: 'newText' must be a string`);
    }
  }

  let converted = false;
  if (!appending) {
    let content = null;
    try { content = readFileSync(absPath, 'utf8'); } catch { /* the diff engine reports it */ }
    const rest = content === null ? null : appendHiddenInEdit(content, edits);
    if (rest) { append = rest; edits = []; converted = true; }
  }
  const asAppend = appending || converted;

  // Generate diff
  const diff = diffEngine.generateDiff(relPath, edits || [], { append: asAppend ? append : undefined });

  return {
    diffId: diff.id,
    filePath: diff.filePath,
    status: 'proposed',
    patch: diff.patch,
    hunkCount: diff.hunks.length,
    hunks: diff.hunks.map(h => ({
      id: h.id,
      oldStart: h.oldStart,
      newStart: h.newStart,
      preview: h.lines.slice(0, 10).join('\n') + (h.lines.length > 10 ? '\n...' : ''),
    })),
    message: `Proposed ${asAppend ? 'an append' : `${edits.length} edit(s)`} to ${relPath}. Waiting for approval.`
      + (converted ? ' This edit only added to the end, so it ran as an append. Next time send `append` with just the new text, not the whole file twice.' : ''),
  };
}
