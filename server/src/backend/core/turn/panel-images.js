/**
 * Images pasted into a side panel, kept as files the way the terminal keeps its.
 *
 * The panel cannot write to disk, so it sends each image inline under a
 * `[Image #n: pasted] …` header. The terminal's own header carries the file's
 * path, and that path is what lets the transcript draw `⎿ [Image #n]` as a link
 * and a resumed session draw it again. So the server writes each pasted image
 * under `.agent/tmp/` and puts the real path in its header before the loop
 * sees the message — after that a panel image is indistinguishable from one
 * pasted in the terminal.
 */
import fs from 'fs';
import path from 'path';
import * as paths from '../workspace/paths.js';

/** The header path a panel sends, standing in for the file it cannot write. */
export const PASTED = 'pasted';

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp' };
const BLOCK = /\[Image #(\d+): pasted\]([^\n]*)\n<image_data>\ndata:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)\n<\/image_data>/g;

/**
 * @param {string} content - the message as the panel sent it
 * @param {string} workspace
 * @returns {string} the same message with each pasted image's header naming its file
 */
export function savePastedImages(content, workspace) {
  const text = String(content ?? '');
  if (!text.includes(`: ${PASTED}]`)) return text;
  let dir;
  try { dir = paths.ensureDir(paths.tmpDir(workspace)); } catch { return text; }
  const stamp = Date.now();
  return text.replace(BLOCK, (whole, n, rest, mime, data) => {
    const file = path.join(dir, `panel-${stamp}-${n}${EXT[mime] || '.png'}`);
    try {
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    } catch {
      return whole;                       // the image still goes; only the link is lost
    }
    return `[Image #${n}: ${file}]${rest}\n<image_data>\ndata:${mime};base64,${data}\n</image_data>`;
  });
}
