/**
 * A relaunch never opens Gemini (v9.9.9.5).
 *
 * The start opened https://gemini.google.com/app when no extension greeted it
 * within 1.5 s. After `/update` or `/restart` the extension is on its
 * reconnect backoff and takes longer, so every relaunch opened a tab the
 * extension does not own, beside the one it does. The supervisor now says it
 * is a relaunch, and the greeting waits instead. Source assertions: the
 * greeting runs inside `main()`, which a test cannot start without a pty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(`../../../../src/${p}`, import.meta.url), 'utf8');

test('the supervisor marks every start after the first as a relaunch', () => {
  assert.match(src('index.js'), /AGENT_CLI_RESTARTED: restarts > 0 \? '1' : ''/);
});

test('a relaunch returns before anything is opened, and the mark is not inherited', () => {
  const main = src('main.js');
  const greet = main.slice(main.indexOf('const greetExtension = async'));
  const skip = greet.indexOf('if (relaunched) return;');
  assert.ok(skip > 0, 'no relaunch check in the greeting');
  assert.ok(skip < greet.indexOf('openChromeProfile('), 'checked after a profile is opened');
  assert.ok(skip < greet.indexOf('exec(`open'), 'checked after Gemini is opened');
  assert.match(main, /delete process\.env\.AGENT_CLI_RESTARTED/);
});
