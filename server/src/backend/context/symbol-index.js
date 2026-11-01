/**
 * Where a symbol is defined, and who uses it.
 *
 * The structural half of working in a codebase, and the half grep is worst at.
 * `grep_search` can find the string `resolveEffort`; it cannot tell the
 * definition from the forty call sites, and it cannot tell either from the word
 * appearing in a comment. That gap is recorded in `CLAUDE.md` under "What a
 * large codebase actually needs" and has been open since the `ast-chunker` was
 * deleted.
 *
 * **Why this is not that file.** `ast-chunker` walked `ast.body` only, so every
 * class method and every `export const foo = () => {}` was invisible — it
 * resolved 24% of this repo's own top-level symbols — and plain acorn cannot
 * parse `.jsx` at all, which is most of `frontend/`. `acorn-walk` visits every node
 * rather than the top level, and `acorn-jsx` handles the JSX. Both were named
 * in `CLAUDE.md` as what a working version wants; this is them.
 *
 * **Why not an embedding index.** Decided and recorded: code search is mostly
 * exact-symbol search, an embedding index goes stale on every edit, and the
 * context window here is a browser chat tab, so every retrieved chunk is typed
 * into Gemini by a content script. This is the opposite trade — exact, cheap,
 * and it returns *locations* rather than prose.
 *
 * **Why not ctags or tree-sitter.** Both cover more languages and neither is
 * free. Universal ctags is not installed on a typical machine, and this project
 * has a standing rule that a tool which silently does nothing is worse than no
 * tool. tree-sitter is a native build. acorn is three small pure-JS packages
 * that cover this codebase completely. What it does *not* cover, it says so
 * about, per file, by name — because the failure that matters is the model
 * concluding a symbol does not exist when the truth is that nothing looked.
 */

import { readFileSync, statSync } from 'fs';
import { relative, extname } from 'path';
import fg from 'fast-glob';
import { AGENT_DIR } from '../core/workspace/paths.js';
import { RUBY, rubyCodeLines, rubyDefinitionsIn, rubyReferencesIn } from './ruby-symbols.js';
import { PATTERN_EXTS, languageFor, patternCodeLines, patternDefinitionsIn, patternReferencesIn } from './pattern-symbols.js';

/** What acorn can read. Everything else is reported, not silently dropped. */
export const PARSEABLE = new Set(['.js', '.jsx', '.mjs', '.cjs']);

/** A file larger than this is generated (a bundle, a vendored parser table), not code anyone asks about. */
const MAX_PATTERN_BYTES = 2 * 1024 * 1024;

/**
 * acorn, acorn-jsx and acorn-walk, loaded on first use (v6.8).
 *
 * They were static imports, so `/doctor` called all three *required* — the
 * agent would not start without them — when nothing touches them until a
 * symbol tool is called. Loaded here, a missing copy costs the JavaScript half
 * of two tools and says so in their answer; Ruby and everything else go on.
 * About 10 ms, paid once.
 *
 * @returns {Promise<{Parser: any, walk: any, WALK_BASE: object}>}
 */
let js = null;
export async function loadJsParser() {
  if (js) return js;
  const [acorn, jsx, walk] = await Promise.all([import('acorn'), import('acorn-jsx'), import('acorn-walk')]);
  js = {
    Parser: acorn.Parser.extend(jsx.default()),
    walk,
    WALK_BASE: { ...walk.base, ...JSX_BASE, ...MODULE_BASE },
  };
  return js;
}

function parser() {
  if (!js) throw new Error('loadJsParser() has not run');
  return js;
}

const PARSE_OPTIONS = { ecmaVersion: 'latest', sourceType: 'module', locations: true };

/**
 * JSX walkers, because `acorn-jsx` teaches the parser and not the walker.
 *
 * `acorn-jsx` produces `JSXElement` and friends, and `acorn-walk` throws "No
 * walker function defined for node type JSXElement" the moment it meets one —
 * so a `.jsx` file parses perfectly and then fails on the walk. Adding the
 * parser without these is how "acorn cannot parse .jsx" gets written down as a
 * fact when the truth is that nobody taught the walker.
 *
 * Only the nodes that can *contain* something worth finding are descended into.
 * `JSXText` is prose and `JSXEmptyExpression` is nothing.
 */
