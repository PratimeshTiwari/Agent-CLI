/**
 * Attaching an image from the terminal — three faults from one screenshot
 * (2026-10-26), each reproduced under the pty before it was fixed:
 *
 * - osascript's stderr landed on the terminal under Ink and stranded the input
 *   box's top rule in scrollback;
 * - the attach note was an unmarked assistant row, so the screen drew a
 *   command's answer as an agent turn with `Worked · 1 action` under it, and
 *   its 110-character path wrapped across three rows;
 * - the context meter counted the base64, so attaching a screenshot read
 *   `0% until auto-compact` and the next message would have compacted.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageAttachedNote, imageTag, foldImageHeader } from '../../src/ui/format.js';
import { OSASCRIPT_STDIO } from '../../src/ui/clipboard-image.js';
import { promptCharge, IMAGE_CHARGE_CHARS, stripImageData } from '../../src/core/prompt-builder.js';
import { groupTurns, parseTurnActions } from '../../src/ui/transcript.js';

const src = (rel) => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8');

describe('osascript never writes on the terminal', () => {
  test('stderr is piped, not inherited', () => {
    assert.equal(OSASCRIPT_STDIO[2], 'pipe');
  });

  // The constant is only worth something if the call uses it.
  test('the one call site passes it', () => {
    assert.match(src('ui/clipboard-image.js'), /execFileSync\('osascript'[^)]*stdio: OSASCRIPT_STDIO/);
  });
});

describe('imageAttachedNote', () => {
  // Owner, 2026-10-26: no emoji, no path — `[Image #1]`, as Claude Code does.
  test('names the image by number, with its size, and no path or emoji', () => {
    const note = imageAttachedNote(2, 650_000);
    assert.equal(note, '[Image #2] attached · 635 KB · `/image remove` to drop it');
    assert.ok(!/🖼|\//.test(note.replace('`/image remove`', '')));
  });

  test('the tag the prompt carries is the same one', () => {
    assert.equal(imageTag(3), '[Image #3]');
  });
});

describe('a recorded image prompt is drawn folded', () => {
  const recorded = '[Image attached: /w/.agent/tmp/clipboard-1.png (635KB, image/png)]\n\n'
    + '<image_data>(the image was delivered to the chat tab)</image_data>\n\nwhat is this';

  test('header and placeholder become one tag', () => {
    assert.equal(foldImageHeader(recorded), '[Image] what is this');
  });

  // Control: a prompt that merely mentions the words is left alone.
  test('an ordinary prompt is untouched', () => {
    const text = 'why does [Image attached: x] appear in the log?';
    assert.equal(foldImageHeader(text), text);
  });
});

describe('the note is drawn as a command answer, not an agent turn', () => {
  const rows = (assistant) => [
    { role: 'user', content: '/paste-image', isLocal: true },
    assistant,
  ];

  test('every /image reply is marked local', () => {
    const body = src('ui/hooks/use-slash-commands.js');
    const block = body.slice(body.indexOf("if (command === 'image' || command === 'paste-image')"));
    const handler = block.slice(0, block.indexOf('\n    // Handle standard agent loop commands'));
    const replies = handler.match(/role: 'assistant'[^}]*/g) || [];
    assert.ok(replies.length >= 5, `found ${replies.length}`);
    assert.ok(!/[🖼⚠❌]/u.test(handler), 'no emoji in what /image says');
    for (const r of replies) assert.match(r, /isLocal: true/, r);
  });

  // What drew `Worked · 1 action`: the old note's `🖼️ Image attached: path`
  // line is parsed into an `image` row, and that row was counted as work.
  test('the old note is an image row, and not counted as work', () => {
    const old = '🖼️ Image attached: /w/.agent/tmp/clipboard-1.png (3KB)\nType your prompt…';
    const { items, actions } = parseTurnActions(groupTurns(rows({ role: 'assistant', isLocal: true, content: old }))[0]);
    assert.ok(items.some((i) => i.type === 'image'));
    assert.equal(actions.length, 0);
  });

  // The control: a real tool row in the same turn still counts.
  test('a tool row beside it still counts', () => {
    const old = '🖼️ Image attached: /w/x.png (3KB)';
    const { actions } = parseTurnActions({ id: 1, steps: [
      { role: 'assistant', isLocal: true, content: old },
      { type: 'tool_call', toolName: 'read_file', args: { path: 'a' } },
      { type: 'tool_result', result: { totalLines: 3 }, success: true },
    ] });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'tool');
  });

  test('the new note is prose, so it draws no action row at all', () => {
    const note = imageAttachedNote(1, 3000);
    const { items } = parseTurnActions(groupTurns(rows({ role: 'assistant', isLocal: true, content: note }))[0]);
    assert.deepEqual(items.map((i) => i.type), ['text']);
  });
});

describe('the meter charges an image what Gemini does', () => {
  const big = 'A'.repeat(870_000);
  const prompt = `[Image attached: x.png]\n\n<image_data>\ndata:image/png;base64,${big}\n</image_data>\n\nwhat is this`;

  test('the base64 is not counted', () => {
    const charge = promptCharge(prompt);
    assert.equal(charge, stripImageData(prompt).length + IMAGE_CHARGE_CHARS);
    assert.ok(charge < 2_000, `${charge}`);
  });

  test('a prompt with no image is its length', () => {
    assert.equal(promptCharge('hello'), 5);
  });

  test('both send paths use it', () => {
    const loop = src('core/agent-loop.js');
    assert.equal((loop.match(/contextChars \+= promptCharge\(prompt\)/g) || []).length, 2);
    assert.ok(!/contextChars \+= prompt\.length/.test(loop));
  });
});
