/**
 * Components name a colour's role, never the colour.
 *
 * About 86 colour props named ANSI colours directly, and cyan and yellow had
 * come to mean ten things between them. `ui/theme.js` holds the palettes; this
 * fails on a literal so the next one cannot slip back in — a theme that misses
 * one call site is a theme with one row stuck in the old colours.
 *
 * Source assertions, because the components are JSX, which the repo's plain
 * `node --test` cannot import (CLAUDE.md, the live-reply budget note).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PALETTES, ROLES, T, setTheme, themeName, modeColor, DEFAULT_THEME } from '../../src/ui/theme.js';

const UI = new URL('../../src/ui/', import.meta.url).pathname;
const files = [
  ...readdirSync(UI).filter((f) => f.endsWith('.jsx')).map((f) => join(UI, f)),
  ...readdirSync(join(UI, 'components')).filter((f) => f.endsWith('.jsx')).map((f) => join(UI, 'components', f)),
];
const NAMED = 'black|red|green|yellow|blue|magenta|cyan|white|gray|grey|redBright|greenBright|yellowBright|blueBright|magentaBright|cyanBright|whiteBright|blackBright';
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no component names a colour', () => {
  const literal = new RegExp(`\\b(color|borderColor|backgroundColor)=(["'])(${NAMED}|#[0-9a-fA-F]{3,8})\\2`);
  // A quoted colour as a value inside an expression: `x ? 'cyan' : 'gray'`, `color = 'cyan'`.
  const inExpr = new RegExp(`(\\?|:|=|\\()\\s*(["'])(${NAMED})\\2`);
  const offenders = [];
  for (const f of files) {
    strip(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
      if (literal.test(line) || inExpr.test(line)) offenders.push(`${f.slice(UI.length)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'use a role from ui/theme.js (T.accent, T.attention, …)');
});

test('negative control: the check sees the shapes it bans', () => {
  const literal = new RegExp(`\\b(color|borderColor|backgroundColor)=(["'])(${NAMED}|#[0-9a-fA-F]{3,8})\\2`);
  const inExpr = new RegExp(`(\\?|:|=|\\()\\s*(["'])(${NAMED})\\2`);
  assert.ok(literal.test('<Text color="cyan">'));
  assert.ok(literal.test('<Text backgroundColor="#303030">'));
  assert.ok(inExpr.test("color={on ? 'cyan' : 'gray'}"));
  assert.ok(inExpr.test("function Dots({ color = 'cyan' })"));
  assert.ok(!literal.test('<Text color={T.accent}>'));
});

test('every palette defines every role', () => {
  for (const [name, palette] of Object.entries(PALETTES)) {
    for (const role of ROLES) assert.ok(palette[role], `${name}.${role}`);
    for (const key of Object.keys(palette)) assert.ok(ROLES.includes(key), `${name}.${key} is not a role`);
  }
});

test('terminal is today\'s look: the colours the call sites used before', () => {
  const p = PALETTES.terminal;
  assert.equal(DEFAULT_THEME, 'terminal');
  assert.deepEqual([p.accent, p.attention, p.success, p.danger, p.muted], ['cyan', 'yellow', 'green', 'red', 'gray']);
  assert.deepEqual([p.plan, p.auto, p.strict], ['yellow', 'cyan', 'magenta']);
  assert.equal(p.userBg, '#303030');
});

test('setTheme replaces the live palette in place, and refuses unknown names', () => {
  const before = { ...T };
  assert.equal(setTheme('no-such-theme'), false);
  assert.deepEqual({ ...T }, before, 'an unknown theme must not half-apply');
  PALETTES.__probe = { ...PALETTES.terminal, accent: '#123456', plan: '#abcdef' };
  try {
    const ref = T;
    assert.equal(setTheme('__probe'), true);
    assert.equal(T, ref, 'components hold this object; it must be mutated, not replaced');
    assert.equal(T.accent, '#123456');
    assert.equal(modeColor('plan'), '#abcdef', 'modeColor reads the live palette');
    assert.equal(themeName(), '__probe');
  } finally {
    delete PALETTES.__probe;
    setTheme('terminal');
  }
});
