import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromeLine, loadSteps, profileItems } from '../../src/frontend/menus/chrome-view.js';
import { statusBarLayout } from '../../src/frontend/screen/status-bar.js';

const P = [{ dir: 'Profile 2', name: 'Work', email: 'w@x.com', hasExtension: true }, { dir: 'Default', name: 'Main', email: '', hasExtension: false }];

test('the list: Any first, and the current one marked', () => {
  const items = profileItems(P, null);
  assert.deepEqual(items.map((i) => [i.label, i.value, Boolean(i.current)]), [['Any profile', '', true], ['Work', 'Profile 2', false], ['Main', 'Default', false]]);
  assert.equal(items[1].detail, 'w@x.com · has the extension');
  const bound = profileItems(P, { dir: 'Default' });
  assert.deepEqual(bound.map((i) => Boolean(i.current)), [false, false, true]);
  assert.equal(new Set(items.map((i) => i.key ?? i.value)).size, items.length, 'every row its own React key');
});

test('the line says what a choice means', () => {
  assert.match(chromeLine(null), /one profile/);
  assert.match(chromeLine({ name: 'Work' }), /Only Work.*wait/);
  assert.match(loadSteps('/x/extension')[1], /\/x\/extension/);
});

test('a start with a chosen profile opens that one, never the default browser', () => {
  const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const at = main.indexOf('const chosen = agentLoop.browserProfile.current;');
  assert.ok(at > 0 && at < main.indexOf("exec(`open \"${startUrl}\"`)"));
  assert.match(main.slice(at, at + 240), /if \(chosen\) openChromeProfile\(chosen\.dir, startUrl\);\s+else if \(process\.platform === 'darwin'\)/);
});

test('the status bar names the profile, shortly, and gives it up before the model', () => {
  const name = 'somebody.long@example.com';
  const wide = statusBarLayout({ width: 100, mode: 'plan', profile: name, model: '3.8 Flash' });
  const text = (l) => [...l.left, ...l.right].map((s) => s.text).join('');
  assert.ok(text(wide).includes('somebody.long@exa…'), text(wide));
  const narrow = statusBarLayout({ width: 42, mode: 'plan', profile: name, model: '3.8 Flash', pct: 30 });
  assert.ok(!text(narrow).includes('somebody'), text(narrow));
  assert.ok(text(narrow).includes('30%') && text(narrow).includes('3.8 Flash'), `the context and model outlast it: ${text(narrow)}`);
  assert.ok(!text(statusBarLayout({ width: 100, mode: 'plan', model: 'x' })).includes('·  ·'));
});
