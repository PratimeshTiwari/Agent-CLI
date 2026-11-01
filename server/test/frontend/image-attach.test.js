/**
 * Images in a prompt, Claude Code's way (2026-10-26).
 *
 * ctrl+v puts `[Image #1]` into the prompt; the image goes only while its tag
 * is in the text; backspace takes a tag in one press; the sent message shows
 * `⎿ [Image #1]` rows that link to the file. `/image` and `/paste-image` are
 * gone.
 *
 * And the faults that came before it, each reproduced under the pty first:
 * osascript's stderr stranded the input rule under Ink; the meter counted the
 * base64 (`0% until auto-compact`); the image path rode in `[Objective: …]`;
 * and the tab waited five seconds for text that would never land.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadImage, tagAt, imagesInText, imagePromptBlock, recordedImageBlock,
  foldImages, linkImageTags, backspaceAt,
} from '../../src/frontend/image-attach.js';
import { OSASCRIPT_STDIO } from '../../src/frontend/clipboard-image.js';
import {
  promptCharge, IMAGE_CHARGE_CHARS, stripImageData, stripImageHeaders,
} from '../../src/backend/core/prompt-builder.js';
import { parseTurnActions } from '../../src/frontend/transcript.js';
import { SLASH_COMMANDS } from '../../src/frontend/constants.js';

const src = (rel) => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../../../extension/content-scripts/gemini-bridge.js', import.meta.url), 'utf8');

const img = (n, extra = {}) => ({ n, path: `/w/.agent/tmp/clipboard-${n}.png`, base64: 'QUJD', mime: 'image/png', sizeKB: 3, ...extra });

describe('osascript never writes on the terminal', () => {
  test('stderr is piped, not inherited, at the one call site', () => {
    assert.equal(OSASCRIPT_STDIO[2], 'pipe');
    assert.match(src('frontend/clipboard-image.js'), /execFileSync\('osascript'[^)]*stdio: OSASCRIPT_STDIO/);
  });
});

describe('loadImage', () => {
  const ws = mkdtempSync(join(tmpdir(), 'img-'));
  writeFileSync(join(ws, 'a.png'), Buffer.alloc(2048));
  writeFileSync(join(ws, 'notes.txt'), 'x');

  test('a file is read, numbered, and sized', () => {
    const first = loadImage({ workspace: ws, filePath: 'a.png' });
    const second = loadImage({ workspace: ws, filePath: 'a.png' });
    assert.equal(first.ok, true);
    assert.equal(first.image.mime, 'image/png');
    assert.equal(first.image.sizeKB, 2);
    assert.equal(second.image.n, first.image.n + 1, 'numbered per session');
  });

  test('a missing file and a non-image say so', () => {
    assert.match(loadImage({ workspace: ws, filePath: 'nope.png' }).reason, /No such file/);
    assert.match(loadImage({ workspace: ws, filePath: 'notes.txt' }).reason, /Not an image/);
  });

  test.after(() => rmSync(ws, { recursive: true, force: true }));
});

describe('the tag in the prompt', () => {
  test('goes in at the caret, with a space either side', () => {
    assert.deepEqual(tagAt('', 0, 1), { value: '[Image #1] ', offset: 11 });
    assert.deepEqual(tagAt('look at', 7, 2), { value: 'look at [Image #2] ', offset: 19 });
    assert.deepEqual(tagAt('look at ', 8, 2), { value: 'look at [Image #2] ', offset: 19 });
    // In the middle: no doubled space after it.
    assert.deepEqual(tagAt('see  here', 4, 3), { value: 'see [Image #3] here', offset: 14 });
  });

  // The pty run that found it: `look at` + ctrl+v + `please` sent
  // `look atplease`, because the next key edited the render's stale value.
  test('it goes through the field, so the next key sees it', () => {
    assert.match(src('frontend/App.jsx'), /cursorRef\.current\.apply\(put\)/);
    const field = src('frontend/components/PromptInput.jsx');
    assert.match(field, /useInput\(\(input, key\) => \{\n\s*const \{ value, offset \} = live\.current;/);
  });

  test('only images whose tags are still in the text go', () => {
    const pending = [img(1), img(2), img(3)];
    assert.deepEqual(imagesInText('compare [Image #1] and [Image #3]', pending).map((i) => i.n), [1, 3]);
    assert.deepEqual(imagesInText('no tags left', pending), []);
  });

  // Control: #1 must not match inside #12.
  test('a tag is matched whole', () => {
    assert.deepEqual(imagesInText('see [Image #12]', [img(1), img(12)]).map((i) => i.n), [12]);
  });
});

describe('backspace takes a tag in one press', () => {
  test('right after the tag and its space', () => {
    assert.deepEqual(backspaceAt('hi [Image #1] ', 14), { value: 'hi ', offset: 3 });
  });

  test('right after the tag', () => {
    assert.deepEqual(backspaceAt('[Image #2] what', 10), { value: ' what', offset: 0 });
  });

  // Controls: an ordinary character, the start, and a half-typed tag.
  test('anything else is one character', () => {
    assert.deepEqual(backspaceAt('abc', 3), { value: 'ab', offset: 2 });
    assert.deepEqual(backspaceAt('abc', 0), { value: 'abc', offset: 0 });
    assert.deepEqual(backspaceAt('[Image #1', 9), { value: '[Image #', offset: 8 });
  });

  test('the prompt uses it', () => {
    assert.match(src('frontend/components/PromptInput.jsx'), /backspaceAt\(value, offset\)/);
  });
});

describe('what is sent, and what is recorded', () => {
  const block = imagePromptBlock([img(1), img(2)]);

  test('one header and one data block per image', () => {
    assert.match(block, /^\[Image #1: \/w\/\.agent\/tmp\/clipboard-1\.png\] \(3KB, image\/png\)\n<image_data>\ndata:image\/png;base64,QUJD\n<\/image_data>\n\[Image #2: /);
  });

  test('the record keeps the paths and none of the data', () => {
    const recorded = recordedImageBlock([img(1)]);
    assert.ok(!recorded.includes('QUJD'));
    assert.equal(recorded, stripImageData(imagePromptBlock([img(1)])));
  });

  // The bridge lifts every block, not only the first; one left behind is
  // pasted into the chat as base64.
  test('the bridge takes every block and leaves the headers', () => {
    const m = /const IMAGE_BLOCK = (\/.*\/g);/.exec(bridge);
    assert.ok(m, 'control: the bridge declares IMAGE_BLOCK');
    const re = new Function(`return ${m[1]};`)();
    const text = `${block}what is this`;
    assert.equal([...text.matchAll(re)].length, 2);
    const left = text.replace(re, '');
    assert.ok(!left.includes('base64'));
    assert.match(left, /\[Image #2: /);
  });

  test('the bridge no longer waits for text because an image was pasted', () => {
    assert.match(bridge, /if \(!landed && pasteClaimed\) \{/);
    assert.ok(!/pasteClaimed \|\| hasImage/.test(bridge));
  });

  test('the objective is the message, not the image block', () => {
    const recorded = `${recordedImageBlock([img(1)])}what is [Image #1]`;
    assert.equal(stripImageHeaders(recorded), 'what is [Image #1]');
    assert.equal(stripImageHeaders('plain'), 'plain');
    assert.match(src('backend/core/agent-loop.js'), /this\.currentObjective = stripImageHeaders\(remembered\);/);
  });
});

describe('the sent message draws the images as links', () => {
  test('the block folds away and each tag knows its file', () => {
    const { text, links } = foldImages(`${recordedImageBlock([img(1), img(2)])}compare [Image #1] [Image #2]`);
    assert.equal(text, 'compare [Image #1] [Image #2]');
    assert.equal(links.get(2), '/w/.agent/tmp/clipboard-2.png');
  });

  test('the fold and the objective strip agree', () => {
    const recorded = `${recordedImageBlock([img(3)])}x`;
    assert.equal(foldImages(recorded).text, stripImageHeaders(recorded));
  });

  test('older history folds to [Image]', () => {
    const old = '[Image attached: /w/x.png (1KB, image/png)]\n\n<image_data>(the image was delivered to the chat tab)</image_data>\n\nwhat is this';
    assert.equal(foldImages(old).text, '[Image] what is this');
  });

  test('ordinary text is untouched', () => {
    const t = 'why does [Image attached: x] appear?';
    assert.equal(foldImages(t).text, t);
  });

  test('a tag becomes an OSC 8 link to its file; an unknown one stays text', () => {
    const links = new Map([[1, '/w/a b.png']]);
    assert.equal(linkImageTags('[Image #1]', links), '\x1b]8;;file:///w/a%20b.png\x1b\\[Image #1]\x1b]8;;\x1b\\');
    assert.equal(linkImageTags('[Image #2]', links), '[Image #2]');
  });

  test('the committed bar draws them, the live one does not', () => {
    assert.match(src('frontend/components/TranscriptTurn.jsx'), /\{!isLive && \[\.\.\.links\.keys\(\)\]\.map/);
  });
});

describe('ctrl+v is the way in; the commands are gone', () => {
  test('no /image or /paste-image command', () => {
    assert.ok(!SLASH_COMMANDS.some((c) => c.name === 'image' || c.name === 'paste-image'));
    assert.ok(!src('frontend/hooks/use-slash-commands.js').includes("command === 'paste-image'"));
  });

  test('ctrl+v and an empty cmd+V paste both attach', () => {
    assert.match(src('frontend/App.jsx'), /'paste-image': attachImage,/);
    assert.match(src('frontend/components/InputBar.jsx'), /hasClipboardImage\(\)\) \{\n\s*attachImage\(\);/);
  });

  test('older history: a /image note is not counted as work', () => {
    const old = '🖼️ Image attached: /w/.agent/tmp/clipboard-1.png (3KB)\nType your prompt…';
    const { items, actions } = parseTurnActions({ id: 1, steps: [{ role: 'assistant', isLocal: true, content: old }] });
    assert.ok(items.some((i) => i.type === 'image'));
    assert.equal(actions.length, 0);
  });
});

describe('the meter charges an image what Gemini does', () => {
  test('the base64 is not counted', () => {
    const prompt = `${imagePromptBlock([img(1, { base64: 'A'.repeat(870_000) })])}what is this`;
    assert.equal(promptCharge(prompt), stripImageData(prompt).length + IMAGE_CHARGE_CHARS);
    assert.ok(promptCharge(prompt) < 2_000);
  });

  test('a prompt with no image is its length, and both send paths use it', () => {
    assert.equal(promptCharge('hello'), 5);
    const loop = src('backend/core/agent-loop.js');
    assert.equal((loop.match(/contextChars \+= promptCharge\(prompt\)/g) || []).length, 2);
  });
});
