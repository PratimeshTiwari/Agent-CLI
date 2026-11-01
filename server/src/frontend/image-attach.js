/**
 * Images in a prompt, the way Claude Code does them.
 *
 * Owner, 2026-10-26, with two screenshots of Claude Code: ctrl+v puts
 * `[Image #13]` into the prompt where you are typing, and the sent message shows
 * the tag — which you can click to see what was sent. No `/paste-image` row, no
 * note under it, nothing in the status bar.
 *
 * - **The tag is the attachment.** An image goes with a message only while its
 *   tag is in the text, so deleting the tag is how you take it off again.
 * - **The tag is a link** once sent: an OSC 8 hyperlink to the file, which a
 *   terminal opens on cmd+click. That is not mouse tracking (`CLAUDE.md`: never),
 *   so scrolling and drag-select stay the terminal's. A terminal without OSC 8
 *   draws the text and nothing else.
 * - **The record keeps the path.** The loop records the prompt with the image
 *   data stripped; the header line above it, `[Image #1: <path>] …`, is what lets
 *   a resumed session draw the same link.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { canReadClipboardImage, readClipboardImage } from './clipboard-image.js';
import { stripImageData } from '../backend/core/prompt-builder.js';

export const imageTag = (n) => `[Image #${n}]`;

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.tiff': 'image/tiff',
};

// Numbered per session, as Claude Code numbers them. Module state on purpose: it
// outlives a remount of App (a theme change reprints) and resets on restart.
let attached = 0;

/**
 * Read an image for attaching: the clipboard's, or a file's.
 *
 * @returns {{ok: true, image: {n, path, base64, mime, sizeKB}} | {ok: false, reason: string}}
 */
export function loadImage({ workspace, filePath = null }) {
  let file;
  let mime;
  if (!filePath) {
    if (!canReadClipboardImage()) return { ok: false, reason: 'Clipboard images need macOS — `/image <path>` attaches a file.' };
    const got = readClipboardImage(workspace);
    if (!got) return { ok: false, reason: 'No image on the clipboard.' };
    file = got.path;
    mime = got.mime;
  } else {
    file = path.resolve(workspace, filePath);
    if (!fs.existsSync(file)) return { ok: false, reason: `No such file: ${filePath}` };
    mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) return { ok: false, reason: `Not an image: ${filePath}` };
  }
  try {
    const bytes = fs.readFileSync(file);
    attached += 1;
    return {
      ok: true,
      image: {
        n: attached,
        path: file,
        base64: bytes.toString('base64'),
        mime,
        sizeKB: Math.max(1, Math.round(bytes.length / 1024)),
      },
    };
  } catch (err) {
    return { ok: false, reason: `Could not read the image: ${err.message}` };
  }
}

/** The images whose tags are still in the text — the ones that go. */
export function imagesInText(text, images = []) {
  return images.filter((img) => String(text ?? '').includes(imageTag(img.n)));
}

/**
 * The prompt with a tag put in at the caret, and where the caret goes after it.
 *
 * A space before the tag unless there is one, and one after unless the text
 * already carries on with one — so `look at|` gives `look at [Image #1] |`.
 *
 * @returns {{value: string, offset: number}}
 */
export function tagAt(value, offset, n) {
  return textAt(value, offset, imageTag(n));
}

/** Any tag at the caret, spaced the same way (file tags use it too, v5.33). */
export function textAt(value, offset, tag) {
  const text = String(value ?? '');
  const at = Math.max(0, Math.min(offset ?? text.length, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const tail = /^\s/.test(after) ? '' : ' ';
  const put = `${lead}${tag}${tail}`;
  return { value: before + put + after, offset: at + put.length };
}

/**
 * The block that carries the images, put in front of the message.
 *
 * One header line per image, then its data. The content script lifts every
 * `<image_data>` block out and pastes them as files; the header stays, so the
 * model can tell which `[Image #n]` in the text is which picture.
 */
export function imagePromptBlock(images = []) {
  if (!images.length) return '';
  return `${images.map((img) => `${imageTag(img.n).slice(0, -1)}: ${img.path}] (${img.sizeKB}KB, ${img.mime})\n`
    + `<image_data>\ndata:${img.mime};base64,${img.base64}\n</image_data>`).join('\n')}\n\n`;
}

/** The same block as the loop will record it: no data, paths kept. */
export const recordedImageBlock = (images) => stripImageData(imagePromptBlock(images));

// `[Image #1: /path] (110KB, image/png)` and its placeholder, at the start.
const HEADER = /^\[Image #(\d+): ([^\]\n]+)\][^\n]*\n<image_data>[^\n]*?<\/image_data>\n?/;
// The format before 2026-10-26: one image, no number.
const OLD_HEADER = /^\[Image attached:[^\n]*\]\s*(?:<image_data>[\s\S]*?<\/image_data>\s*)?/;

/**
 * A recorded prompt, split into what is drawn and where each tag points.
 *
 * @returns {{text: string, links: Map<number, string>}}
 */
export function foldImages(content) {
  let text = String(content ?? '');
  const links = new Map();
  if (OLD_HEADER.test(text)) return { text: text.replace(OLD_HEADER, '[Image] '), links };
  let m;
  while ((m = HEADER.exec(text))) {
    links.set(Number(m[1]), m[2]);
    text = text.slice(m[0].length);
  }
  if (links.size) text = text.replace(/^\n+/, '');
  return { text, links };
}

const osc8 = (url, label) => `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;

/**
 * A drawn line with its tags made into links.
 *
 * Applied after wrapping, never before: `blockLines` measures by `.length`, and
 * an escape sequence it counted would wrap the row early. A tag split across two
 * lines by the wrap stays plain text.
 */
export function linkImageTags(line, links) {
  if (!links?.size) return line;
  return String(line).replace(/\[Image #(\d+)\]/g, (tag, n) => {
    const file = links.get(Number(n));
    return file ? osc8(pathToFileURL(file).href, tag) : tag;
  });
}

/**
 * Backspace at `offset`, with a tag as one character.
 *
 * Claude Code's behaviour: backspace on `[Image #1]` takes the whole tag, and
 * with it the image (an image goes only while its tag is in the text). Its
 * trailing space goes too, so the caret right after `withTag` removes it in one
 * press. Anything else is an ordinary one-character backspace.
 *
 * @returns {{value: string, offset: number}}
 */
export function backspaceAt(value, offset) {
  const text = String(value ?? '');
  if (offset <= 0) return { value: text, offset: 0 };
  // A dropped file's tag too (v5.33): `[File #2: x.js]`, `[Folder #1: src]`.
  const m = /\[(?:Image #\d+|(?:File|Folder) #\d+: [^\]\n]*)\] ?$/.exec(text.slice(0, offset));
  const from = m ? m.index : offset - 1;
  return { value: text.slice(0, from) + text.slice(offset), offset: from };
}
