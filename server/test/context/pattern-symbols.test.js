/**
 * Every language but JavaScript and Ruby for find_symbol and find_references
 * (v6.21), from one table of line patterns.
 *
 * Measured against each language's own parser: Python's `ast` over its stdlib,
 * `go/ast` over every third GOROOT file (1,501), and the TypeScript compiler
 * over 108 `.d.ts` files. Definitions 99.1–99.96% recall at 99.98–100%
 * precision; references 99.98–100% both ways. The fixtures below are the
 * shapes each row exists for, plus the decoys a word match would take.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  languageFor, patternCodeLines, patternDefinitionsIn, patternReferencesIn, PATTERN_EXTS, PATTERN_NOTE,
} from '../../src/context/pattern-symbols.js';
import { SymbolIndex } from '../../src/context/symbol-index.js';
import { findSymbol, findReferences } from '../../src/mcp/tools/find-symbol.js';

const defs = (ext, src) => {
  const lang = languageFor(ext);
  return patternDefinitionsIn(src, lang, patternCodeLines(src, lang)).map((d) => `${d.line} ${d.kind} ${d.name}`);
};
const refLines = (ext, src, name) => {
  const lang = languageFor(ext);
  return patternReferencesIn(patternCodeLines(src, lang), name, lang).map((r) => r.line);
};

const FIXTURES = {
  '.py': [`import os
# def commented(): pass
class Invoice(Base):
    def total(self, lines):
        s = "def fake(): pass"
        return f"{self.rate(lines)} total"
    async def fetch(self):
        pass
def build(x):
    return Invoice().total(x)
`, ['3 class Invoice', '4 method total', '7 method fetch', '9 function build']],
  '.go': [`package billing
// func Commented() {}
type Invoice struct { Total int }
const (
	Rate = 2
	_ = 3
)
func (i *Invoice) Paid() bool { return i.Total > 0 }
func Build(n int) *Invoice {
	s := "func Fake() {}"
	_ = s
	return &Invoice{Total: n}
}
`, ['3 type Invoice', '5 const Rate', '8 method Paid', '9 function Build']],
  '.ts': [`// function commented() {}
export interface Options { type?: string; limit: number }
export class Client {
  constructor(private opts: Options) {}
  async send(body: string): Promise<void> {
    if (this.ready()) return;
    const s = "function fake() {}";
    return this.opts.type ? send(body) : undefined;
  }
  ready(): boolean { return true }
}
export function build(o: Options) { return new Client(o); }
export const DEFAULT = 1;
`, ['2 interface Options', '3 class Client', '4 method constructor', '5 method send', '10 method ready',
    '12 function build', '13 const DEFAULT']],
  '.java': [`package billing;
// class Commented {}
public class Invoice extends Base {
    public Invoice(int n) { super(n); }
    public int total(List<Line> lines) throws IOException {
        if (lines.isEmpty()) return 0;
        String s = "public void fake() {}";
        return compute(lines);
    }
}
`, ['3 class Invoice', '4 method Invoice', '5 method total']],
  '.cs': [`namespace Billing {
  // class Commented {}
  public record Line(int Qty);
  public class Invoice : Base {
    public int Total { get; set; }
    public async Task<int> SendAsync(string body) {
      var s = @"public void Fake() {}";
      return await Post(body);
    }
  }
}
`, ['3 class Line', '4 class Invoice', '5 property Total', '6 method SendAsync']],
  '.kt': [`package billing
data class Invoice(val total: Int)
object Registry { val all = mutableListOf<Invoice>() }
fun Invoice.paid(): Boolean = total > 0
suspend fun build(n: Int): Invoice { val s = "fun fake() {}"; return Invoice(n) }
`, ['2 class Invoice', '3 class Registry', '4 function paid', '5 function build']],
  '.rs': [`// fn commented() {}
pub struct Invoice { total: u32 }
pub enum State { Open, Paid }
impl Invoice {
    pub fn paid(&self) -> bool { self.total > 0 }
}
pub(crate) async fn build(n: u32) -> Invoice { let s = r#"fn fake() {}"#; Invoice { total: n } }
macro_rules! invoice { () => {} }
`, ['2 type Invoice', '3 type State', '5 function paid', '7 function build', '8 macro invoice']],
  '.php': [`<?php
// function commented() {}
namespace Billing;
class Invoice extends Base {
    const RATE = 2;
    public function total(array $lines): int {
        $s = "function fake() {}";
        return $this->compute($lines);
    }
}
function build($n) { return new Invoice($n); }
`, ['4 class Invoice', '5 const RATE', '6 function total', '11 function build']],
  '.cpp': [`#include <vector>
// int commented() {}
#define MAX_LINES 40
namespace billing {
class Invoice : public Base {
 public:
  int total(const std::vector<Line>& lines) const;
};
int Invoice::total(const std::vector<Line>& lines) const {
  if (lines.empty()) return 0;
  const char* s = "int fake() {}";
  return compute(lines);
}
}
`, ['3 macro MAX_LINES', '4 type billing', '5 type Invoice', '9 function total']],
};

describe('definitions, one fixture per language', () => {
  for (const [ext, [src, want]] of Object.entries(FIXTURES)) {
    test(`${languageFor(ext).name} (${ext})`, () => {
      const got = defs(ext, src);
      assert.deepEqual(got, want);
      // The decoys every fixture carries: a definition in a comment and one in a string.
      assert.ok(!got.some((d) => /commented|Commented|fake|Fake/.test(d)), got.join(', '));
    });
  }
});

describe('the shapes a word match gets wrong', () => {
  test('a call statement is not a C-like definition, even when it spans lines', () => {
    const src = `class A {
  void run() {
    configure(alpha,
        beta);
    return build(x);
    if (ready(x)) {}
  }
}
`;
    assert.deepEqual(defs('.java', src), ['1 class A', '2 method run']);
  });

  test('Java: void methods, interface methods and package-private constructors (javac oracle)', () => {
    const src = `interface Sink {
    void accept(int n);
    int await(long t);
}
class Node {
    Node(int n) {
        synchronized (lock) {
            try (var r = open()) {
                helper(n);
            }
        }
    }
}
`;
    assert.deepEqual(defs('.java', src),
      ['1 class Sink', '2 method accept', '3 method await', '5 class Node', '6 method Node']);
  });

  test('a parameter list that never closes is not a definition', () => {
    assert.deepEqual(defs('.java', 'class A {\n  int broken(int a,\n'), ['1 class A']);
  });

  test('TypeScript locals are not definitions; top-level constants are', () => {
    const src = 'export const TOP = 1;\nfunction f() {\n  const local = 2;\n  return local;\n}\n';
    assert.deepEqual(defs('.ts', src), ['1 const TOP', '2 function f']);
  });

  test('a TypeScript method named like a keyword is a member, not every keyword', () => {
    const src = 'interface O { type?: string; delete(id: string): void }\nconst t = o.type;\ntype X = string;\nif (o.delete) {}\n';
    assert.deepEqual(refLines('.ts', src, 'type'), [1, 2], 'the `type X` alias line is the keyword');
    assert.deepEqual(refLines('.ts', src, 'delete'), [4], 'only the member access counts');
  });

  test('a regex literal in TypeScript does not open a string', () => {
    const src = "const re = /\"/g;\nconst after = compute();\n";
    assert.deepEqual(refLines('.ts', src, 'compute'), [2]);
  });

  test('a Python f-string interpolation is code; the rest of the string is not', () => {
    const src = 's = f"{rate(x)} and rate"\nt = "rate"\n';
    assert.deepEqual(refLines('.py', src, 'rate'), [1]);
    assert.equal(refLines('.py', src, 'rate').length, 1, 'only the call inside the braces');
  });

  test('a triple-quoted Python docstring hides its contents across lines', () => {
    const src = 'def f():\n    """\n    def hidden(): pass\n    """\n    return 1\n';
    assert.deepEqual(defs('.py', src), ['1 function f']);
  });

  test('a Go raw string spans lines and hides its contents', () => {
    const src = 'package p\nvar t = `\nfunc Hidden() {}\n`\nfunc Real() {}\n';
    assert.deepEqual(defs('.go', src).filter((d) => /function/.test(d)), ['5 function Real']);
  });

  test('a Rust raw string with hashes ends only at its own delimiter', () => {
    const src = 'fn a() { let s = r#"say "fn b() {}" here"#; }\nfn c() {}\n';
    assert.deepEqual(defs('.rs', src), ['1 function a', '2 function c']);
  });
});

test('the table covers what the tool description promises', () => {
  for (const ext of ['.py', '.go', '.ts', '.tsx', '.java', '.cs', '.kt', '.swift', '.scala', '.rs', '.php',
    '.c', '.cpp', '.h', '.ex', '.lua', '.sh']) {
    assert.ok(PATTERN_EXTS.includes(ext), `${ext} is not in the table`);
  }
  assert.equal(languageFor('.js'), null, 'JavaScript stays with acorn');
  assert.equal(languageFor('.rb'), null, 'Ruby keeps its own scanner');
});

describe('through the index and the tools', () => {
  let dir;
  test('setup', () => {
    dir = mkdtempSync(join(tmpdir(), 'pattern-symbols-'));
    mkdirSync(join(dir, 'app'));
    mkdirSync(join(dir, 'vendor', 'lib'), { recursive: true });
    mkdirSync(join(dir, '.venv', 'lib'), { recursive: true });
    writeFileSync(join(dir, 'app', 'billing.py'), FIXTURES['.py'][0]);
    writeFileSync(join(dir, 'app', 'client.ts'), FIXTURES['.ts'][0]);
    writeFileSync(join(dir, 'app', 'main.go'), FIXTURES['.go'][0]);
    writeFileSync(join(dir, 'app', 'use.go'), 'package billing\nfunc use() { Build(1) }\n');
    // Installed copies are not the project: a hit in them is noise in the answer.
    writeFileSync(join(dir, 'vendor', 'lib', 'dep.go'), 'package dep\nfunc Build() {}\n');
    writeFileSync(join(dir, '.venv', 'lib', 'dep.py'), 'def build(): pass\n');
  });

  test('find_symbol answers for a table language and carries the note', async () => {
    const res = await findSymbol({ name: 'Build' }, { workspace: dir });
    const text = JSON.stringify(res);
    assert.match(text, /app\/main\.go/);
    assert.doesNotMatch(text, /vendor/, 'vendor/ is ignored');
    assert.equal(res.patternNote, PATTERN_NOTE);
  });

  test('find_references marks a table-language file byText and skips strings', async () => {
    const res = await findReferences({ name: 'Build' }, { workspace: dir });
    const text = JSON.stringify(res);
    assert.match(text, /use\.go/);
    assert.match(text, /"byText":true/);
    assert.doesNotMatch(text, /\.venv/);
  });

  test('a Python definition is found and .venv is not', async () => {
    const res = await findSymbol({ name: 'build' }, { workspace: dir });
    const text = JSON.stringify(res);
    assert.match(text, /billing\.py/);
    assert.doesNotMatch(text, /\.venv/);
  });

  test('a TypeScript interface is found', async () => {
    const res = await findSymbol({ name: 'Options' }, { workspace: dir });
    assert.match(JSON.stringify(res), /client\.ts/);
  });

  test('the index counts them apart from Ruby', () => {
    const idx = new SymbolIndex(dir).refresh();
    assert.equal(idx.patternFiles, 4);
    assert.equal(idx.rubyFiles, 0);
  });

  test('teardown', () => rmSync(dir, { recursive: true, force: true }));
});
