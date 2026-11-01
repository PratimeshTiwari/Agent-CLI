/**
 * An image pasted into the side panel travels the same road as a terminal one.
 *
 * The panel sends `[Image #n: pasted] …` + `<image_data>`; the server writes the
 * file and puts its path in the header; the tab lifts the data out; the
 * transcript links the tag to the file. Each hop is a separate file in a
 * separate process, so this runs the panel's own block builder through the
 * server's and the bridge's real code rather than restating the format.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePastedImages } from '../../../../src/backend/core/turn/panel-images.js';
import { foldImages } from '../../../../src/frontend/input/image-attach.js';
import { stripImageData } from '../../../../src/backend/core/prompt/prompt-builder.js';

const panel = readFileSync(new URL('../../../../../extension/side-panel/panel.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../../../../../extension/content-scripts/gemini-bridge.js', import.meta.url), 'utf8');

function take(src, name) {
  const from = src.indexOf(`function ${name}(`);
  assert.ok(from > -1, `${name} is in the panel`);
  let depth = 0;
  for (let i = src.indexOf('{', from); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error(`${name} never closed`);
}

const PNG = 'iVBORw0KGgo=';
const panelBlock = new Function('pastedImages', `const imageTag = (n) => \`[Image #\${n}]\`;
  ${take(panel, 'imageBlock')}
  return imageBlock;`);

test('a panel image is saved, linked, and lifted by the tab', () => {
  const ws = mkdtempSync(join(tmpdir(), 'panel-img-'));
  try {
    const images = [{ n: 1, dataUrl: `data:image/png;base64,${PNG}`, mime: 'image/png', sizeKB: 1 }];
    const { block, used } = panelBlock(images)('what is [Image #1]');
    assert.equal(used.length, 1);
    const sent = savePastedImages(`${block}what is [Image #1]`, ws);

    const { text, links } = foldImages(stripImageData(sent));
    assert.equal(text, 'what is [Image #1]');
    const file = links.get(1);
    assert.ok(file && file.startsWith(join(ws, '.agent', 'tmp')), file);
    assert.ok(existsSync(file), 'the file was written');
    assert.deepEqual(readFileSync(file), Buffer.from(PNG, 'base64'));

    const re = new Function(`return ${/const IMAGE_BLOCK = (\/.*\/g);/.exec(bridge)[1]};`)();
    const lifted = [...sent.matchAll(re)].map((m) => m[1]);
    assert.deepEqual(lifted, [`data:image/png;base64,${PNG}`], 'the tab finds the data');
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// Control: an image whose tag was deleted does not go.
test('only images whose tags are in the text go', () => {
  const images = [{ n: 1, dataUrl: 'data:image/png;base64,AA==', mime: 'image/png', sizeKB: 1 }];
  assert.deepEqual(panelBlock(images)('never mind'), { used: [], block: '' });
});

// Control: a terminal prompt, whose header already names a file, is untouched.
test('a message with no pasted image is passed through as it came', () => {
  const t = '[Image #2: /w/.agent/tmp/clipboard-1.png] (3KB, image/png)\n<image_data>\ndata:image/png;base64,AA==\n</image_data>\n\nhi';
  assert.equal(savePastedImages(t, '/nonexistent'), t);
  assert.equal(savePastedImages('plain', '/nonexistent'), 'plain');
});

test('the server saves them before the loop sees the message', () => {
  const server = readFileSync(new URL('../../../../src/backend/bridge/websocket-server.js', import.meta.url), 'utf8');
  assert.match(server, /handleUserMessage\(savePastedImages\(content, this\.agentLoop\.workspace\), callbacks\)/);
});
