/**
 * Markdown to Jira's two text formats and back (v8.1): ADF on Cloud, wiki
 * markup on Server/Data Center. Both writers come from one parse, so each
 * construct is checked both ways on both.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown } from '../../../src/backend/atlassian/markdown.js';
import { markdownToAdf, adfToMarkdown } from '../../../src/backend/atlassian/adf.js';
import { markdownToWiki, wikiToMarkdown } from '../../../src/backend/atlassian/wiki.js';

const SAMPLE = [
  '# Title',
  '',
  'Some **bold**, *italic*, ~~gone~~, `code` and [a link](https://x.io), plus https://y.io/a.',
  '',
  '- one',
  '- two',
  '  - nested',
  '',
  '1. first',
  '2. second',
  '',
  '```js',
  'const x = { a: 1 };',
  '```',
  '',
  '> quoted',
  '',
  '---',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | x\\|y |',
].join('\n');

describe('markdown parsing', () => {
  it('reads the inline marks the model writes', () => {
    const runs = parseInline('a **b** *c* `d` [e](https://e.io) ~~f~~');
    assert.deepEqual(runs.filter((r) => r.text.trim()).map((r) => [r.text, Object.keys(r.marks).sort().join(',')]), [
      ['a ', ''], ['b', 'strong'], ['c', 'em'], ['d', 'code'], ['e', 'link'], ['f', 'strike'],
    ]);
  });

  it('leaves snake_case and a lone asterisk alone', () => {
    assert.deepEqual(parseInline('snake_case_name and 2 * 3'), [{ text: 'snake_case_name and 2 * 3', marks: {} }]);
  });

  it('nests a list by indentation', () => {
    const [list] = parseMarkdown('- a\n  - b\n- c');
    assert.equal(list.items.length, 2);
    assert.equal(list.items[0][1].type, 'list');
  });
});

describe('Cloud: ADF', () => {
  it('round-trips every supported construct with nothing lost', () => {
    const back = adfToMarkdown(markdownToAdf(SAMPLE));
    assert.deepEqual(back.lost, []);
    assert.equal(back.markdown, SAMPLE.replace('| --- | --- |', '| --- | --- |'));
  });

  it('writes valid shapes: a doc, code marks alone, a listItem opening with a paragraph', () => {
    const doc = markdownToAdf('**`x`**\n\n-   \n  - nested');
    assert.equal(doc.type, 'doc');
    assert.equal(doc.version, 1);
    assert.deepEqual(doc.content[0].content[0].marks, [{ type: 'code' }]);
    const item = doc.content[1].content[0];
    assert.equal(item.content[0].type, 'paragraph');
  });

  it('an empty description is still a valid doc', () => {
    assert.deepEqual(markdownToAdf(''), { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [] }] });
  });

  it('reads what it cannot write, and names it as lost', () => {
    const r = adfToMarkdown({
      type: 'doc', version: 1, content: [
        { type: 'panel', attrs: { panelType: 'info' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heads up' }] }] },
        { type: 'paragraph', content: [
          { type: 'mention', attrs: { text: '@Ana' } }, { type: 'text', text: ' ' },
          { type: 'status', attrs: { text: 'DONE' } }, { type: 'text', text: ' ' },
          { type: 'text', text: 'red', marks: [{ type: 'textColor', attrs: { color: '#f00' } }] },
        ] },
      ],
    });
    assert.match(r.markdown, /> \*\*info:\*\* Heads up/);
    assert.match(r.markdown, /@Ana \[DONE\] red/);
    assert.deepEqual(r.lost, ['mention', 'panel', 'status', 'textColor (formatting)']);
  });
});

describe('Server/DC: wiki markup', () => {
  it('writes wiki markup', () => {
    const wiki = markdownToWiki(SAMPLE);
    for (const piece of ['h1. Title', '*bold*', '_italic_', '-gone-', '{{code}}', '[a link|https://x.io]', '[https://y.io/a]',
      '* one', '** nested', '# first', '{code:javascript}', '{quote}', '----', '||A||B||', '|1|x\\|y|']) {
      assert.ok(wiki.includes(piece), `missing ${piece}\n${wiki}`);
    }
  });

  it('escapes a mark at a word edge, not in the middle of one', () => {
    assert.equal(markdownToWiki('a - b, -flag, 2026-10-31, {x}'), 'a - b, \\-flag, 2026-10-31, \\{x\\}');
  });

  it('round-trips with nothing lost', () => {
    const back = wikiToMarkdown(markdownToWiki(SAMPLE));
    assert.deepEqual(back.lost, []);
    for (const piece of ['# Title', '**bold**', '*italic*', '~~gone~~', '`code`', '[a link](https://x.io)', '- one',
      '  - nested', '1. first', '```javascript', '> quoted', '---', '| A | B |', '| 1 | x\\|y |']) {
      assert.ok(back.markdown.includes(piece), `missing ${piece}\n${back.markdown}`);
    }
  });

  it('reads macros, mentions and images it cannot write, and names them', () => {
    const r = wikiToMarkdown('{panel:title=Note}\nProd only\n{panel}\nAsk [~ana] about !shot.png!');
    assert.match(r.markdown, /Prod only/);
    assert.match(r.markdown, /@ana about \[image: shot\.png\]/);
    assert.deepEqual(r.lost, ['image', 'mention', 'panel']);
  });

  it('keeps a link in a table cell whole', () => {
    assert.match(wikiToMarkdown('||A||B||\n|*b*|[l|https://q.io]|').markdown, /\| \*\*b\*\* \| \[l\]\(https:\/\/q\.io\) \|/);
  });
});
