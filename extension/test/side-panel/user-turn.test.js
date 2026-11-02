/**
 * The panel draws prompts typed elsewhere, and not its own twice.
 *
 * Reported with a screenshot, 2026-10-26: replies to terminal prompts arrived
 * in the panel, the prompts never did. The loop now announces every user turn
 * (`user_turn`). The panel drew its own on send, so it has to recognise its
 * own coming back — by content, because the Chrome panel and the VS Code panel
 * run this same page and each must still draw the other's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const src = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../side-panel/panel.js'), 'utf8');

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

const arm = (label) => {
  const start = src.indexOf(`case '${label}':`);
  assert.ok(start > -1, `case '${label}' exists`);
  return src.slice(start, src.indexOf('\n    case ', start + 1));
};

const api = new Function(`const ownSends = [];
  ${take('takeOwnEcho')}
  ${take('foldImageHeader')}
  return { ownSends, takeOwnEcho, foldImageHeader };`)();

test('its own prompt comes back once and is skipped', () => {
  api.ownSends.push('fix the test');
  assert.equal(api.takeOwnEcho('fix the test'), true);
  // Control: a second, identical prompt from the terminal is still drawn.
  assert.equal(api.takeOwnEcho('fix the test'), false);
});

test('a prompt it never sent is drawn', () => {
  assert.equal(api.takeOwnEcho('typed in the terminal'), false);
});

test('a sent prompt is recorded as its own', () => {
  // Recorded when it is handed over, not when it is drawn: a queued message
  // is drawn at once and sent when the turn ends (1.59.0).
  const send = take('sendMessage');
  assert.ok(send.indexOf('dispatchMessage(content, outgoing)') > send.indexOf("appendMessage('user', content)"));
  assert.match(take('dispatchMessage'), /ownSends\.push\(shown\)/);
  assert.match(take('drainQueue'), /dispatchMessage\(next\.shown, next\.content\)/);
});

test('user_turn draws unless it is the panel\'s own', () => {
  const body = arm('user_turn');
  assert.match(body, /takeOwnEcho\(foldImageHeader\(content\)\)/);
  assert.match(body, /appendMessage\('user', foldImageHeader\(content\)\)/);
});

test('turn_idle ends the busy state, which a stopped turn has no other way to do', () => {
  const body = arm('turn_idle');
  assert.match(body, /removeThinking\(\)/);
  assert.match(body, /isWaitingForResponse = false/);
});

test('a recorded image prompt is folded to a tag', () => {
  const recorded = '[Image attached: /w/x.png (1KB, image/png)]\n\n'
    + '<image_data>(the image was delivered to the chat tab)</image_data>\n\nwhat is this';
  assert.equal(api.foldImageHeader(recorded), '[Image] what is this');
  assert.equal(api.foldImageHeader('plain'), 'plain');
});
