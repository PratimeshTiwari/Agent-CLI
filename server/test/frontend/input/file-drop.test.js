import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  splitPaths, recognizeDrop, describeDropped, fileTag, filesInText, filePromptBlock, foldFiles,
} from '../../../src/frontend/input/file-drop.js';
import { backspaceAt, foldImages } from '../../../src/frontend/input/image-attach.js';

/*
 * A drop on a terminal is a paste of paths (v5.33). These pin what counts as
 * one, and that only the path — never the content — goes to the model.
 */

function tree(t) {
  const root = mkdtempSync(join(tmpdir(), 'drop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'My Folder'));
  writeFileSync(join(root, 'My Folder', 'notes.md'), 'a\nb\nc\n');
  writeFileSync(join(root, 'shot.png'), 'PNG');
  writeFileSync(join(root, 'app.js'), 'x\n'.repeat(4980));
  writeFileSync(join(root, 'blob.bin'), Buffer.from([1, 0, 2, 0]));
  return root;
}

test('shell-style splitting: escapes, quotes, several paths', () => {
  assert.deepEqual(splitPaths('/a/My\\ File.png /b/c.js'), ['/a/My File.png', '/b/c.js']);
  assert.deepEqual(splitPaths("'/a/My File.png' \"/b/x y.js\""), ['/a/My File.png', '/b/x y.js']);
  assert.deepEqual(splitPaths('/a\n/b\n'), ['/a', '/b']);
  assert.equal(splitPaths("'/unterminated"), null);
});

test('a paste of existing absolute paths is a drop, with each kind told apart', (t) => {
  const root = tree(t);
  const text = `${join(root, 'My Folder').replace(/ /g, '\\ ')} '${join(root, 'shot.png')}' ${pathToFileURL(join(root, 'app.js')).href}`;
  assert.deepEqual(recognizeDrop(text)?.map((i) => i.kind), ['folder', 'image', 'file']);
  assert.equal(recognizeDrop(`~/${'x'}`, { home: root, statSync: () => ({ isDirectory: () => false }) })?.[0].path, join(root, 'x'));
});

test('text stays text: a relative word, a sentence with a path, a path that is not there', (t) => {
  const root = tree(t);
  assert.equal(recognizeDrop('app.js'), null, 'relative: pasting a file name into a sentence');
  assert.equal(recognizeDrop(`look at ${join(root, 'app.js')}`), null);
  assert.equal(recognizeDrop(join(root, 'nope.js')), null);
  assert.equal(recognizeDrop(''), null);
});

test('only the path and its size go to the model, never the content', (t) => {
  const root = tree(t);
  const file = describeDropped({ path: join(root, 'app.js'), kind: 'file' });
  const folder = describeDropped({ path: join(root, 'My Folder'), kind: 'folder' });
  const bin = describeDropped({ path: join(root, 'blob.bin'), kind: 'file' });
  assert.equal(file.lines, 4980);
  assert.equal(bin.lines, undefined, 'no line count for binary');
  const block = filePromptBlock([file, folder, bin], root);
  assert.match(block, new RegExp(`^\\[File #${file.n}: app\\.js\\] \\(10 KB, 4,980 lines\\) — read it with read_file$`, 'm'));
  assert.match(block, new RegExp(`^\\[Folder #${folder.n}: My Folder\\] \\(1 entry\\) — list it with list_directory$`, 'm'));
  assert.doesNotMatch(block, /x\nx\n/, 'no file content');
  assert.match(filePromptBlock([file], join(root, 'elsewhere')), /outside the workspace/);
});

test('a file goes only while its tag is in the text; backspace takes a tag in one press', (t) => {
  const root = tree(t);
  const f = describeDropped({ path: join(root, 'app.js'), kind: 'file' });
  const g = describeDropped({ path: join(root, 'My Folder'), kind: 'folder' });
  const text = `explain ${fileTag(f)} and ${fileTag(g)} `;
  assert.deepEqual(filesInText(text, [f, g]), [f, g]);
  const after = backspaceAt(text, text.length);
  assert.equal(after.value, `explain ${fileTag(f)} and `);
  assert.deepEqual(filesInText(after.value, [f, g]), [f]);
  // Control: ordinary text still loses one character.
  assert.equal(backspaceAt('abc', 3).value, 'ab');
});

test('the recorded prompt folds back to the text plus a row per file, after any images', (t) => {
  const root = tree(t);
  const f = describeDropped({ path: join(root, 'app.js'), kind: 'file' });
  const record = '[Image #3: /tmp/s.png] (1KB, image/png)\n<image_data>[image data omitted]</image_data>\n'
    + filePromptBlock([f], root) + `what does ${fileTag(f)} do?`;
  const img = foldImages(record);
  const { text, files } = foldFiles(img.text, root);
  assert.equal(text, `what does ${fileTag(f)} do?`);
  assert.deepEqual(files, [{ kind: 'file', n: f.n, path: join(root, 'app.js') }]);
  assert.deepEqual([...img.links.keys()], [3]);
});

test('a panel-dropped file folds to its tag, and its inline text is not drawn (v6.17)', async () => {
  const { foldFiles } = await import('../../../src/frontend/input/file-drop.js');
  const sent = '[File #1: a.js] (1 KB, 2 lines, dropped in the panel) — its text follows\n\n'
    + '<file name="a.js">\nconst a = 1;\nconst b = 2;\n</file>\n\nexplain [File #1: a.js]';
  const { text, files } = foldFiles(sent, '/ws');
  assert.equal(text, 'explain [File #1: a.js]');
  assert.deepEqual(files.map((f) => f.n), [1]);
  // Control: a message that merely mentions <file> is left alone.
  assert.equal(foldFiles('<file name="x">\ny\n</file>').text, '<file name="x">\ny\n</file>');
});

// v6.23: VS Code's terminal types a dropped path in, with no paste markers.
import { asBracketedDrop } from '../../../src/frontend/input/file-drop.js';

test('asBracketedDrop: a chunk that is only existing paths is a drop; anything else is typing', () => {
  const statSync = (p) => {
    if (p === '/Users/me/x.jsonl') return { isDirectory: () => false };
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  assert.equal(asBracketedDrop("'/Users/me/x.jsonl' ", { statSync }), "\x1b[200~'/Users/me/x.jsonl'\x1b[201~");
  assert.equal(asBracketedDrop('/Users/me/x.jsonl', { statSync }), '\x1b[200~/Users/me/x.jsonl\x1b[201~');
  // Controls: a slash command, a path that does not exist, a sentence, one key.
  assert.equal(asBracketedDrop('/help', { statSync }), null);
  assert.equal(asBracketedDrop("'/Users/me/gone.jsonl'", { statSync }), null);
  assert.equal(asBracketedDrop('look at /Users/me/x.jsonl', { statSync }), null);
  assert.equal(asBracketedDrop('/', { statSync }), null);
  assert.equal(asBracketedDrop('\x1b[A', { statSync }), null);
});

import { createDropJoiner, PTY_CHUNK } from '../../../src/frontend/input/file-drop.js';

// VS Code's `chunkInput` (ptyHostMain), as shipped: pieces of at most 50, and
// a cut before every ESC.
function vscodeChunks(e) {
  const t = []; let E = 0;
  for (let n = 0; n < e.length - 1; n++) {
    if (n - E + 1 >= 50 || e[n + 1] === '\x1b') { t.push(e.substring(E, n + 1)); E = n + 1; n++; }
  }
  if (E !== e.length) t.push(e.substring(E));
  return t;
}

function joinerUnderTest() {
  const out = [];
  let pending = null;
  const joiner = createDropJoiner({
    deliver: (s) => out.push(s),
    setTimer: (fn) => { pending = fn; return 1; },
    clearTimer: () => { pending = null; },
  });
  return { out, joiner, fire: () => { const fn = pending; pending = null; fn?.(); } };
}

test('createDropJoiner: a path VS Code typed in pieces is delivered whole (v6.25)', () => {
  const drop = "'/Users/me/Documents/Gemini-Agent/.agent/logs/tool-usage-2026-10-30.jsonl' ";
  const pieces = vscodeChunks(drop);
  assert.ok(pieces.length > 1 && pieces[0].length === PTY_CHUNK, 'the fixture really is split');
  const { out, joiner } = joinerUnderTest();
  for (const p of pieces) joiner.accept(p);
  assert.deepEqual(out, [drop]);
  const statSync = (p) => (p.endsWith('.jsonl') ? { isDirectory: () => false } : null);
  assert.match(asBracketedDrop(out[0], { statSync }), /^\x1b\[200~/);
});

test('createDropJoiner: typing, a short drop and escapes pass straight through', () => {
  const { out, joiner } = joinerUnderTest();
  for (const k of ['/', 'h', 'e', 'l', 'p', '\r']) joiner.accept(k);
  joiner.accept('/Users/me/Downloads/Flow-v1.6.1297.dmg');
  joiner.accept('x'.repeat(PTY_CHUNK)); // fifty characters that are not a path
  joiner.accept('\x1b[A');
  assert.deepEqual(out, ['/', 'h', 'e', 'l', 'p', '\r', '/Users/me/Downloads/Flow-v1.6.1297.dmg', 'x'.repeat(PTY_CHUNK), '\x1b[A']);
});

test('createDropJoiner: held text is never lost or reordered', () => {
  const head = '/' + 'a'.repeat(PTY_CHUNK - 1);
  // An escape after a held piece: the piece first, then the escape.
  let t = joinerUnderTest();
  t.joiner.accept(head);
  assert.deepEqual(t.out, [], 'held');
  t.joiner.accept('\x1b[B');
  assert.deepEqual(t.out, [head, '\x1b[B']);
  // A drop that is exactly two pieces long ends on the quiet timer.
  t = joinerUnderTest();
  t.joiner.accept(head);
  t.joiner.accept('b'.repeat(PTY_CHUNK));
  assert.deepEqual(t.out, []);
  t.fire();
  assert.deepEqual(t.out, [head + 'b'.repeat(PTY_CHUNK)]);
});