const JSX_BASE = {
  JSXElement(node, state, c) {
    c(node.openingElement, state);
    for (const child of node.children) c(child, state);
    if (node.closingElement) c(node.closingElement, state);
  },
  JSXFragment(node, state, c) {
    for (const child of node.children) c(child, state);
  },
  JSXOpeningElement(node, state, c) {
    c(node.name, state);
    for (const attr of node.attributes) c(attr, state);
  },
  JSXClosingElement(node, state, c) { c(node.name, state); },
  JSXAttribute(node, state, c) { if (node.value) c(node.value, state); },
  JSXSpreadAttribute(node, state, c) { c(node.argument, state, 'Expression'); },
  JSXExpressionContainer(node, state, c) { c(node.expression, state, 'Expression'); },
  JSXSpreadChild(node, state, c) { c(node.expression, state, 'Expression'); },
  JSXMemberExpression(node, state, c) { c(node.object, state); },
  JSXNamespacedName() {},
  JSXIdentifier() {},
  JSXText() {},
  JSXEmptyExpression() {},
  JSXOpeningFragment() {},
  JSXClosingFragment() {},
};

/**
 * Import and export specifiers, which `acorn-walk` ignores outright.
 *
 * Its base defines `ImportSpecifier` as `ignore`, so the name in
 * `import { InputBar } from …` is never visited — and "who imports this?" is
 * the first question anyone asks a reference search. Without these, the answer
 * for a UI component is the one JSX tag and nothing else.
 *
 * Both halves of `import { X as Y }` are visited: searching for `X` should find
 * the import, and searching for `Y` should find the uses. For the plain
 * `import { X }` form acorn gives the two the same position, which is why the
 * caller dedupes by line and column.
 */
const MODULE_BASE = {
  ImportSpecifier(node, state, c) {
    if (node.imported) c(node.imported, state, 'Expression');
    if (node.local && node.local !== node.imported) c(node.local, state, 'Expression');
  },
  ImportDefaultSpecifier(node, state, c) { if (node.local) c(node.local, state, 'Expression'); },
  ImportNamespaceSpecifier(node, state, c) { if (node.local) c(node.local, state, 'Expression'); },
  ExportSpecifier(node, state, c) {
    if (node.local) c(node.local, state, 'Expression');
    if (node.exported && node.exported !== node.local) c(node.exported, state, 'Expression');
  },
};

/*
 * `acorn-walk`'s defaults plus the JSX and module ones are `WALK_BASE`, built in
 * `loadJsParser`. It is handed out because it is the only correct way to walk
 * *this* project's sources, and anything else that walks them needs the same
 * two corrections — a test that scans for calls to undefined names hit the
 * identical JSXElement throw within a minute of being written. One
 * definition, so the next walker does not rediscover both traps.
 */

/**
 * Every definition in one source text.
 *
 * `walk.full` rather than a loop over `ast.body` — that is the whole difference
 * between this and the file it replaces. A method on a class, a function
 * assigned to a const, a function in an object literal: all are definitions
 * somebody will search for, and none of them is a top-level statement.
 *
 * @returns {Array<{name: string, kind: string, line: number}>}
 */
export function definitionsIn(source) {
  const { Parser, walk, WALK_BASE: BASE } = parser();
  const ast = Parser.parse(source, PARSE_OPTIONS);
  const out = [];
  const add = (name, kind, node) => {
    if (name) out.push({ name, kind, line: node.loc.start.line });
  };

  walk.full(ast, (node) => {
    switch (node.type) {
      case 'ClassDeclaration':
      case 'ClassExpression':
        add(node.id?.name, 'class', node);
        break;
      case 'FunctionDeclaration':
        add(node.id?.name, 'function', node);
        break;
      case 'MethodDefinition':
      case 'PropertyDefinition':
        // Not constructors. Every class has one, so indexing them means
        // `find_symbol("constructor")` answers with the whole codebase — and
        // nobody searches for a constructor by that name; they search for the
        // class. `kind` otherwise distinguishes a getter from a plain method,
        // which is worth keeping: they are different things to find.
        if (node.kind !== 'constructor') {
          add(node.key?.name, node.kind && node.kind !== 'init' ? node.kind : 'method', node);
        }
        break;
      case 'Property':
        // Only when the value is callable. `{ retries: 3 }` is data, and
        // indexing it makes every config key a "definition".
        if (/FunctionExpression|ArrowFunctionExpression|ClassExpression/.test(node.value?.type || '')) {
          add(node.key?.name, 'method', node);
        }
        break;
      case 'VariableDeclarator':
        if (/FunctionExpression|ArrowFunctionExpression|ClassExpression/.test(node.init?.type || '')) {
          add(node.id?.name, node.init.type === 'ClassExpression' ? 'class' : 'function', node);
        } else if (node.id?.type === 'Identifier' && node.init) {
          add(node.id.name, 'const', node);
        }
        break;
      default:
        break;
    }
  }, BASE);

  return out;
}

