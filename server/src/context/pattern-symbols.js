/**
 * Every other language, from one table (v6.21).
 *
 * Asked 2026-10-30, after Ruby: *"can't we make it generic?"* JavaScript is
 * parsed (acorn) and Ruby has its own scanner (`ruby-symbols.js`); every other
 * language was "skipped: acorn cannot parse .py", so `find_symbol` answered
 * "not found" for a whole codebase and the model fell back to `grep_search`,
 * which cannot tell a definition from a call.
 *
 * A language here is a row: how it writes comments and strings, and what a
 * definition line looks like. One scanner blanks comments and string contents
 * (keeping interpolations, which are code, and line and column positions), and
 * the definitions and references are found on what is left. That is the whole
 * of what `find_symbol` and `find_references` need, and it is the same idea as
 * the Ruby scanner, measured the same way: against each language's own lexer
 * and parser where the machine has one (Python's `tokenize`/`ast`, Go's
 * `go/scanner`/`go/ast`, TypeScript's compiler). See CLAUDE.md for the numbers.
 *
 * What a table cannot do, and the answer says so: a name made at run time, a
 * macro, or `x.name` on an unrelated object. Those are the same limits Ruby
 * has, and the note that rides on an answer says them.
 */

/** A literal still open at the end of a line may run on this far; past it, the start was misread. */
const CARRY_MAX = 400;

const C_COMMENTS = { line: ['//'], block: [['/*', '*/']] };
const DQ = { open: '"', close: '"' };
const SQ = { open: "'", close: "'" };
const CHAR = { open: "'", close: "'", char: true }; // a character literal, never a lifetime or a quote
const BACKTICK_RAW = { open: '`', close: '`', multi: true, raw: true };
const TEMPLATE = { open: '`', close: '`', multi: true, interp: ['${', '}'] };
const TRIPLE_DQ = { open: '"""', close: '"""', multi: true };

/** `[regex, kind]`; group 1 is the name. Tried in order on each code line, first match wins. */
const W = '[A-Za-z_$][\\w$]*';
const MODS = '(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|override|virtual|async|export|default|declare|readonly|inline|suspend|extern|unsafe|const|pub(?:\\([^)]*\\))?|partial|data|enum|value|inner|lateinit|tailrec|operator|infix|external|actual|expect|mutating|nonmutating|fileprivate|required|convenience|dynamic|lazy|weak|unowned|indirect|implicit|lazy|case|sealed|transient|synchronized|native|strictfp|new|unsafe|extern|fun)\\s+)*';
const NOT_CALL = /^(?:if|for|while|switch|catch|synchronized|try|return|elif|else|when|match|with|foreach|using|lock|sizeof|typeof|new|throw|await|yield|function|do|in|is|as)$/;
// TypeScript members may be called `with`, `is`, `match` or `throw` (lib.es5.d.ts has all four);
// the statement forms are kept out by the shape check instead.
/** Java's: `await`, `yield`, `in` and friends are ordinary method names there. */
const NOT_CALL_JAVA = /^(?:if|for|while|switch|catch|synchronized|try|return|else|new|throw|do|super|this)$/;
const NOT_CALL_TS = /^(?:if|for|while|switch|catch|return|else|function|do|super|new)$/;

