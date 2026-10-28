/**
 * Files dropped onto the terminal (v5.33).
 *
 * Asked 2026-10-27: *"give an option to drag and drop files"*. A terminal has no
 * drop event to hand an app: dropping a file onto Terminal, iTerm2, Ghostty or
 * VS Code's terminal **pastes its path** — quoted, or with `\ ` escapes, several
 * separated by spaces, inside a bracketed paste. So a drop is a paste that is
 * nothing but paths.
 *
 * - **Every piece must be an existing absolute path** (`/…`, `~/…` or a
 *   `file://` URL). A relative word is never a drop: pasting `package.json` into
 *   a sentence must stay text, and a drop always pastes absolute paths.
 * - **Images become `[Image #n]`**, through the same path as ctrl+v.
 * - **Anything else becomes `[File #n: name]` or `[Folder #n: name]`**, and only
 *   the path goes to the model, with its size and a line saying which tool reads
 *   it. Inlining a 400 KB file would blow the 48k batch budget and type it all
 *   into the tab; `read_file` takes the range the model needs.
 * - **The tag is the attachment**, as with images: backspace takes it in one
 *   press, and a file goes only while its tag is in the text.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff']);

/**
 * Split a paste the way a shell would read it: quotes group, a backslash
 * escapes the next character (not inside single quotes), whitespace separates.
 * Returns null for an unterminated quote — not something a drop produces.
 */
export function splitPaths(text) {
  const out = [];
  let cur = '';
  let has = false;
  let quote = null;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      if (c === '\\' && quote === '"' && i + 1 < s.length) { cur += s[++i]; continue; }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; has = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = ''; has = false;
      continue;
    }
    cur += c; has = true;
  }
  if (quote) return null;
  if (has) out.push(cur);
  return out;
}

/** An absolute path from one piece, or null when the piece is not one. */
export function absolutePiece(piece, { home = os.homedir() } = {}) {
  const p = String(piece ?? '');
  if (p.startsWith('file://')) {
    try { return fileURLToPath(p); } catch { return null; }
  }
  if (p === '~' || p.startsWith('~/')) return path.join(home, p.slice(2));
  if (path.isAbsolute(p)) return p;
  return null;
}

/**
 * The paste as dropped items, or null when it is text.
 *
 * @returns {null | Array<{path: string, kind: 'image'|'file'|'folder'}>}
 */
export function recognizeDrop(text, { statSync = fs.statSync, home } = {}) {
  const pieces = splitPaths(text);
  if (!pieces || pieces.length === 0 || pieces.length > 20) return null;
  const items = [];
  for (const piece of pieces) {
    const abs = absolutePiece(piece, { home });
    if (!abs) return null;
    let st;
    try { st = statSync(abs); } catch { return null; }
    const kind = st.isDirectory() ? 'folder'
      : IMAGE_EXTENSIONS.has(path.extname(abs).toLowerCase()) ? 'image' : 'file';
    items.push({ path: abs, kind });
  }
  return items;
}

const LABEL = { file: 'File', folder: 'Folder' };

/** `[File #2: agent-loop.js]` — the name only; the header line has the path. */
export const fileTag = (f) => `[${LABEL[f.kind]} #${f.n}: ${path.basename(f.path) || f.path}]`;

// Numbered per session like images, from their own counter.
let attached = 0;

/** A dropped file or folder, measured once for the header line. */
export function describeDropped(item) {
  attached += 1;
  const f = { n: attached, path: item.path, kind: item.kind };
  try {
    if (item.kind === 'folder') {
      f.entries = fs.readdirSync(item.path).length;
    } else {
      const st = fs.statSync(item.path);
      f.sizeKB = Math.max(1, Math.round(st.size / 1024));
      // Lines only for text, and only when reading it is cheap: a line count of
      // a PDF means nothing, and a 2 GB log is not worth the pause.
      if (st.size <= 5 * 1024 * 1024) {
        const buf = fs.readFileSync(item.path);
        if (!buf.subarray(0, 8192).includes(0)) {
          let lines = 0;
          for (const b of buf) if (b === 10) lines += 1;
          if (buf.length && buf[buf.length - 1] !== 10) lines += 1;
          f.lines = lines;
        }
      }
    }
  } catch { /* the header says less; the model can still look */ }
  return f;
}

/** The files whose tags are still in the text — the ones that go. */
export function filesInText(text, files = []) {
  return files.filter((f) => String(text ?? '').includes(fileTag(f)));
}

const where = (f, workspace) => {
  const rel = workspace ? path.relative(workspace, f.path) : '';
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : f.path;
};

/**
 * One header line per file, put in front of the message:
 * `[File #1: src/x.js] (412 KB, 4,980 lines) — read it with read_file`.
 * The tag in the text keeps the name; this line gives the model the path.
 */
export function filePromptBlock(files = [], workspace = '') {
  if (!files.length) return '';
  const lines = files.map((f) => {
    const p = where(f, workspace);
    const outside = p === f.path && workspace ? ', outside the workspace' : '';
    if (f.kind === 'folder') {
      const n = Number.isFinite(f.entries) ? `${f.entries} entr${f.entries === 1 ? 'y' : 'ies'}` : 'a folder';
      return `[Folder #${f.n}: ${p}] (${n}${outside}) — list it with list_directory`;
    }
    const size = [f.sizeKB ? `${f.sizeKB.toLocaleString('en-US')} KB` : null,
      Number.isFinite(f.lines) ? `${f.lines.toLocaleString('en-US')} lines` : null].filter(Boolean).join(', ');
    return `[File #${f.n}: ${p}] (${size || 'a file'}${outside}) — read it with read_file`;
  });
  return `${lines.join('\n')}\n\n`;
}

// `[File #1: src/x.js] (…) — read it with read_file`, at the start of a record.
const HEADER = /^\[(File|Folder) #(\d+): ([^\]\n]+)\] \([^\n]*\) — [^\n]*\n/;

/**
 * A recorded prompt with its file headers taken off, and what each tag points
 * at — so the sent message draws `⎿ [File #1: x.js]` rows, as images do.
 *
 * @returns {{text: string, files: Array<{kind: string, n: number, path: string}>}}
 */
// Where relative header paths resolve, for the links; App sets it on a drop.
let base = '';
export function setDropWorkspace(ws) { base = ws || ''; }

export function foldFiles(content, workspace = base) {
  let text = String(content ?? '');
  const files = [];
  let m;
  while ((m = HEADER.exec(text))) {
    const kind = m[1] === 'Folder' ? 'folder' : 'file';
    const p = path.isAbsolute(m[3]) || !workspace ? m[3] : path.join(workspace, m[3]);
    files.push({ kind, n: Number(m[2]), path: p });
    text = text.slice(m[0].length);
  }
  if (files.length) text = text.replace(/^\n+/, '');
  return { text, files };
}

const osc8 = (url, label) => `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;

/** The tag as a link to the file (cmd+click), like an image tag. */
export function fileLink(f) {
  return osc8(pathToFileURL(f.path).href, fileTag(f));
}
