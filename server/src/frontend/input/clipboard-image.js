/**
 * Reading an image off the system clipboard.
 *
 * Asked for: paste a screenshot the way Claude Code lets you, and have it
 * arrive as a marker in the prompt rather than a paragraph in the transcript.
 *
 * **The part that surprises people.** On macOS, `Cmd+V` in a terminal is the
 * *terminal's* paste, not the app's — it sends the clipboard as text, and an
 * image has no text, so nothing arrives and the app never hears about it. That
 * is why this looked broken: the machinery worked, and the keystroke never
 * reached it.
 *
 * Two ways in, for that reason:
 *
 * - `ctrl+v`, which the terminal passes through as `0x16` and the app can see.
 * - **an empty paste**, which is what `Cmd+V` produces when the clipboard holds
 *   a picture: the terminal dutifully sends a bracketed paste with nothing in
 *   it. Nothing else generates one, so it is a reliable signal rather than a
 *   guess, and it makes the keystroke people actually press do the right thing.
 *
 * `hasClipboardImage()` is deliberately separate from `readClipboardImage()`:
 * the empty-paste path has to ask "is there a picture?" *before* deciding the
 * paste was about an image, and writing a file to find out would be a side
 * effect on every stray paste.
 */

import { execFileSync } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import * as paths from '../../backend/core/workspace/paths.js';

/** What the clipboard is asked for, in order of preference. */
const FORMATS = [
  { flavour: '«class PNGf»', ext: '.png', mime: 'image/png' },
  { flavour: 'TIFF picture', ext: '.tiff', mime: 'image/tiff' },
];

/**
 * Run osascript, or return null. Never throws.
 *
 * **stderr is captured, never inherited.** `execFileSync` hands a child's
 * stderr to ours unless told otherwise, and ours is the terminal Ink is
 * drawing on. Reading a screenshot makes osascript print `*** Error creating a
 * JP2 color space: falling back to sRGB` twice — two rows Ink never wrote, so
 * its next erase missed by two and left the input box's top rule stranded in
 * scrollback above `/paste-image` (reported with a screenshot, reproduced under
 * the pty, 2026-10-26). Any child spawned while Ink is up needs the same.
 */
export const OSASCRIPT_STDIO = ['ignore', 'pipe', 'pipe'];

function osascript(script, { timeout = 10_000 } = {}) {
  try {
    return execFileSync('osascript', ['-e', script], { encoding: 'utf-8', timeout, stdio: OSASCRIPT_STDIO }).trim();
  } catch {
    return null;
  }
}

/**
 * Whether this machine can read a picture off the clipboard at all.
 *
 * macOS only for now, and it says so rather than failing quietly: a keystroke
 * that does nothing on someone's Linux box is worse than one that explains
 * itself.
 */
export const canReadClipboardImage = () => process.platform === 'darwin';

/**
 * Is there a picture on the clipboard right now?
 *
 * Cheap — it asks what the clipboard *holds*, without copying any of it.
 *
 * @returns {false | {flavour: string, ext: string, mime: string}}
 */
export function hasClipboardImage() {
  if (!canReadClipboardImage()) return false;
  const info = osascript('clipboard info', { timeout: 5000 });
  if (!info) return false;
  return FORMATS.find((f) => info.includes(f.flavour)) || false;
}

/**
 * Copy the clipboard picture into the workspace and read it back.
 *
 * Written under `.agent/tmp/` with a per-copy name: a fixed filename means the
 * second screenshot silently overwrites the first while the first is still
 * attached to an unsent prompt.
 *
 * @returns {{path: string, base64: string, mime: string, sizeKB: number} | null}
 */
export function readClipboardImage(workspace) {
  const advertised = hasClipboardImage();
  if (!advertised) return null;

  // PNG first, whatever was advertised: macOS converts a TIFF clipboard on
  // request, and PNG is what the browser's upload path reliably takes. The
  // inline reader `/image` used to carry did exactly this and it worked; the
  // advertised flavour is only the fallback when the conversion yields nothing.
  const tries = advertised === FORMATS[0] ? [advertised] : [FORMATS[0], advertised];
  for (const format of tries) {
    const got = writeClipboardAs(workspace, format);
    if (got) return got;
  }
  return null;
}

/** One attempt at copying the clipboard out as `format`. Null when it yields nothing. */
function writeClipboardAs(workspace, format) {
  const file = join(paths.ensureDir(paths.tmpDir(workspace)), `clipboard-${Date.now()}${format.ext}`);
  const wrote = osascript(
    `set theFile to (open for access POSIX file "${file}" with write permission)\n`
    + `try\n write (the clipboard as ${format.flavour}) to theFile\n end try\n`
    + 'close access theFile',
  );
  if (wrote === null) return null;

  try {
    // `open for access` creates the file whether or not the write succeeded, so
    // an empty one means the clipboard did not give us what it advertised.
    if (statSync(file).size === 0) return null;
    const bytes = readFileSync(file);
    return {
      path: file,
      base64: bytes.toString('base64'),
      mime: format.mime,
      sizeKB: Math.max(1, Math.round(bytes.length / 1024)),
    };
  } catch {
    return null;
  }
}
