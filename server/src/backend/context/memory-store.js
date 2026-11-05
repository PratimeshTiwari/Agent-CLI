import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { memoryDir, memoryPath } from '../core/workspace/paths.js';

/**
 * Memory as a folder (v9.4): one fact per file in `.agent/<scope>/memory/`.
 *
 * Asked for on 2026-11-05, from a talk on how agent memory scales. `memory.md`
 * was one list, with nothing to say who wrote a line, when, or why, and any two
 * agents on one repo rewrote each other's copy of the whole file. Three things
 * follow from one file per fact:
 *
 * - **Every fact carries its author, session, time and reason.** The harness
 *   stamps them, so the model cannot forget to, or claim a person said it.
 * - **Several agents can write at once.** A compare-and-swap on the file's hash,
 *   held here and not in the model: a write is refused if the fact changed since
 *   this process last showed it to the model. The refusal says who changed it.
 * - **The prompt carries an index, not the contents** (prompt v6). There is no
 *   index *file*: it is derived on every read, so it cannot disagree with the
 *   facts, which is the failure a hand-kept index has.
 *
 * **One store for every prompt version.** v1's words are frozen; where its facts
 * live is not. With two stores, moving between versions would lose memory.
 * `memory.md` is imported once, and is still read if a person writes to it later:
 * a habit should not lose a note. It is moved aside, never deleted.
 *
 * Reads never throw: a turn must not die on a memory file. Writes report what
 * happened, because the caller has to tell the model.
 */

/** What this process has shown the model, by file: the hash a later write must match. */
const seen = new Map();

const MAX_FILE_BYTES = 64 * 1024;
const LOCK_STALE_MS = 5_000;
export const DESCRIPTION_MAX = 120;

const sha = (text) => createHash('sha256').update(text).digest('hex');
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Read the bullets of a `memory.md`.
 *
 * Deliberately forgiving: that file was meant to be hand-edited, so `-`, `*` and
 * `1.` all count, and anything else — a heading, a note to self, a blank line —
 * is left alone rather than silently becoming a "fact".
 */
export function parseMemory(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter(Boolean);
}

/** A file name from the fact's first words: readable in a listing and in the prompt. */
export function memoryName(fact) {
  const words = oneLine(fact).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  let name = '';
  for (const word of words.slice(0, 6)) {
    if (`${name}-${word}`.length > 50) break;
    name = name ? `${name}-${word}` : word;
  }
  return name || 'fact';
}

