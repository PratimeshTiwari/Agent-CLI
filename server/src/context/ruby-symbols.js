/**
 * Ruby for find_symbol and find_references, by line patterns (v6.8).
 *
 * Asked 2026-10-28: *"what about other codebases like ruby?"* — the work
 * laptop's codebase is Ruby, and both tools answered "No definition found" for
 * every name in it, with `.rb` listed as skipped. The model then fell back to
 * `grep_search`, which cannot tell a definition from a call.
 *
 * **Why patterns and not a parser.** A Ruby parser in pure JS does not exist
 * worth the name; tree-sitter is a WASM grammar per language and universal
 * ctags is a binary the work laptop cannot install without Homebrew. Ruby's
 * definitions are unusually regular — `def`, `class`, `module`, `attr_*`,
 * `alias_method` all start a line — so a line pattern finds nearly all of them,
 * with no dependency.
 *
 * **What it cannot see, and says so.** Methods made at run time
 * (`define_method` with a computed name, `method_missing`, Rails associations
 * and column attributes) have no line to match, and a reopened class is
 * several definitions of one name. References are word matches on code with
 * comments and string contents blanked, not a parse, so a same-named method on
 * another object counts too. The tool result carries a note to that effect,
 * because the failure that matters is the model concluding a symbol does not
 * exist when the truth is that nothing could look.
 */

/** Files read as Ruby. */
export const RUBY = new Set(['.rb', '.rake']);

