/**
 * Ruby for find_symbol and find_references (v6.8), by line patterns.
 *
 * Measured against Ruby's own parser (Ripper) over the 1,093 .rb files that
 * ship with macOS: 17,628 of 17,641 def/defs/class/module found (99.9%), 160 ms
 * cold. The first cut found 92.4%; the shapes it missed are pinned below, each
 * one from that measurement.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rubyCodeLines, rubyDefinitionsIn, rubyReferencesIn, RUBY_NOTE } from '../../src/context/ruby-symbols.js';
import { SymbolIndex } from '../../src/context/symbol-index.js';
import { findSymbol, findReferences } from '../../src/mcp/tools/find-symbol.js';

const defs = (src) => rubyDefinitionsIn(src).map((d) => `${d.line} ${d.kind} ${d.name}`);

const INVOICE = `# Billing invoices
module Billing
  class Invoice < ApplicationRecord
    TAX_RATE = 0.2
    attr_reader :total, :lines
    attr_accessor :note
    scope :overdue, -> { where(paid: false) }
    has_many :payments

    def self.build(attrs)
      new(attrs)
    end

    def paid?
      payments.any?
    end

    def total=(value)
      @total = value
    end

    private def recalculate!
      self.total = lines.sum(&:amount) # total is reset here
    end

    alias_method :settled?, :paid?
    define_method(:summary) { "Invoice #{id}: total" }
  end
end
`;

describe('definitions', () => {
  test('the shapes a Rails model uses', () => {
    assert.deepEqual(defs(INVOICE), [
      '2 module Billing',
      '3 class Invoice',
      '4 const TAX_RATE',
      '5 attr_reader total',
      '5 attr_reader lines',
      '6 attr_accessor note',
      '7 scope overdue',
      '10 class method build',
      '14 method paid?',
      '18 method total=',
      '22 method recalculate!',
      '26 alias settled?',
      '27 method summary',
    ]);
  });

  test('operators, other receivers and a leading :: (missed by the first cut)', () => {
    assert.deepEqual(defs([
      'class ::Digest::Class',
      '  def ==(other); end',
      '  def [](i); end',
      '  def self.[](*a); end',
      '  def self::log_open; end',
      '  def Tracer.on; end',
      '  def klass.instance; end',
      '  def -@; end',
      'end',
    ].join('\n')), [
      '1 class Class',
      '2 method ==',
      '3 method []',
      '4 class method []',
      '5 class method log_open',
      '6 class method on',
      '7 class method instance',
      '8 method -@',
    ]);
  });

  test('comments, =begin blocks, heredocs and strings define nothing', () => {
    assert.deepEqual(defs([
      '# def commented_out',
      '=begin',
      'def in_a_doc_block',
      '=end',
      'SQL = <<~SQL',
      '  def in_a_heredoc',
      'SQL',
      'puts "def in_a_string"',
      'def real; end',
    ].join('\n')), ['5 const SQL', '9 method real']);
  });

  test('a heredoc named in a comment is not one (it blanked the rest of getoptlong.rb)', () => {
    assert.deepEqual(defs('#   puts <<-EOF\nclass GetoptLong\n  def set_options; end\nend\n'),
      ['2 class GetoptLong', '3 method set_options']);
  });
});

describe('references', () => {
  const refs = (src, name) => rubyReferencesIn(rubyCodeLines(src), name).map((r) => r.line);

  test('calls, x.name and :name symbols count; comments, strings, @vars and keys do not', () => {
    const src = [
      'before_action :authenticate',     // 1 symbol: yes
      'def authenticate; end',           // 2 definition: yes
      'user.authenticate(token)',        // 3 member call: yes
      '# authenticate here',             // 4 comment: no
      'log("authenticate failed")',      // 5 string: no
      '@authenticate = true',            // 6 ivar: no
      'call(authenticate: true)',        // 7 key: no
      'authenticate!',                   // 8 another method: no
      'Auth::authenticate',              // 9 scoped call: yes
      'log("#{authenticate}")',          // 10 interpolation is code: yes
    ].join('\n');
    assert.deepEqual(refs(src, 'authenticate'), [1, 2, 3, 9, 10]);
  });

  test('a ? or ! name is its own word', () => {
    assert.deepEqual(refs('a.paid?\na.paid\nx = paid? && 1', 'paid?'), [1, 3]);
  });
});

describe('the index and the tools', () => {
  const ws = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ruby-sym-'));
    mkdirSync(join(dir, 'app', 'models'), { recursive: true });
    mkdirSync(join(dir, 'vendor', 'bundle'), { recursive: true });
    writeFileSync(join(dir, 'app', 'models', 'invoice.rb'), INVOICE);
    writeFileSync(join(dir, 'app', 'models', 'report.rb'), 'class Report\n  def run\n    Billing::Invoice.build({}).paid?\n  end\nend\n');
    writeFileSync(join(dir, 'vendor', 'bundle', 'gem.rb'), 'class Invoice; end\n');
    writeFileSync(join(dir, 'tasks.rake'), 'task :bill do\n  Billing::Invoice.build({})\nend\n');
    return dir;
  };

  test('Ruby is indexed, not skipped, and vendor/bundle is left out', () => {
    const dir = ws();
    try {
      const index = new SymbolIndex(dir).refresh();
      assert.equal(index.rubyFiles, 3);
      assert.deepEqual(index.skipped, []);
      assert.deepEqual(index.find('Invoice').map((d) => d.file), ['app/models/invoice.rb']);
      assert.deepEqual(index.find('Billing::Invoice').map((d) => d.line), [3], 'the namespaced spelling finds it');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('find_symbol and find_references answer for Ruby and say how sure they are', async () => {
    const dir = ws();
    try {
      const sym = await findSymbol({ name: 'paid?' }, { workspace: dir });
      assert.equal(sym.found, 1);
      assert.equal(sym.definitions[0].kind, 'method');
      assert.equal(sym.rubyNote, RUBY_NOTE);

      const ref = await findReferences({ name: 'build' }, { workspace: dir });
      const files = Object.fromEntries(ref.files.map((f) => [f.file, f]));
      assert.ok(files['app/models/invoice.rb'].lines.some((l) => l.isDefinition));
      assert.ok(files['app/models/report.rb'].byText);
      assert.ok(files['tasks.rake'], '.rake files are Ruby');
      assert.match(ref.rubyNote, /define_method/);

      const none = await findSymbol({ name: 'nothing_here' }, { workspace: dir });
      assert.equal(none.found, 0);
      assert.match(none.rubyNote, /method_missing/, 'not found in Ruby can mean made at run time');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('negative control: a JavaScript-only answer carries no Ruby note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-sym-'));
    try {
      writeFileSync(join(dir, 'a.js'), 'export function build() {}\n');
      const sym = await findSymbol({ name: 'build' }, { workspace: dir });
      assert.equal(sym.found, 1);
      assert.equal('rubyNote' in sym, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/*
 * v6.19: the five causes of noise found against Ripper's lexer (precision
 * 91.8% → 99.5%, recall 99.1% → 99.96%, over every name defined in macOS's Ruby
 * standard library). Each case is one cause, with its control.
 */
