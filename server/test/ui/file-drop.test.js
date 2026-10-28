import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  splitPaths, recognizeDrop, describeDropped, fileTag, filesInText, filePromptBlock, foldFiles,
} from '../../src/ui/file-drop.js';
import { backspaceAt, foldImages } from '../../src/ui/image-attach.js';

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
