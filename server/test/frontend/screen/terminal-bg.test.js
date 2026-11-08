/**
 * amoled paints the terminal's own background (v9.9.1). Reported from
 * Antigravity: every ink changed and the page stayed grey, because Ink never
 * paints the page. OSC 11 sets it, OSC 111 hands it back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  backgroundStep, installTerminalBackground, restoreTerminalBackground, _resetTerminalBackground,
  setBackground, RESET_BACKGROUND,
} from '../../../src/frontend/screen/terminal-bg.js';
import { setTheme, PALETTE_INFO } from '../../../src/frontend/theme.js';

const tty = () => { const w = []; return { isTTY: true, write: (s) => { w.push(s); return true; }, w }; };

test('only a palette that names paint sets the page, and leaving it hands it back once', () => {
  assert.equal(PALETTE_INFO.amoled.paint, '#000000');
  assert.deepEqual(backgroundStep('amoled', null), { write: '\x1b]11;#000000\x1b\\', painted: '#000000' });
  assert.deepEqual(backgroundStep('amoled', '#000000'), { write: '', painted: '#000000' }, 'already black: nothing');
  assert.deepEqual(backgroundStep('dark', '#000000'), { write: RESET_BACKGROUND, painted: null });
  assert.deepEqual(backgroundStep('dark', null), { write: '', painted: null }, 'control: never painted, never reset');
  for (const [name, info] of Object.entries(PALETTE_INFO)) {
    if (name !== 'amoled') assert.equal(info.paint, undefined, `${name} must leave the terminal's page alone`);
  }
});

test('installed, it follows every switch, previews included, and exit restores it', () => {
  _resetTerminalBackground();
  const out = tty();
  try {
    setTheme('terminal');
    installTerminalBackground(out);
    assert.deepEqual(out.w, [], 'terminal at start: nothing written');
    setTheme('amoled');
    setTheme('dark-colorblind');
    setTheme('amoled');
    assert.deepEqual(out.w, [setBackground('#000000'), RESET_BACKGROUND, setBackground('#000000')]);
    assert.equal(restoreTerminalBackground({ write: false }), RESET_BACKGROUND, 'exit gets the reset to put first');
    assert.equal(restoreTerminalBackground({ write: false }), '', 'and only once');
  } finally {
    setTheme('terminal');
    _resetTerminalBackground();
  }
});

test('a pipe gets no escape codes', () => {
  _resetTerminalBackground();
  const out = { isTTY: false, write: () => { throw new Error('wrote to a pipe'); } };
  try {
    installTerminalBackground(out);
    setTheme('amoled');
  } finally {
    setTheme('terminal');
    _resetTerminalBackground();
  }
});

test('startup installs it after the saved theme, and the farewell writes the reset first (source)', () => {
  const ui = readFileSync(new URL('../../../src/frontend/cli-ui.jsx', import.meta.url), 'utf8');
  assert.ok(ui.indexOf('installTerminalBackground(') > ui.indexOf('setTheme(startupTheme('));
  const bye = readFileSync(new URL('../../../src/frontend/screen/farewell.js', import.meta.url), 'utf8');
  assert.match(bye, /restoreTerminalBackground\(\{ write: false \}\) \+ exitText\(/);
});
