/**
 * Files dropped on the side panel (v6.17, plan Phase 8).
 *
 * Chrome gives the page the file and never its path: an image goes in as a
 * pasted one, a text file up to 8 KB goes in whole, anything larger is
 * refused. VS Code passes `text/uri-list` for a file from the explorer, so the
 * path is sent, as the terminal sends it.
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
const constant = (name) => {
  const m = new RegExp(`const ${name} = [^\\n]*\\n`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return m[0];
};

function panel(value = '', caret = value.length) {
  const { window } = new JSDOM('<textarea id="c"></textarea>');
  const commandInput = window.document.getElementById('c');
  commandInput.value = value;
  commandInput.setSelectionRange(caret, caret);
  const statuses = [];
  const api = new Function('commandInput', 'FileReader', 'Event', 'appendStatus', `
    let pastedImages = []; let pastedCount = 0; let droppedFiles = []; let droppedCount = 0;
    const imageTag = (n) => \`[Image #\${n}]\`;
    ${constant('DROP_INLINE_MAX')} ${constant('fileTag')} ${constant('baseName')}
    ${take('insertAtCaret')} ${take('addImage')} ${take('droppedPaths')} ${take('addFileTag')}
    ${take('attachFiles')} ${take('onDropFiles')} ${take('backspaceTag')} ${take('fileBlock')}
    return { onDropFiles, backspaceTag, fileBlock, droppedPaths, images: () => pastedImages, files: () => droppedFiles };`)(
    commandInput, window.FileReader, window.Event, (t) => statuses.push(t));
  return { window, commandInput, statuses, ...api };
}

const drop = ({ files = [], uriList = '' } = {}) => {
  let prevented = false;
  return {
    e: { dataTransfer: { files, getData: (t) => (t === 'text/uri-list' ? uriList : '') }, preventDefault: () => { prevented = true; } },
    prevented: () => prevented,
  };
};
const until = async (fn) => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
};

test('Chrome: a small text file goes in whole, behind a tag', async () => {
  const p = panel('explain ', 8);
  const file = new p.window.File(['const a = 1;\nconst b = 2;\n'], 'a.js', { type: 'text/javascript' });
  const ev = drop({ files: [file] });
  p.onDropFiles(ev.e);
  assert.equal(ev.prevented(), true);
  await until(() => p.commandInput.value.includes('[File'));
  assert.equal(p.commandInput.value, 'explain [File #1: a.js] ');
  const { block, used } = p.fileBlock(p.commandInput.value);
  assert.equal(used.length, 1);
  assert.equal(block, '[File #1: a.js] (1 KB, 2 lines, dropped in the panel) — its text follows\n\n'
    + '<file name="a.js">\nconst a = 1;\nconst b = 2;\n</file>\n\n');
});

test('Chrome: an image goes in as a pasted one would', async () => {
  const p = panel('');
  const file = new p.window.File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
  p.onDropFiles(drop({ files: [file] }).e);
  await until(() => p.commandInput.value.includes('[Image'));
  assert.equal(p.commandInput.value, '[Image #1] ');
  assert.equal(p.files().length, 0);
});

test('Chrome: over 8 KB is refused, and says where it works', () => {
  const p = panel('');
  const file = new p.window.File(['x'.repeat(9000)], 'big.log', { type: 'text/plain' });
  p.onDropFiles(drop({ files: [file] }).e);
  assert.equal(p.commandInput.value, '');
  assert.match(p.statuses[0], /big\.log is 9 KB — too large to drop here\. Drop it in the terminal, which can send the path\./);
});

test('Chrome: a binary file is refused', async () => {
  const p = panel('');
  const file = new p.window.File([new Uint8Array([1, 0, 2, 0])], 'x.bin', { type: '' });
  p.onDropFiles(drop({ files: [file] }).e);
  await until(() => p.statuses.length);
  assert.match(p.statuses[0], /x\.bin is not a text file/);
  assert.equal(p.files().length, 0);
});

test('VS Code: a uri-list sends the path, and reads nothing', () => {
  const p = panel('');
  const file = new p.window.File(['ignored'], 'x.js');
  p.onDropFiles(drop({ files: [file], uriList: '# comment\nfile:///Users/me/repo/src/my%20file.js\r\nhttps://example.com/x' }).e);
  assert.equal(p.commandInput.value, '[File #1: my file.js] ');
  const { block } = p.fileBlock(p.commandInput.value);
  assert.equal(block, '[File #1: /Users/me/repo/src/my file.js] (dropped from the editor) — read it with read_file\n\n');
  assert.deepEqual(p.droppedPaths('file:///C:/repo/a.js'), ['C:/repo/a.js'], 'a Windows path loses its leading slash');
});

test('control: a drag of plain text is the browser\'s', () => {
  const p = panel('');
  const ev = drop({ files: [] });
  p.onDropFiles(ev.e);
  assert.equal(ev.prevented(), false);
});

test('a file goes only while its tag is in the text, and backspace takes the tag', () => {
  const p = panel('');
  p.onDropFiles(drop({ uriList: 'file:///a/one.js\nfile:///a/two.js' }).e);
  assert.equal(p.commandInput.value, '[File #1: one.js] [File #2: two.js] ');
  let prevented = false;
  p.backspaceTag({ key: 'Backspace', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(p.commandInput.value, '[File #1: one.js] ');
  const { used, block } = p.fileBlock(p.commandInput.value);
  assert.deepEqual(used.map((f) => f.n), [1]);
  assert.doesNotMatch(block, /two\.js/);
});

test('send puts images, then file headers, then the message', () => {
  // Built in sendMessage, sent by dispatchMessage (1.59.0: a queued one is sent later).
  const send = take('sendMessage');
  assert.match(send, /const outgoing = block \+ dropped\.block \+ content;/);
  assert.match(send, /dispatchMessage\(content, outgoing\)/);
  assert.match(take('dispatchMessage'), /payload: \{ content: outgoing \}/);
  assert.match(src, /document\.addEventListener\('drop'/);
  assert.match(src, /document\.addEventListener\('dragover'[\s\S]*?e\.preventDefault\(\)/, 'without it the browser never fires drop');
});