/**
 * Every place a name is *used* in one source text.
 *
 * Identifier nodes, which is what separates this from grep: the word inside a
 * comment or a string is not an Identifier and never appears here. Property
 * keys are excluded for the same reason — `{ readFile: 1 }` is not a use of
 * `readFile` — except when computed, where they genuinely are.
 *
 * **`includeMembers` is the answer to a different question, and the caller has
 * to say which one it is asking.** Excluding `obj.name` is right for a
 * *binding*: `fs.readFile` does not use a `readFile` variable. It is wrong for
 * a *method*, where `x.buildToolResultBatch()` is the only way to call it —
 * and that made `find_references` return **0** for every method in the repo,
 * under a message reading "It may be dead code". Measured before the fix:
 * `buildToolResultBatch` 0 references against 2 real call sites, `acceptDiff`
 * 0 against 3. A tool that confidently answers "nothing calls this" about a
 * method called everywhere is the `semantic_search` failure exactly — the
 * model reaches for it and concludes the code is not there, and here the next
 * step it invites is deletion.
 *
 * Hits found that way are tagged `member: true` rather than mixed in, because
 * they carry real ambiguity: a same-named method on some other object looks
 * identical. Saying which is which is what lets the answer be used.
 *
 * @param {string} source
 * @param {string} name
 * @param {{includeMembers?: boolean}} [options]
 * @returns {Array<{line: number, column: number, member?: boolean}>}
 */
export function referencesIn(source, name, { includeMembers = false } = {}) {
  const { Parser, walk, WALK_BASE: BASE } = parser();
  const ast = Parser.parse(source, PARSE_OPTIONS);
  const out = [];
  // `import { X }` gives `imported` and `local` the same position, and visiting
  // both is how the import is found at all — so the duplicate is deduped here
  // rather than by not looking.
  const seen = new Set();
  const hit = (node, member = false) => {
    const at = `${node.loc.start.line}:${node.loc.start.column}`;
    if (seen.has(at)) return;
    seen.add(at);
    out.push({ line: node.loc.start.line, column: node.loc.start.column + 1, ...(member ? { member: true } : {}) });
  };

  walk.full(ast, (node) => {
    if (node.name !== name) return;
    // `<Banner />` is a use of `Banner` as surely as `Banner()` is, and it is
    // the *only* use in most of `frontend/components`. It is a JSXIdentifier, not an
    // Identifier, so a check for one node type misses every component.
    if (node.type === 'Identifier' || node.type === 'JSXIdentifier') hit(node);
  }, {
    ...BASE,
    // A member's property and a non-computed key are not references to a
    // variable of that name: `fs.readFile` does not use a `readFile` binding,
    // and `{ readFile: 1 }` declares a key.
    MemberExpression(node, state, c) {
      c(node.object, state, 'Expression');
      if (node.computed) c(node.property, state, 'Expression');
      // `x.name` — a use of the *method* `name`, not of a binding called
      // `name`. Only when the caller asked, and never for a computed property,
      // which the line above already visited as an ordinary expression.
      else if (includeMembers && node.property?.name === name) hit(node.property, true);
    },
    Property(node, state, c) {
      if (node.computed) c(node.key, state, 'Expression');
      c(node.value, state, 'Expression');
    },
    MethodDefinition(node, state, c) {
      if (node.computed) c(node.key, state, 'Expression');
      c(node.value, state, 'Expression');
    },
    // An attribute *name* is not a reference; its value can be.
    JSXAttribute(node, state, c) { if (node.value) c(node.value, state); },
  });
  return out;
}

