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

/**
 * One line with its comment removed and string contents blanked to spaces, so
 * columns still line up with the source. `#{…}` inside double quotes is code
 * and kept. A string that spans lines is read per line — a known blind spot.
 */
function codeOf(line) {
  let out = '';
  let quote = null;
  let depth = 0; // inside `#{ }` of a double-quoted string
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (depth > 0) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      out += ch;
      continue;
    }
    if (quote) {
      if (ch === '\\') { out += i + 1 < line.length ? '  ' : ' '; i++; continue; }
      if (ch === quote) { quote = null; out += ch; continue; }
      if (quote === '"' && ch === '#' && line[i + 1] === '{') { depth = 1; out += '#{'; i++; continue; }
      out += ' ';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (ch === '#') break;
    out += ch;
  }
  return out;
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inDoc) {
      out[i] = '';
      if (/^=end\b/.test(line)) inDoc = false;
      continue;
    }
    if (heredocs.length) {
      out[i] = '';
      if (line.trim() === heredocs[0]) heredocs.shift();
      continue;
    }
    if (/^=begin\b/.test(line)) {
      out[i] = '';
      inDoc = true;
      continue;
    }
    const code = codeOf(line);
    out[i] = code;
    // `<<~SQL`, `<<-EOS`, `<<EOS`, `<<~'EOS'`. Not `x << y`: a heredoc has no space.
    // Read from the raw line up to where its comment starts: `# puts <<-EOF` in
    // a comment is not a heredoc, and taking it for one blanked the rest of
    // getoptlong.rb (measured against Ripper).
    for (const m of line.slice(0, code.length).matchAll(/<<[~-]?(['"`]?)([A-Z_][A-Za-z0-9_]*)\1/g)) heredocs.push(m[2]);
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
  const re = new RegExp(`(?<![\\w@$])${escape(name)}(?![\\w?!])(?!:(?!:))`, 'g');
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