export const LANGUAGES = [
  {
    name: 'Python',
    exts: ['.py', '.pyi'],
    line: ['#'],
    block: [],
    strings: [
      // An f-string's `{…}` is code; `{{` is a brace.
      { open: '"""', close: '"""', multi: true, prefix: true },
      { open: "'''", close: "'''", multi: true, prefix: true },
      { open: '"', close: '"', prefix: true },
      { open: "'", close: "'", prefix: true },
    ],
    defs: [
      [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, (m, line) => (/^\s/.test(line) ? 'method' : 'function')],
      [/^\s*class\s+([A-Za-z_]\w*)/, 'class'],
      [/^([A-Z_][A-Z0-9_]*)\s*(?::[^=]*)?=(?!=)/, 'const'],
    ],
  },
  {
    name: 'Go',
    exts: ['.go'],
    ...C_COMMENTS,
    strings: [DQ, CHAR, BACKTICK_RAW],
    defs: [
      [/^func\s+\([^)]*\)\s*([A-Za-z_]\w*)/, 'method'],
      [/^func\s+([A-Za-z_]\w*)/, 'function'],
      [/^type\s+([A-Za-z_]\w*)/, 'type'],
      [/^(?:var|const)\s+([A-Za-z_]\w*)/, (m, line) => (line.startsWith('var') ? 'var' : 'const')],
    ],
    // `type (`, `const (` and `var (` blocks: each line inside declares a name.
    blocks: { open: /^(type|const|var)\s*\($/, close: /^\)/, def: /^\t([A-Za-z_]\w*)\b(?!\s*[.(])/ },
  },
  {
    name: 'TypeScript',
    exts: ['.ts', '.tsx', '.mts', '.cts'],
    cLike: true,
    // A member named like one of these (`any`, `type`, `with`) is that member
    // only after `.` or where it is defined; bare, it is the keyword.
    keywords: 'any as asserts async await bigint boolean break case catch class const continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of out override private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield',
    ...C_COMMENTS,
    strings: [DQ, SQ, TEMPLATE],
    regex: true,
    defs: [
      [new RegExp(`^\\s*${MODS}function\\s*\\*?\\s*(${W})`), 'function'],
      [new RegExp(`^\\s*${MODS}(?:class|interface|enum|namespace|module)\\s+(${W})`), (m) => /\b(class|interface|enum|namespace|module)\s/.exec(m[0])[1]],
      [new RegExp(`^\\s*${MODS}type\\s+(${W})\\s*(?:<[^=]*>)?\\s*=`), 'type'],
      // Top level only, as for JavaScript: a local is not what "where is X defined" asks about.
      [new RegExp(`^${MODS}(?:const|let|var)\\s+(${W})`), 'const'],
      // A member: `name(`, `name<T>(`, `get name(`, `name?(` at the start of an indented line.
      [new RegExp(`^\\s+${MODS}(?:get\\s+|set\\s+|\\*\\s*)?(${W})\\??\\s*(?:<[^>]*>)?\\s*\\(`), 'method', NOT_CALL_TS],
    ],
  },
  {
    name: 'Java',
    cLike: true,
    abstractDecls: true,
    exts: ['.java'],
    ...C_COMMENTS,
    strings: [TRIPLE_DQ, DQ, CHAR],
    defs: [
      [new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*${MODS}(?:class|interface|enum|record|@interface)\\s+(${W})`), 'class'],
      // `Type name(` — a return type, then the name and its parameters.
      [new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*${MODS}(?:<[^>]+>\\s+)?[\\w$][\\w$.<>\\[\\],? ]*?\\s+(${W})\\s*\\(`), 'method', NOT_CALL_JAVA],
      // A package-private constructor has neither: `Name(args) {`, never ending in `;`.
      [/^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:<[^>]+>\s+)?([A-Z][\w$]*)\s*\((?!.*\)\s*;\s*$)/, 'method', NOT_CALL_JAVA],
    ],
  },
  {
    name: 'C#',
    cLike: true,
    abstractDecls: true,
    exts: ['.cs'],
    ...C_COMMENTS,
    strings: [{ open: '@"', close: '"', multi: true, raw: true }, { open: '$"', close: '"', interp: ['{', '}'] }, DQ, CHAR],
    defs: [
      [new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*${MODS}(?:class|interface|enum|struct|record)\\s+(${W})`), 'class'],
      [new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*${MODS}\\w[\\w.<>\\[\\],? ]*?\\s+(${W})\\s*(?:<[^>]*>)?\\s*\\(`), 'method', NOT_CALL],
      // A property: an access modifier, a type, a name, then an accessor or `=>`.
      [new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*(?:public|private|protected|internal)\\s+(?:\\w+\\s+)*?[\\w.<>\\[\\],?]+\\s+(${W})\\s*(?:\\{\\s*(?:get|set|init)\\b|=>)`), 'property'],
    ],
  },
  {
    name: 'Kotlin',
    cLike: true,
    exts: ['.kt', '.kts'],
    ...C_COMMENTS,
    strings: [{ ...TRIPLE_DQ, interp: ['${', '}'] }, { ...DQ, interp: ['${', '}'] }, CHAR],
    defs: [
      [new RegExp(`^\\s*${MODS}fun\\s+(?:<[^>]*>\\s*)?(?:[\\w.<>]+\\.)?(${W})`), 'function'],
      [new RegExp(`^\\s*${MODS}(?:class|interface|object)\\s+(${W})`), 'class'],
      [new RegExp(`^\\s*${MODS}(?:val|var)\\s+(${W})`), 'property'],
      [new RegExp(`^\\s*${MODS}typealias\\s+(${W})`), 'type'],
    ],
  },
  {
    name: 'Swift',
    cLike: true,
    exts: ['.swift'],
    ...C_COMMENTS,
    strings: [TRIPLE_DQ, { ...DQ, interp: ['\\(', ')'] }],
    defs: [
      [new RegExp(`^\\s*(?:@\\w+\\s+)*${MODS}func\\s+(${W})`), 'function'],
      [new RegExp(`^\\s*(?:@\\w+\\s+)*${MODS}(?:class|struct|enum|protocol|extension|actor)\\s+(${W})`), 'class'],
      [new RegExp(`^\\s*(?:@\\w+\\s+)*${MODS}typealias\\s+(${W})`), 'type'],
    ],
  },
  {
    name: 'Scala',
    cLike: true,
    exts: ['.scala', '.sc'],
    ...C_COMMENTS,
    strings: [TRIPLE_DQ, DQ, CHAR],
    defs: [
      [new RegExp(`^\\s*${MODS}def\\s+(${W})`), 'method'],
      [new RegExp(`^\\s*${MODS}(?:class|trait|object|enum)\\s+(${W})`), 'class'],
      [new RegExp(`^\\s*${MODS}(?:val|var|type)\\s+(${W})`), 'value'],
    ],
  },
  {
    name: 'Rust',
    cLike: true,
    exts: ['.rs'],
    ...C_COMMENTS,
    strings: [{ open: 'r#"', close: '"#', multi: true, raw: true }, { open: 'r"', close: '"', multi: true, raw: true }, { ...DQ, multi: true }, CHAR],
    defs: [
      [new RegExp(`^\\s*${MODS}fn\\s+(${W})`), 'function'],
      [new RegExp(`^\\s*${MODS}(?:struct|enum|trait|union|type|mod)\\s+(${W})`), 'type'],
      [new RegExp(`^\\s*${MODS}(?:const|static)\\s+(?:mut\\s+)?(${W})\\s*:`), 'const'],
      [/^\s*macro_rules!\s*([A-Za-z_]\w*)/, 'macro'],
    ],
  },
  {
    name: 'PHP',
    cLike: true,
    exts: ['.php'],
    line: ['//', '#'],
    block: [['/*', '*/']],
    strings: [{ ...DQ, multi: true }, { ...SQ, multi: true }],
    defs: [
      [/^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?\s*([A-Za-z_]\w*)/, 'function'],
      [/^\s*(?:(?:final|abstract|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/, 'class'],
      [/^\s*(?:(?:public|private|protected)\s+)?const\s+([A-Za-z_]\w*)/, 'const'],
    ],
  },
  {
    name: 'C/C++',
    cLike: true,
    exts: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.m', '.mm'],
    ...C_COMMENTS,
    strings: [{ open: 'R"(', close: ')"', multi: true, raw: true }, DQ, CHAR],
    defs: [
      [/^\s*#\s*define\s+([A-Za-z_]\w*)/, 'macro'],
      [/^\s*(?:typedef\s+)?(?:class|struct|enum(?:\s+class)?|union|namespace)\s+([A-Za-z_]\w*)\s*(?:[:{]|$)/, 'type'],
      [/^\s*typedef\b.*?\b([A-Za-z_]\w*)\s*;\s*$/, 'type'],
      // A function definition starts at column 0: a type, the name, its parameters, and no `;`.
      [/^(?!\s)(?:[\w:*&<>,]+\s+)*?[*&]*\s*(?:[A-Za-z_]\w*::)*~?([A-Za-z_]\w*)\s*\([^;]*$/, 'function', NOT_CALL],
    ],
  },
  {
    name: 'Elixir',
    exts: ['.ex', '.exs'],
    line: ['#'],
    block: [],
    strings: [{ ...TRIPLE_DQ, interp: ['#{', '}'] }, { ...DQ, interp: ['#{', '}'] }],
    defs: [
      [/^\s*(?:def|defp|defmacro|defmacrop|defguard|defdelegate)\s+([a-z_]\w*[?!]?)/, 'function'],
      [/^\s*(?:defmodule|defprotocol)\s+([A-Z][\w.]*)/, 'module'],
    ],
  },
  {
    name: 'Lua',
    exts: ['.lua'],
    line: ['--'],
    block: [['--[[', ']]']],
    strings: [DQ, SQ, { open: '[[', close: ']]', multi: true, raw: true }],
    defs: [
      [/^\s*(?:local\s+)?function\s+(?:[\w.]+[.:])?([A-Za-z_]\w*)/, 'function'],
    ],
  },
  {
    name: 'Shell',
    exts: ['.sh', '.bash', '.zsh'],
    line: ['#'],
    block: [],
    strings: [DQ, SQ],
    defs: [
      [/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\s*\)/, 'function'],
      [/^\s*function\s+([A-Za-z_][\w-]*)/, 'function'],
    ],
  },
];

// Block comments in Lua start with `--`, so they are tried before line comments.
for (const lang of LANGUAGES) {
  lang.strings.sort((a, b) => b.open.length - a.open.length);
}

const BY_EXT = new Map(LANGUAGES.flatMap((l) => l.exts.map((e) => [e, l])));

/** The language row for an extension, or null. */
export function languageFor(ext) {
  return BY_EXT.get(String(ext).toLowerCase()) || null;
}

/** Every extension the table covers, for the file search. */
export const PATTERN_EXTS = [...BY_EXT.keys()];

const startsAt = (line, i, tok) => line.startsWith(tok, i);
const REGEX_BEFORE = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw))\s*$/;

/** Where the regex starting at `i` closes (its final `/`), or -1: classes may hold a `/`. */
function regexEnd(line, i) {
  let inClass = false;
  for (let j = i + 1; j < line.length; j++) {
    const ch = line[j];
    if (ch === '\\') { j++; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) return j;
  }
  return -1;
}
const CHAR_LITERAL = /^'(?:\\(?:x[0-9a-fA-F]{1,2}|u\{?[0-9a-fA-F]{1,6}\}?|.)|[^\\'\n])'/u;
const PY_PREFIX = /(?:^|[^\w])([rRbBuUfF]{1,2})$/;

/**
 * Every line as code: comments blanked to spaces, string contents blanked
 * (their quotes and any interpolation kept). Line numbers and columns are
 * unchanged, so a hit points at the source.
 *
 * @returns {string[]}
 */
export function patternCodeLines(source, lang) {
  const lines = source.split('\n');
  const out = new Array(lines.length);
  const stack = []; // open literals ({lit, interp}) and interpolation frames ({code, depth})
  let blockEnd = null; // the close of a block comment we are inside
  let openFor = 0;

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    let o = '';
    let i = 0;
    while (i < line.length) {
      if (blockEnd) {
        const end = line.indexOf(blockEnd, i);
        if (end === -1) { o += ' '.repeat(line.length - i); i = line.length; break; }
        o += ' '.repeat(end + blockEnd.length - i);
        i = end + blockEnd.length;
        blockEnd = null;
        continue;
      }
      const top = stack[stack.length - 1];
      if (top && !top.code) {
        const { lit } = top;
        if (!lit.raw && line[i] === '\\') { o += line[i + 1] === undefined ? ' ' : '  '; i += 2; continue; }
        if (top.interp && startsAt(line, i, top.interp[0]) && !(lit.prefix && line[i + 1] === '{')) {
          stack.push({ code: true, depth: 0, close: top.interp[1], open: top.interp[0].slice(-1) });
          o += top.interp[0];
          i += top.interp[0].length;
          continue;
        }
        if (top.interp && lit.prefix && line[i] === '{' && line[i + 1] === '{') { o += '  '; i += 2; continue; }
        if (startsAt(line, i, lit.close)) {
          stack.pop();
          o += lit.close;
          i += lit.close.length;
          continue;
        }
        o += ' ';
        i++;
        continue;
      }
      // Code, at the top level or inside an interpolation.
      if (top?.code) {
        if (line[i] === top.open) top.depth++;
        else if (startsAt(line, i, top.close)) {
          if (top.depth === 0) { stack.pop(); o += top.close; i += top.close.length; continue; }
          top.depth--;
        }
      }
      const block = lang.block.find(([b]) => startsAt(line, i, b));
      if (block) { blockEnd = block[1]; o += ' '.repeat(block[0].length); i += block[0].length; continue; }
      if (lang.line.some((c) => startsAt(line, i, c))) break;
      // `/…/` after an operator or keyword is a regex: blank it, or a quote in
      // it opens a string that eats the rest of the line.
      if (lang.regex && line[i] === '/' && REGEX_BEFORE.test(o)) {
        const end = regexEnd(line, i);
        if (end > i) { o += `/${' '.repeat(end - i - 1)}/`; i = end + 1; continue; }
      }
      const lit = lang.strings.find((s) => startsAt(line, i, s.open));
      if (lit && !(lit.char && !CHAR_LITERAL.test(line.slice(i)))) {
        let interp = lit.interp || null;
        if (lit.prefix) {
          // Python: a prefix with `f` makes `{…}` code; `r` makes backslashes plain.
          const p = PY_PREFIX.exec(o);
          const flags = p ? p[1].toLowerCase() : '';
          interp = flags.includes('f') ? ['{', '}'] : null;
          stack.push({ lit: { ...lit, raw: flags.includes('r') }, interp });
        } else {
          stack.push({ lit, interp });
        }
        o += lit.open;
        i += lit.open.length;
        continue;
      }
      o += line[i];
      i++;
    }
    out[n] = o;
    // A single-line literal still open at the end of its line closes there:
    // that is a misread, and it must not blank the next line.
    while (stack.length && !stack[stack.length - 1].code && !stack[stack.length - 1].lit.multi) stack.pop();
    if (stack.length) {
      if (++openFor > CARRY_MAX) { stack.length = 0; openFor = 0; }
    } else openFor = 0;
  }
  return out;
}

/**
 * Every definition, in the shape `definitionsIn` returns for JavaScript.
 *
 * @returns {Array<{name: string, kind: string, line: number}>}
 */
export function patternDefinitionsIn(source, lang, code = patternCodeLines(source, lang)) {
  const out = [];
  let block = null;
  code.forEach((text, i) => {
    if (!text.trim()) return;
    if (lang.blocks) {
      if (block) {
        if (lang.blocks.close.test(text)) { block = null; return; }
        const m = lang.blocks.def.exec(text);
        if (m && m[1] !== '_') out.push({ name: m[1], kind: block, line: i + 1 });
        return;
      }
      const open = lang.blocks.open.exec(text.trimEnd());
      if (open) { block = open[1]; return; }
    }
    for (const [re, kind, reject] of lang.defs) {
      const m = re.exec(text);
      if (!m || (reject && reject.test(m[1]))) continue;
      if (lang.name === 'Go' && m[1] === '_') return;
      if (lang.cLike && reject && !definitionShape(text, m, code.slice(i + 1, i + 31), lang)) continue;
      out.push({ name: m[1], kind: typeof kind === 'function' ? kind(m, text) : kind, line: i + 1 });
      return;
    }
  });
  return out;
}

/**
 * Whether a `name(` line declares rather than calls. Inside a body, `doThing(x);`
 * and `return make(x);` look like a member at the start of a line; a
 * declaration's parameters are followed by a body, a return type, `throws`,
 * `where` or nothing (they continue on the next line), and a call's by `;`,
 * `,`, `.` or an operator.
 */
function definitionShape(text, m, rest = [], lang = null) {
  const before = text.slice(0, m.index + m[0].lastIndexOf(m[1]));
  // `return make(`, `x = make(`, `foo(bar(`: the name is a call inside an expression.
  if (/(?:^|[^\w$])(?:return|new|throw|await|yield|else|case)\s+$/.test(before)) return false;
  // `void`, `delete` and `typeof` are operators only in TypeScript; in Java,
  // C# and C++ `void` is the commonest return type there is.
  if (lang?.regex && /(?:^|[^\w$])(?:delete|typeof|void)\s+$/.test(before)) return false;
  if (/[=(,!?&|+%]\s*$/.test(before)) return false;
  const open = text.indexOf('(', m.index + m[0].lastIndexOf(m[1]));
  // Parameters may run onto the next lines; follow them until they close.
  const joined = [text, ...rest.slice(0, 30)].join('\n');
  let depth = 0;
  for (let i = open; i < joined.length; i++) {
    if (joined[i] === '(') depth++;
    else if (joined[i] === ')' && --depth === 0) {
      const after = joined.slice(i + 1).split('\n', 1)[0].trim();
      return after === '' || /^(?:\{|:|throws\b|where\b|->|=>\s*\{?\s*$|const\b|override\b|noexcept\b|final\b|=\s*(?:0|default|delete)\s*;)/.test(after)
        || (after === ';' && /^\s*(?:(?:public|private|protected|static|abstract|declare|readonly|async|override)\s+)+/.test(text))
        // An interface method: in Java and C#, `Type name(...);` cannot be a statement.
        || (/^;/.test(after) && lang?.abstractDecls);
    }
  }
  return false; // never closed: not a declaration we can vouch for
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keywordSets = new Map();
const keywordsOf = (lang) => {
  if (!keywordSets.has(lang)) keywordSets.set(lang, new Set((lang?.keywords || '').split(' ').filter(Boolean)));
  return keywordSets.get(lang);
};

/**
 * Every place `name` appears as a word in the code — calls, `x.name`, types,
 * imports. A name that is also one of the language's keywords counts only
 * after `.` and on the lines that define it.
 */
export function patternReferencesIn(code, name, lang = null, defLines = null) {
  const keyword = keywordsOf(lang).has(name);
  // A keyword-named member: after `.`, or as a property key (`type: string`, `type?: string`).
  const re = keyword
    ? new RegExp(`(?<=[.]\\s*)${escape(name)}(?![\\w$])|(?<![\\w$.])${escape(name)}(?=\\??\\s*:(?!:))`, 'g')
    : new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`, 'g');
  const out = [];
  code.forEach((text, i) => {
    if (!text.includes(name)) return;
    if (keyword && defLines?.has(i + 1)) {
      const at = new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`).exec(text);
      if (at) out.push({ line: i + 1, column: at.index + 1 });
      return;
    }
    for (const m of text.matchAll(re)) out.push({ line: i + 1, column: m.index + 1 });
  });
  return out;
}

/** Said beside any answer that includes these languages. */
export const PATTERN_NOTE = 'Languages other than JavaScript are matched by patterns, not parsed: a name made at '
  + 'run time or by a macro is not found, names inside strings and comments are not counted, and x.name '
  + 'matches any object\'s name. Use grep_search for those.';