/**
 * A symbol index over a workspace, rebuilt only where files have changed.
 *
 * Built on first use rather than at startup. `semantic_search` was deleted in
 * part for costing a full-repo read every time the agent launched, and a symbol
 * index that nobody asks for should cost nothing.
 */
export class SymbolIndex {
  constructor(workspace) {
    this.workspace = workspace;
    /** @type {Map<string, {mtime: number, defs: Array, source: string}>} */
    this.files = new Map();
    /** @type {Array<{file: string, reason: string}>} */
    this.skipped = [];
  }

  /** Every file worth parsing, plus the code-like ones we cannot. */
  _candidates() {
    // v6.21: every language in `pattern-symbols.js`'s table, not a fixed list.
    const exts = ['js', 'jsx', 'mjs', 'cjs', 'rb', 'rake', ...PATTERN_EXTS.map((e) => e.slice(1))];
    const entries = fg.sync([`**/*.{${exts.join(',')}}`], {
      cwd: this.workspace,
      // `node_modules/**` matches only the top level, and this is a workspaces
      // repo — `server/node_modules` and `extension/node_modules` were being
      // parsed, which is where 343 of the first run's 343 skips came from.
      //
      // `service-worker.js` is a committed *build artifact*: every symbol in it
      // is a duplicate of one in `extension/src/background/`, and answering
      // "where is pickMainTab defined" with the bundle as well as the source is
      // two answers to a question with one.
      ignore: [
        '**/node_modules/**', '**/.git/**', `**/${AGENT_DIR}/**`,
        '**/dist/**', '**/build/**', '**/*.min.js',
        // Bundler's installed gems: a Rails app vendors thousands of them.
        '**/vendor/bundle/**',
        // And every other ecosystem's installed or built copies (v6.21).
        '**/vendor/**', '**/.venv/**', '**/venv/**', '**/site-packages/**', '**/__pycache__/**',
        '**/target/**', '**/Pods/**', '**/.gradle/**', '**/.next/**', '**/*.d.ts',
        'extension/service-worker.js',
      ],
      absolute: true,
      suppressErrors: true,
    });
    return entries;
  }

  /**
   * Parse what has changed since last time.
   *
   * An unparseable file is recorded and skipped, never thrown: one file with a
   * syntax error in it must not make the whole index unavailable — that is the
   * state where the model is told nothing exists.
   */
  refresh() {
    const seen = new Set();
    this.skipped = [];

    for (const abs of this._candidates()) {
      const ext = extname(abs);
      const rel = relative(this.workspace, abs);
      seen.add(abs);

      const ruby = RUBY.has(ext);
      const lang = !ruby && !PARSEABLE.has(ext) ? languageFor(ext) : null;
      if (!ruby && !lang && !PARSEABLE.has(ext)) continue;
      if (!ruby && !lang && !js) {
        this.skipped.push({ file: rel, reason: 'JavaScript not indexed (acorn is not installed, see /doctor)' });
        continue;
      }

      let mtime;
      let source;
      try {
        mtime = statSync(abs).mtimeMs;
        const cached = this.files.get(abs);
        if (cached && cached.mtime === mtime) continue;
        source = readFileSync(abs, 'utf8');
      } catch (err) {
        this.skipped.push({ file: rel, reason: err.code || 'unreadable' });
        this.files.delete(abs);
        continue;
      }

      if (ruby) {
        const code = rubyCodeLines(source);
        this.files.set(abs, { mtime, defs: rubyDefinitionsIn(source, code), source, code, ruby: true });
        continue;
      }
      if (lang) {
        if (source.length > MAX_PATTERN_BYTES) {
          this.files.delete(abs);
          this.skipped.push({ file: rel, reason: 'over 2 MB (generated?)' });
          continue;
        }
        const code = patternCodeLines(source, lang);
        this.files.set(abs, { mtime, defs: patternDefinitionsIn(source, lang, code), source, code, lang });
        continue;
      }
      try {
        this.files.set(abs, { mtime, defs: definitionsIn(source), source });
      } catch (err) {
        this.files.set(abs, { mtime, defs: [], source, unparsed: true });
        this.skipped.push({ file: rel, reason: `syntax error at line ${err.loc?.line ?? '?'}` });
      }
    }

    // Files that have been deleted since the last pass.
    for (const abs of [...this.files.keys()]) {
      if (!seen.has(abs)) this.files.delete(abs);
    }
    return this;
  }