describe('Ruby references: literals are not code', () => {
  const refs = (src, name) => rubyReferencesIn(rubyCodeLines(src), name).map((r) => r.line);

  test('a regex is a literal, but its #{} is code — and a # in it is not a comment', () => {
    assert.deepEqual(refs('x =~ /HTTP\\/(\\d+) token/', 'token'), []);
    assert.deepEqual(refs('s.split /token/', 'token'), [], 'a regex argument');
    assert.deepEqual(refs('m =~ /^\\s*#{START}/ ? token : 2', 'token'), [1]);
    assert.deepEqual(refs('m =~ /^\\s*#{START}/', 'START'), [1]);
    assert.deepEqual(refs('x = %r{a/token}i', 'token'), []);
    // control: division is not a regex
    assert.deepEqual(refs('y = total / token / 2', 'token'), [1]);
    assert.deepEqual(refs('dir.chomp(?/); token', 'token'), [1], '?/ is a character, not a regex');
  });

  test('a string inside #{} is a string', () => {
    assert.deepEqual(refs('"#{x || \'token\'} rest"', 'token'), []);
    assert.deepEqual(refs('"#{token || \'other\'}"', 'token'), [1]);
  });

  test('%w and %i words are strings, % after a value divides', () => {
    assert.deepEqual(refs('%w[token other] + %i(token)', 'token'), []);
    assert.deepEqual(refs('"%s" % [token]', 'token'), [1]);
  });

  test('a heredoc body keeps its #{}, unless the tag is quoted', () => {
    assert.deepEqual(refs('s = <<~SQL\n  select token from #{token}\nSQL\n', 'token'), [2]);
    assert.deepEqual(refs("s = <<~'SQL'\n  select #{token}\nSQL\n", 'token'), []);
  });

  test('a method named like a keyword is that method only after . : or def', () => {
    const src = 'def next\nend\nitems.next\nsend(:next)\nnext if done';
    assert.deepEqual(refs(src, 'next'), [1, 3, 4]);
    assert.deepEqual(refs('x.class; class Foo', 'class'), [1]);
  });

  test('a literal may span lines, but not far', () => {
    assert.deepEqual(refs('x = "first\ntoken\nlast"\ntoken', 'token'), [4]);
    const runaway = ['x = "never closed', ...Array(60).fill('token')].join('\n');
    assert.ok(refs(runaway, 'token').length >= 15, 'a misread start blanks at most 40 lines');
  });

  test('__END__ ends the code', () => {
    assert.deepEqual(refs('token\n__END__\ntoken data', 'token'), [1]);
  });
});
