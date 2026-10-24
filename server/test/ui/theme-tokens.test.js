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
import { PALETTES, PALETTE_INFO, ROLES, T, setTheme, themeName, modeColor, DEFAULT_THEME, startupTheme } from '../../src/ui/theme.js';

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
    for (const role of ROLES) assert.ok(role in palette && palette[role] !== undefined, `${name}.${role}`);
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

/** WCAG relative luminance and contrast ratio. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('every palette reads: 4.5:1 for words, 3:1 for detail', () => {
  const failures = [];
  for (const [name, palette] of Object.entries(PALETTES)) {
    const bg = PALETTE_INFO[name]?.background;
    if (!bg) continue; // the terminal's own colours, or none
    for (const role of ROLES) {
      if (role === 'userBg') continue;
      const against = role === 'userFg' ? palette.userBg : bg;
      const need = role === 'muted' ? 3 : 4.5;
      const got = contrast(palette[role], against);
      if (got < need) failures.push(`${name}.${role} ${palette[role]} on ${against}: ${got.toFixed(2)} < ${need}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('every palette has picker text, and every entry there is a palette', () => {
  assert.deepEqual(Object.keys(PALETTE_INFO).sort(), Object.keys(PALETTES).sort());
});

test('NO_COLOR wins, then the saved choice, then the default', () => {
  assert.equal(startupTheme({ NO_COLOR: '1' }, 'dark'), 'mono');
  assert.equal(startupTheme({ NO_COLOR: '' }, 'dark'), 'dark', 'an empty NO_COLOR is unset (no-color.org)');
  assert.equal(startupTheme({}, 'light'), 'light');
  assert.equal(startupTheme({}, 'no-such'), DEFAULT_THEME, 'a stale saved name must not leave the palette half-set');
  assert.equal(startupTheme({}, null), DEFAULT_THEME);
});

test('negative control: the contrast check fails what it should', () => {
  assert.ok(contrast('#777777', '#888888') < 3);
  assert.ok(contrast('#ffffff', '#000000') > 20);
});