/** The first line a person reads, cut on a word. `…` tells the model there is more. */
function describe(fact) {
  const clean = oneLine(fact);
  if (clean.length <= DESCRIPTION_MAX) return clean;
  const cut = clean.slice(0, DESCRIPTION_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 60))}…`;
}

function renderFact({ fact, why, author, session, written }) {
  const header = [
    `description: ${describe(fact)}`,
    `author: ${oneLine(author)}`,
    session ? `session: ${oneLine(session)}` : null,
    `written: ${written}`,
    why ? `why: ${oneLine(why)}` : null,
  ].filter(Boolean);
  return `---\n${header.join('\n')}\n---\n\n${oneLine(fact)}\n`;
}

/**
 * A fact file, whoever wrote it. A person's file has no header and that is fine:
 * its first line is the description, and with no author it is theirs.
 */
function parseFact(text, name, mtime) {
  const body = String(text).replace(/\r\n/g, '\n');
  const framed = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(body);
  const meta = {};
  for (const line of (framed?.[1] ?? '').split('\n')) {
    const m = /^([a-z]+):\s*(.*)$/.exec(line);
    if (m) meta[m[1]] = m[2];
  }
  const content = (framed ? framed[2] : body).trim();
  const firstLine = content.split('\n').find((l) => l.trim()) ?? '';
  const fact = oneLine(content);
  const written = Number.isNaN(Date.parse(meta.written)) ? new Date(mtime).toISOString() : meta.written;
  return {
    name,
    fact,
    description: meta.description || describe(firstLine.replace(/^#+\s*/, '')),
    why: meta.why || '',
    author: meta.author || 'you',
    session: meta.session || '',
    written,
  };
}

export class MemoryStore {
  /** @param {string} workspace */
  constructor(workspace) {
    this.workspace = workspace;
    this.dir = memoryDir(workspace);
  }

  /** A name as the prompt shows it, or null for anything that is not one file here. */
  _file(name) {
    const base = oneLine(name).replace(/\.md$/, '');
    if (!base || base.startsWith('.') || base !== path.basename(base)) return null;
    return path.join(this.dir, `${base}.md`);
  }

  /** The text of a fact file. A symlink or a directory is not a fact: `null`. */
  _read(file) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
      return { text: fs.readFileSync(file, 'utf8'), mtime: stat.mtimeMs };
    } catch {
      return null;
    }
  }

  /**
   * Every fact, oldest first, so `/memory forget 3` and v1's numbers hold.
   * @returns {Array<{name: string, fact: string, description: string, why: string,
   *                  author: string, session: string, written: string}>}
   */
  list() {
    this.importLegacy();
    return this._scan();
  }

  _scan() {
    let names;
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    const facts = [];
    for (const entry of names) {
      if (entry.startsWith('.') || !entry.endsWith('.md')) continue;
      const read = this._read(path.join(this.dir, entry));
      if (read) facts.push(parseFact(read.text, entry.slice(0, -3), read.mtime));
    }
    return facts.filter((f) => f.fact).sort((a, b) => (
      Date.parse(a.written) - Date.parse(b.written) || a.name.localeCompare(b.name)
    ));
  }

  /** Note that the model has now seen this fact as it stands. */
  _markSeen(name) {
    const file = this._file(name);
    const read = file && this._read(file);
    if (read) seen.set(file, sha(read.text));
  }

  /**
   * The lines `<memory>` holds under prompt v6, newest first, so a cap costs the
   * oldest. Bounded for the reason `_loadMemory` always was: this grows on its own.
   * Every fact listed counts as seen, so a stale edit can be refused.
   */
  index({ maxRows = 60, maxChars = 4000 } = {}) {
    const facts = this.list().reverse();
    const rows = [];
    let total = 0;
    for (const f of facts) {
      // A fact is written by the model, or by anyone who can write to this
      // folder, and it must not be able to close the block it sits in.
      const row = `- ${f.name}: ${f.description}`.replace(/<(\/?)memory/gi, '($1memory');
      if (rows.length >= maxRows || total + row.length > maxChars) break;
      total += row.length;
      rows.push(row);
      this._markSeen(f.name);
    }
    return { rows, more: facts.length - rows.length };
  }

  /** One fact whole. The model has now seen it, so it may change it. */
  read(name) {
    const file = this._file(name);
    const found = file && this._read(file);
    if (!found) return null;
    seen.set(file, sha(found.text));
    return parseFact(found.text, path.basename(file, '.md'), found.mtime);
  }

  /**
   * Add a fact.
   *
   * `link` rather than `rename`: it fails if the name is taken, so two agents
   * adding at the same moment get two files, never one over the other.
   *
   * @returns {{ok: true, name: string} | {ok: false, reason: string, name?: string, detail?: string}}
   */
  add(entry) {
    this.importLegacy();
    return this._add(entry);
  }

  /** `add` without the import, which is what the import itself calls. */
  _add({ fact, why = '', author = 'agent', session = '', written = new Date().toISOString() }) {
    const clean = oneLine(fact);
    if (!clean) return { ok: false, reason: 'empty' };
    const same = this._scan().find((f) => f.fact.toLowerCase() === clean.toLowerCase());
    if (same) return { ok: false, reason: 'duplicate', name: same.name };

    const text = renderFact({ fact: clean, why, author, session, written });
    const tmp = path.join(this.dir, `.tmp-${randomUUID()}`);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(tmp, text, 'utf8');
      const slug = memoryName(clean);
      for (let i = 1; ; i += 1) {
        const name = i === 1 ? slug : `${slug}-${i}`;
        const file = path.join(this.dir, `${name}.md`);
        try {
          fs.linkSync(tmp, file);
          seen.set(file, sha(text));
          return { ok: true, name };
        } catch (err) {
          if (err.code !== 'EEXIST') throw err;
        }
      }
    } catch (err) {
      return { ok: false, reason: 'write_failed', detail: err.message };
    } finally {
      try {
        fs.rmSync(tmp, { force: true });
      } catch { /* `force` forgives a missing file, not a missing folder */ }
    }
  }

  /**
   * Take the fact's lock, check it is what the model last saw, then run `write`.
   *
   * The check and the write sit inside one lock, or two agents could both pass
   * the check. `force` is for a person (`/memory forget`), and for v1's numbered
   * remove, which has no way to name a version.
   */
  _swap(name, { force = false }, write) {
    const file = this._file(name);
    if (!file) return { ok: false, reason: 'not_found' };
    const lock = path.join(this.dir, `.lock-${path.basename(file, '.md')}`);
    try {
      fs.closeSync(fs.openSync(lock, 'wx'));
    } catch (err) {
      if (err.code === 'ENOENT') return { ok: false, reason: 'not_found' };
      if (err.code !== 'EEXIST') return { ok: false, reason: 'write_failed', detail: err.message };
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lock).mtimeMs;
      } catch { /* its holder just let go */ }
      // A process that died holding it must not freeze the fact for good.
      if (age > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
      return { ok: false, reason: 'busy' };
    }
    try {
      const current = this._read(file);
      if (!current) return { ok: false, reason: 'not_found' };
      if (!force) {
        const shown = seen.get(file);
        if (!shown) return { ok: false, reason: 'unread' };
        if (shown !== sha(current.text)) {
          const now = parseFact(current.text, path.basename(file, '.md'), current.mtime);
          return { ok: false, reason: 'changed', author: now.author, written: now.written };
        }
      }
      return write(file, current);
    } catch (err) {
      return { ok: false, reason: 'write_failed', detail: err.message };
    } finally {
      fs.rmSync(lock, { force: true });
    }
  }

  /** Replace a fact. Its author becomes whoever changed it, and the time with it. */
  update(name, { fact, why, author = 'agent', session = '', force = false }) {
    const clean = oneLine(fact);
    if (!clean) return { ok: false, reason: 'empty' };
    return this._swap(name, { force }, (file, current) => {
      const before = parseFact(current.text, path.basename(file, '.md'), current.mtime);
      const text = renderFact({
        fact: clean,
        why: why ?? before.why,
        author,
        session,
        written: new Date().toISOString(),
      });
      const tmp = `${path.join(this.dir, '.tmp-')}${randomUUID()}`;
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, file);
      seen.set(file, sha(text));
      return { ok: true, name: path.basename(file, '.md') };
    });
  }

  /** Forget a fact. It is moved aside, because a model can be wrong about this too. */
  remove(name, { force = false } = {}) {
    return this._swap(name, { force }, (file) => {
      const base = path.basename(file, '.md');
      fs.renameSync(file, path.join(this.dir, `.removed-${base}-${Date.now()}.md`));
      seen.delete(file);
      return { ok: true, name: base };
    });
  }

  /**
   * Bring `memory.md` in. A no-op without one, so it runs on every listing, which
   * is what picks up a note a person added to the old file after the first import.
   * The file stays where it is unless every fact is safely in the folder.
   */
  importLegacy() {
    const legacy = memoryPath(this.workspace);
    const found = this._read(legacy);
    if (!found) return 0;
    let added = 0;
    const facts = parseMemory(found.text);
    for (const [i, fact] of facts.entries()) {
      // Each its own millisecond, so the old file's order is still the order.
      const written = new Date(found.mtime + i).toISOString();
      const done = this._add({ fact, author: 'imported', written });
      if (!done.ok && done.reason !== 'duplicate') return added;
      if (done.ok) added += 1;
    }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.renameSync(legacy, path.join(this.dir, `.imported-memory-${Date.now()}.md`));
    } catch { /* another agent moved it first, or the next listing tries again */ }
    return added;
  }
}
