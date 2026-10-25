/**
 * The side panel takes a pasted image as an `[Image #n]` tag (2026-10-26).
 *
 * Same rules as the terminal: the tag goes in at the caret, backspace takes
 * the whole tag, and an image goes only while its tag is in the text. The
 * block it becomes on send is checked end to end, through the server and the
 * bridge, in `server/test/core/panel-images.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { JSDOM } from 'jsdom';

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../side-panel/panel.js'), 'utf8');

function take(name) {
  const from = src.indexOf(`function ${name}(`);
  if (from === -1) throw new Error(`${name} not found`);
  let depth = 0;
  for (let i = src.indexOf('{', from); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error(`${name} never closed`);
}

function panel(value = '', caret = value.length) {
  const { window } = new JSDOM('<textarea id="c"></textarea>');
  const commandInput = window.document.getElementById('c');
  commandInput.value = value;
  commandInput.setSelectionRange(caret, caret);
  const api = new Function('commandInput', 'FileReader', 'Event', `let pastedImages = []; let pastedCount = 0;
    const imageTag = (n) => \`[Image #\${n}]\`;
    ${take('insertAtCaret')} ${take('onPasteImage')} ${take('backspaceTag')}
    return { onPasteImage, backspaceTag, images: () => pastedImages };`)(commandInput, window.FileReader, window.Event);
  return { window, commandInput, ...api };
}

const pasteOf = (window, items) => {
  let prevented = false;
  return { e: { clipboardData: { items }, preventDefault: () => { prevented = true; } }, prevented: () => prevented };
};

test('a pasted image becomes a tag at the caret', async () => {
  const p = panel('look at', 7);
  const file = new p.window.File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
  const ev = pasteOf(p.window, [{ kind: 'file', type: 'image/png', getAsFile: () => file }]);
  p.onPasteImage(ev.e);
  assert.equal(ev.prevented(), true, 'the browser must not paste the image itself');
  // Wait on the result, not a clock: the read is async and a fixed sleep
  // measures the machine's load (it failed under the full suite at 50ms).
  for (let i = 0; i < 200 && !p.commandInput.value.includes('[Image'); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(p.commandInput.value, 'look at [Image #1] ');
  assert.match(p.images()[0].dataUrl, /^data:image\/png;base64,/);
});

// Control: text on the clipboard pastes as text, untouched.
test('a text paste is left to the browser', () => {
  const p = panel('');
  const ev = pasteOf(p.window, [{ kind: 'string', type: 'text/plain', getAsFile: () => null }]);
  p.onPasteImage(ev.e);
  assert.equal(ev.prevented(), false);
});

test('backspace right after a tag takes the whole tag', () => {
  const p = panel('see [Image #3] ', 15);
  let prevented = false;
  p.backspaceTag({ key: 'Backspace', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(p.commandInput.value, 'see ');
});

// Control: anywhere else, backspace is the browser's.
test('backspace elsewhere is an ordinary backspace', () => {
  const p = panel('abc', 3);
  let prevented = false;
  p.backspaceTag({ key: 'Backspace', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test('the input is wired to both', () => {
  assert.match(src, /commandInput\.addEventListener\('paste', onPasteImage\)/);
  assert.match(src, /backspaceTag\(e\);/);
});

test('its own image prompt is recognised when the loop echoes it', () => {
  const arm = src.slice(src.indexOf("case 'user_turn':"), src.indexOf("case 'turn_idle':"));
  assert.match(arm, /takeOwnEcho\(foldImageHeader\(content\)\)/);
});
