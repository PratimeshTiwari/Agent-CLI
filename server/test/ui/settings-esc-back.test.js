/**
 * Esc from a chooser opened on the settings page goes back to the page, and
 * only the next esc closes it (reported 2026-10-27 with Theme). A chooser
 * reached through `handleSubmit` cannot know the page is behind it, so every
 * row that opens one must open it here, with `returnTo`. Source assertions,
 * because the page is a closure inside `Menus.jsx`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/ui/components/Menus.jsx', import.meta.url), 'utf8');

test('every settings row that opens a chooser opens it with returnTo', () => {
  for (const run of ['/effort', '/startup', '/allowlist', '/skills', '/commands', '/theme', '/workspace']) {
    const at = src.indexOf(`picked.run === '${run}'`);
    assert.ok(at > 0, `${run} goes through handleSubmit and esc closes settings with it`);
    assert.match(src.slice(at, at + 400), /returnTo: back/, `${run} opens without returnTo`);
  }
});

test('esc on the theme picker puts the palette back and returns to settings', () => {
  const at = src.indexOf("if (activeMenu?.type === 'theme') {");
  const body = src.slice(at, src.indexOf('return;\n    }', at + 200) + 20);
  assert.match(body, /setTheme\(activeMenu\.original\)/);
  assert.match(body, /if \(activeMenu\.returnTo\) \{ setActiveMenu\(activeMenu\.returnTo\); return; \}/);
});

test('/doctor steps back one view before it closes', () => {
  assert.match(src, /activeMenu\.view === 'versions' \? 'package' : activeMenu\.view === 'error' \? activeMenu\.from \|\| 'home' : 'home'/);
});
