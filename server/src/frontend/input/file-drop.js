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
    const item = droppedItem(absolutePiece(piece, { home }), { statSync });
    if (!item) return null;
    items.push(item);
  }
  return items;
}

/** One existing absolute path as a dropped item, or null. */
export function droppedItem(abs, { statSync = fs.statSync } = {}) {
  if (!abs || !path.isAbsolute(abs)) return null;
  let st;
  try { st = statSync(abs); } catch { return null; }
  const kind = st.isDirectory() ? 'folder'
    : IMAGE_EXTENSIONS.has(path.extname(abs).toLowerCase()) ? 'image' : 'file';
  return { path: abs, kind };
}

/**
 * A drop that did not arrive as a paste (v6.23). VS Code's terminal types a
 * dropped path in — `'/Users/…/x.jsonl' ` — with no bracketed-paste markers,
 * so it reached the prompt as typed text and never became a tag. One stdin
 * chunk holding nothing but existing absolute paths is a drop (typing never
 * delivers a whole path in one read), so it is wrapped as the paste it is.
 *
 * @returns {string|null} the chunk inside paste markers, or null to leave it.
 */
export function asBracketedDrop(chunk, { statSync, home } = {}) {
  const s = String(chunk ?? '');
  if (s.length < 3 || s.includes('\x1b')) return null;
  // Cheap gate first: this runs on every chunk, and a stat is not free.
  if (!/^\s*(?:['"]?(?:\/|~\/|file:\/\/))/.test(s)) return null;
  if (/[\r\n]/.test(s.trimEnd())) return null;
  return recognizeDrop(s.trim(), { statSync, home }) ? `\x1b[200~${s.trim()}\x1b[201~` : null;
}

/**
 * VS Code's pty host writes input in pieces of at most 50 characters, 5 ms
 * apart (`chunkInput` in ptyHostMain), so a dropped path longer than that
 * arrived as several reads and `asBracketedDrop` saw only the first (v6.25).
 * A 45-character `.dmg` path became a tag; a workspace `.jsonl` did not.
 */
export const PTY_CHUNK = 50;
const JOIN_WAIT_MS = 30;
const looksLikePathStart = (s) => !s.includes('\x1b') && /^\s*['"]?(?:\/|~\/|file:\/\/)/.test(s);

/**
 * Holds a read that could be the first piece of a split drop and joins the
 * pieces after it. Only a read whose length is a whole number of pty pieces
 * and that starts like a path is held — typing never delivers fifty
 * characters in one read — and the held text is delivered whole and in order,
 * after a read shorter than a piece or `JOIN_WAIT_MS` of quiet.
 */
export function createDropJoiner({ deliver, setTimer = setTimeout, clearTimer = clearTimeout, waitMs = JOIN_WAIT_MS }) {
  let held = '';
  let timer = null;
  const flush = () => {
    if (timer) clearTimer(timer);
    timer = null;
    const text = held;
    held = '';
    if (text) deliver(text);
  };
  return {
    accept(raw) {
      const s = String(raw);
      const full = s.length > 0 && s.length % PTY_CHUNK === 0;
      if (!held) {
        if (!full || !looksLikePathStart(s)) return deliver(s);
      } else if (s.includes('\x1b')) {
        flush();
        return deliver(s);
      }
      held += s;
      if (!full) return flush();
      if (timer) clearTimer(timer);
      timer = setTimer(flush, waitMs);
    },
    flush,
  };
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
  // A small file dropped on a side panel rides inline after its header (v6.17);
  // the row is the tag, so the text is not drawn twice.
  if (files.length) {
    while ((m = /^<file name="[^"\n]*">\n[\s\S]*?\n<\/file>\n*/.exec(text))) text = text.slice(m[0].length);
  }
  return { text, files };
}

const osc8 = (url, label) => `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;

/** The tag as a link to the file (cmd+click), like an image tag. */
export function fileLink(f) {
  return osc8(pathToFileURL(f.path).href, fileTag(f));
}
