import test from 'node:test';
import assert from 'node:assert/strict';
import { tabUnreachableMessage } from '../../src/bridge/tab-failure.js';

test('says the tab was reloaded, gives the key from here, never Cmd+Shift+R', () => {
  const text = tabUnreachableMessage({ detail: '[send_button] Send button never became active' }, { kept: true });
  assert.match(text, /even after reloading it \(\[send_button\] Send button never became active\)/);
  assert.match(text, /ctrl\+b brings the tab up/);
  assert.match(text, /Your message is kept/);
  assert.doesNotMatch(text, /Cmd\+Shift\+R|Hard-refresh/);
});

test("an older extension's empty reason is left out, and so is 'kept' when nothing was", () => {
  const text = tabUnreachableMessage({ detail: 'Content script reported failure' });
  assert.doesNotMatch(text, /Content script|\(/);
  assert.doesNotMatch(text, /kept/);
});