/** A character that can start a literal or a comment; a line with none is code as it stands. */
const PLAIN_STOP = /["'`\/%?#$]/;
/** How far an unclosed literal may run on; past it, the start was misread. */
const CARRY_MAX = 40;
const PAIRS = { '(': ')', '[': ']', '{': '}', '<': '>' };
/** `%w[]`, `%i[]`, `%q()` and `%s()` have no `#{}`; the others do. */
const PERCENT_PLAIN = new Set(['q', 'w', 'i', 's']);
// After one of these a `/` or `%` starts a literal rather than dividing.
const VALUE_BEFORE = /(?:^|[(,=!~|&{[;:?+\-*<>^%]|\b(?:if|unless|elsif|when|while|until|and|or|not|return|then|do|case|in|puts|p|yield))\s*$/;

/** A string, regex or `%` literal being read; `close` null means it never closes (a heredoc body). */
const literal = (close, interp, open = null) => ({ close, interp, open, nest: 0 });

/**
 * One line with its comment removed and literal contents blanked to spaces,
 * so columns still line up with the source. `#{…}` is code wherever it may
 * appear (double quotes, backticks, regexes, `%Q` and friends, heredocs), and
 * a string inside it is a string again. A literal still open at the end of
 * the line carries into the next (`carry`), for at most `CARRY_MAX` lines.
 *
 * Measured against Ripper's lexer (v6.19): regex contents, `%w[]` words and
 * strings nested in `#{}` used to count as code, and a `#` in a regex
 * (`/^\s*#{START}/`) ended the line as a comment.
 *
 * @param {string} line
 * @param {object} [start]  a literal the line begins inside, for heredoc bodies
 */
function codeOf(line, start = null, carry = null) {
  const stack = carry || (start ? [start] : []); // literals, and the `#{` depth inside each
  if (!stack.length && !PLAIN_STOP.test(line)) return line; // most lines: nothing to blank
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const top = stack[stack.length - 1];
    if (top && !top.code) {
      if (ch === '\\') { out += i + 1 < line.length ? '  ' : ' '; i++; continue; }
      if (top.interp && ch === '#' && line[i + 1] === '{') {
        stack.push({ code: true, braces: 0 });
        out += '#{';
        i++;
        continue;
      }
      if (top.open && ch === top.open) { top.nest++; out += ' '; continue; }
      if (ch === top.close) {
        if (top.nest > 0) { top.nest--; out += ' '; continue; }
        stack.pop();
        out += ch;
        continue;
      }
      out += ' ';
      continue;
    }
    // Code: at the top level, or inside a `#{ }`.
    if (top?.code) {
      if (ch === '{') top.braces++;
      else if (ch === '}' && top.braces-- === 0) { stack.pop(); out += ch; continue; }
    }
    if (ch === '#') break;
    if (ch === '$' && i + 1 < line.length && /[^\w\s]/.test(line[i + 1])) { out += line.slice(i, i + 2); i++; continue; } // `$'`, `$"`, `$/`
    // `?a`, `?/`, `?\n`: a one-character string. `?/` read as a regex blanked
    // the next forty lines of fileutils.rb.
    const char = ch === '?' && /(?:^|[\s(,=[])$/.test(out.slice(-1)) && /^\?(?:\\.|[^\s\\])(?!\w)/.exec(line.slice(i));
    if (char) {
      out += `?${' '.repeat(char[0].length - 1)}`;
      i += char[0].length - 1;
      continue;
    }
    if (ch === '"' || ch === '`') { stack.push(literal(ch, true)); out += ch; continue; }
    if (ch === "'") { stack.push(literal(ch, false)); out += ch; continue; }
    if (ch === '/' && startsLiteral(out.slice(-24), line[i + 1])) { stack.push(literal('/', true)); out += ch; continue; }
    if (ch === '%') {
      const m = /^%([qQwWiIrsx]?)([^\w\s])/.exec(line.slice(i));
      if (m && (m[1] ? !/\w$/.test(out.slice(-1)) || /\s$/.test(out.slice(-1)) : VALUE_BEFORE.test(out.slice(-24)))) {
        const delim = m[2];
        stack.push(literal(PAIRS[delim] || delim, !PERCENT_PLAIN.has(m[1]), PAIRS[delim] ? delim : null));
        out += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    out += ch;
  }
  if (carry) carry.splice(0, carry.length, ...stack);
  return out;
}

/**
 * Whether a `/` starts a regex, given the code before it. After an operator
 * or keyword it must; after a value it divides; after a name and a space with
 * no space following (`split /,/`) Ruby reads a regex argument, and so do we.
 */
function startsLiteral(before, next) {
  if (VALUE_BEFORE.test(before)) return true;
  return /[a-z_]\w*[?!]?\s+$/.test(before) && next !== undefined && !/[\s=]/.test(next);
}

/**
 * Every line as code: comments, `=begin`/`=end` blocks and heredoc bodies are
 * blank lines, string contents are spaces. Line numbers are unchanged.
 *
 * @returns {string[]}
 */
export function rubyCodeLines(source) {
  const lines = source.split('\n');
  const out = new Array(lines.length);
  let inDoc = false;
  const heredocs = []; // terminators still awaited, in order
  const open = []; // a literal still open at the end of a line
  let openFor = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inDoc) {
      out[i] = '';
      if (/^=end\b/.test(line)) inDoc = false;
      continue;
    }
    if (heredocs.length) {
      const doc = heredocs[0];
      if (line.trim() === doc.end) {
        out[i] = '';
        heredocs.shift();
      } else {
        // A body is a string: blank, but for its `#{}` unless the tag was quoted ('EOS').
        out[i] = doc.interp ? codeOf(line, literal(null, true)) : '';
      }
      continue;
    }
    if (line === '__END__') {
      out.fill('', i); // what follows is data, read by DATA, never run
      break;
    }
    if (/^=begin\b/.test(line)) {
      out[i] = '';
      inDoc = true;
      continue;
    }
    const code = codeOf(line, null, open);
    out[i] = code;
    // An open literal runs on, but never far: a misread start must not blank a file.
    if (open.length && ++openFor > CARRY_MAX) { open.length = 0; openFor = 0; }
    if (!open.length) openFor = 0;
    // `<<~SQL`, `<<-EOS`, `<<EOS`, `<<~'EOS'`. Not `x << y`: a heredoc has no space.
    // Read from the raw line up to where its comment starts: `# puts <<-EOF` in
    // a comment is not a heredoc, and taking it for one blanked the rest of
    // getoptlong.rb (measured against Ripper).
    for (const m of line.slice(0, code.length).matchAll(/<<[~-]?(['"`]?)([A-Z_][A-Za-z0-9_]*)\1/g)) {
      heredocs.push({ end: m[2], interp: m[1] !== "'" });
    }
  }
  return out;
}

const NAME = '[A-Za-z_]\\w*[?!=]?';
// `def ==`, `def []=`, `def <=>`, `def -@`: operators are methods too, and
// without them `def self.[]` was read as a method called `self`.
const OPERATOR = '\\[\\]=?|<=>|===?|=~|!~|[-+!~]@|\\*\\*|<<|>>|<=|>=|!=|[-+*/%<>!~^&|]';
const DEF_NAME = `(?:${NAME}|${OPERATOR})`;
// `private def x`, `protected def x`, `memoize def x` all start with one word.
const MOD = '(?:[a-z_]\\w*\\s+)?';
const DEFINE = [
  // `def self.on`, `def self::on` and `def Tracer.on` are class methods;
  // `def klass.instance` is a singleton method on a local, filed the same way.
  [new RegExp(`^\\s*${MOD}def\\s+[A-Za-z_]\\w*(?:\\.|::)(${DEF_NAME})`), 'class method'],
  [new RegExp(`^\\s*${MOD}def\\s+(${DEF_NAME})`), 'method'],
  [/^\s*class\s+(?:::)?(?:[A-Z]\w*::)*([A-Z]\w*)/, 'class'],
  [/^\s*module\s+(?:::)?(?:[A-Z]\w*::)*([A-Z]\w*)/, 'module'],
  [/^\s*([A-Z]\w*)\s*(?:\|\|)?=(?![=~>])/, 'const'],
  [new RegExp(`^\\s*alias_method\\s+:(${NAME})`), 'alias'],
  [new RegExp(`^\\s*alias\\s+:?(${NAME})`), 'alias'],
  [new RegExp(`^\\s*define_method\\s*\\(?\\s*:(${NAME})`), 'method'],
  [new RegExp(`^\\s*scope\\s+:(${NAME})`), 'scope'],
];
const ATTR = /^\s*(?:private\s+|protected\s+)?(attr_(?:reader|writer|accessor))\s+(.*)$/;

/**
 * Every definition in one Ruby source text, in the shape `definitionsIn`
 * returns for JavaScript.
 *
 * A qualified `class Billing::Invoice` is indexed as `Invoice`;
 * `SymbolIndex.find` takes either spelling.
 *
 * @returns {Array<{name: string, kind: string, line: number}>}
 */
export function rubyDefinitionsIn(source, code = rubyCodeLines(source)) {
  const out = [];
  code.forEach((text, i) => {
    if (!text.trim()) return;
    const attr = ATTR.exec(text);
    if (attr) {
      for (const m of attr[2].matchAll(/:([A-Za-z_]\w*)/g)) out.push({ name: m[1], kind: attr[1], line: i + 1 });
      return;
    }
    for (const [re, kind] of DEFINE) {
      const m = re.exec(text);
      if (m) {
        out.push({ name: m[1], kind, line: i + 1 });
        return;
      }
    }
  });
  return out;
}

const KEYWORDS = new Set(('BEGIN END alias and begin break case class def defined do else elsif end ensure '
  + 'false for if in module next nil not or redo rescue retry return self super then true undef unless until '
  + 'when while yield __FILE__ __LINE__ __ENCODING__').split(' '));

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every place `name` appears as a word in Ruby code: calls, `x.name`,
 * `:name` symbols (`before_action :name`, `send(:name)`), constants.
 *
 * Not `@name` or `$name`, which are variables, and not `name:` — a hash key or
 * keyword argument, the Ruby form of `{ name: 1 }` that the JavaScript side
 * also leaves out. `name` does not match `name?` or `name!`, which are other
 * methods.
 *
 * @returns {Array<{line: number, column: number}>}
 */
export function rubyReferencesIn(code, name) {
  // A method named like a keyword (`next`, `class`, `alias`) is only that
  // method after `.`, as a `:symbol` or behind `def`; bare, it is the keyword.
  const only = KEYWORDS.has(name) ? '(?<=(?:[.:]|\\bdef\\s+))' : '';
  const re = new RegExp(`${only}(?<![\\w@$])${escape(name)}(?![\\w?!])(?!:(?!:))`, 'g');
  const out = [];
  code.forEach((text, i) => {
    if (!text.includes(name)) return;
    for (const m of text.matchAll(re)) out.push({ line: i + 1, column: m.index + 1 });
  });
  return out;
}

/** Said beside any answer that includes Ruby files. */
export const RUBY_NOTE = 'Ruby is matched by line patterns, not parsed: methods made at run time '
  + '(define_method with a computed name, method_missing, Rails associations and attributes) are not '
  + 'found, names inside strings are not counted, and x.name matches any object\'s name. '
  + 'Use grep_search for those.';
