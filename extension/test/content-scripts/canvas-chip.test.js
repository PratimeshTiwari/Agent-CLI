/**
 * A Canvas chip is scraped as a marker with its title (v9.9.4).
 *
 * Read live on the test account: Gemini writes a Canvas document into an
 * iframe beside the reply and leaves `<immersive-entry-chip>` in it, whose text
 * is the title followed by its buttons ("Code", "Preview", "Export"). The
 * scrape read that as prose, so the agent saw a title and three labels.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadFunction } from '../load-content-script.js';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../content-scripts/gemini-bridge.js');
const CANVAS_LABELS = /(?:\s*(?:Code|Preview|Export|Share|Open|Close))+\s*$/;

function scrape(html) {
  const { document, Node } = new JSDOM(`<body><response-element>${html}</response-element></body>`).window;
  const canvasTitle = loadFunction(SCRIPT, 'canvasTitle', { CANVAS_LABELS });
  const canvasMarker = loadFunction(SCRIPT, 'canvasMarker', {});
  const extract = loadFunction(SCRIPT, 'extractTextContent', { document, Node, canvasTitle, canvasMarker });
  return extract(document.querySelector('response-element'));
}

const CHIP = '<immersive-entry-chip><div><span>Fruit Stand Design Document</span>'
  + '<button>Code</button><button>Preview</button><button>Export</button></div></immersive-entry-chip>'
  + '<inline-preview><web-preview><iframe></iframe>Loading preview</web-preview></inline-preview>';

test('the chip becomes one marker naming the document, and the preview says nothing', () => {
  const out = scrape(`<p>I will now generate the design document.</p>${CHIP}<p>Done.</p>`);
  assert.match(out, /\[Gemini Canvas: "Fruit Stand Design Document" — written in Gemini's Canvas, not in this reply\]/);
  assert.doesNotMatch(out, /Loading preview|Export/);
  assert.match(out, /I will now generate[\s\S]*Gemini Canvas[\s\S]*Done\./);
});

test('labels written into the title by textContent are cut off its end', () => {
  // jsdom has no innerText, and the buttons' labels are welded on: the live shape without line breaks.
  const out = scrape('<immersive-entry-chip>Plan v2CodePreviewExport</immersive-entry-chip>');
  assert.match(out, /"Plan v2"/);
});

test('control: a reply with no chip has no marker', () => {
  assert.doesNotMatch(scrape('<p>Canvas is a Gemini feature.</p>'), /\[Gemini Canvas/);
});

test('with line breaks the first line is the title, whole', () => {
  const canvasTitle = loadFunction(SCRIPT, 'canvasTitle', { CANVAS_LABELS });
  assert.equal(canvasTitle({ innerText: 'Source Code\nCode\nPreview\nExport' }), 'Source Code');
  assert.equal(canvasTitle({ innerText: '' }), 'untitled');
});