  /** How many files are actually in the index, for the honest footer. */
  get indexed() {
    return [...this.files.values()].filter((f) => !f.unparsed).length;
  }

  /** How many of those are Ruby, read by pattern rather than parsed. */
  get rubyFiles() {
    return [...this.files.values()].filter((f) => f.ruby).length;
  }

  /** How many are read from the language table (v6.21). */
  get patternFiles() {
    return [...this.files.values()].filter((f) => f.lang).length;
  }

  /**
   * Where `name` is defined.
   *
   * @returns {Array<{file: string, line: number, kind: string}>}
   */
  find(name) {
    // `Billing::Invoice` is indexed as `Invoice`; asking with the namespace
    // finds it. JavaScript names never contain `::`.
    const want = name.includes('::') ? name.split('::').pop() : name;
    const out = [];
    for (const [abs, entry] of this.files) {
      for (const def of entry.defs) {
        if (def.name === want) {
          out.push({ file: relative(this.workspace, abs), line: def.line, kind: def.kind });
        }
      }
    }
    return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  }

  /**
   * One line of an indexed file, by its workspace-relative path.
   *
   * `find` returns a definition's file and line but not its text, and a
   * definition the caller has to go and read separately is one it will render
   * as a bare line number.
   *
   * @returns {string} the trimmed line, or '' if it is not indexed
   */
  sourceLine(relFile, line) {
    for (const [abs, entry] of this.files) {
      if (relative(this.workspace, abs) !== relFile) continue;
      return (entry.source.split('\n')[line - 1] || '').trim();
    }
    return '';
  }

  /**
   * Where `name` is used, with the line of source at each point.
   *
   * `includeMembers` adds `x.name` uses, tagged `member: true` — see
   * `referencesIn`. Off by default because for a plain binding they are noise;
   * on, for a method, they are the whole answer.
   *
   * @returns {Array<{file: string, line: number, column: number, text: string, member?: boolean}>}
   */
  references(name, { includeMembers = false } = {}) {
    const out = [];
    for (const [abs, entry] of this.files) {
      if (entry.unparsed) continue;
      // Cheap reject: parsing every file again to find a name that is not in it
      // is the difference between this being usable and not.
      if (!entry.source.includes(name)) continue;
      let hits;
      try {
        // Ruby is a word match on its code lines (`ruby-symbols.js`), which
        // already includes `x.name`: in Ruby that is how a method is called.
        hits = entry.ruby ? rubyReferencesIn(entry.code, name)
          : entry.lang ? patternReferencesIn(entry.code, name, entry.lang,
            new Set(entry.defs.filter((d) => d.name === name).map((d) => d.line)))
          : referencesIn(entry.source, name, { includeMembers });
      } catch {
        continue;
      }
      const lines = entry.source.split('\n');
      for (const hit of hits) {
        out.push({
          file: relative(this.workspace, abs),
          line: hit.line,
          column: hit.column,
          text: (lines[hit.line - 1] || '').trim(),
          ...(hit.member ? { member: true } : {}),
        });
      }
    }
    return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  }
}

/** One index per workspace, kept between calls so the parse is paid once. */
const indexes = new Map();

/**
 * The index for a workspace, refreshed. Async because the JavaScript parser is
 * loaded on the first call; if it cannot be, JavaScript files are listed as
 * skipped with the reason and Ruby is still indexed.
 */
export async function symbolIndex(workspace) {
  try { await loadJsParser(); } catch { /* reported per file by refresh() */ }
  if (!indexes.has(workspace)) indexes.set(workspace, new SymbolIndex(workspace));
  return indexes.get(workspace).refresh();
}
