/**
 * The command approval box fits the rows it is given.
 *
 * It was charged as the input's three rows while drawing fifteen or more with
 * a long command, so at 16 rows the frame outgrew the terminal and cleared on
 * every render while the box was up — measured under the pty, 2026-10-26, 15
 * `ESC[2J` at 16 rows. `approvalLayout` decides every row; App charges them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { approvalLayout } from '../../src/frontend/transcript/live-layout.js';

const LONG = 'for i in 1 2 3; do echo LONGROW-$i; sleep 1; done; echo the-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps-going-well-past-eighty-columns';
const payload = { command: LONG, cwd: '/w/project', riskReason: 'Mutating shell command' };

test('with room, everything is shown, with the gap above the choices', () => {
  const l = approvalLayout(payload, { width: 80, maxRows: 40 });
  assert.equal(l.hidden, 0);
  assert.equal(l.command.length, 2, 'the long command is two rows at 80 columns');
  assert.ok(l.padded && l.cwd && l.reason);
  // rule, title, command ×2, directory, reason, gap, four choices
  assert.equal(l.rows, 1 + 1 + 2 + 1 + 1 + 1 + 4);
});

test('every command row fits inside the box, so none of them wraps', () => {
  const l = approvalLayout(payload, { width: 60, maxRows: 40 });
  for (const line of l.command) assert.ok(line.length <= 58, line);
  assert.equal(l.command.join('').replace(/\s+/g, ''), `Command:${LONG}`.replace(/\s+/g, ''), 'nothing lost between rows');
});

test('it never asks for more rows than it was given, down to the bare minimum', () => {
  for (let maxRows = 6; maxRows <= 20; maxRows++) {
    const l = approvalLayout(payload, { width: 80, maxRows });
    assert.ok(l.rows <= maxRows, `maxRows ${maxRows}: drew ${l.rows}`);
  }
});

test('padding, reason and directory go before the command does', () => {
  const l = approvalLayout(payload, { width: 80, maxRows: 9 });
  assert.equal(l.hidden, 0, 'the command is the thing being approved');
  assert.equal(l.rows, 9);
  assert.equal(l.padded, false);
  assert.equal(l.reason, false);
});

test('when even the command cannot fit, the title says what is cut', () => {
  const l = approvalLayout(payload, { width: 80, maxRows: 6 });
  assert.equal(l.ruled, false, 'the rule goes before the command does');
  assert.equal(l.command.length, 1);
  assert.equal(l.hidden, 1);
  const menus = readFileSync(new URL('../../src/frontend/components/Menus.jsx', import.meta.url), 'utf8');
  assert.match(menus, /more line\$\{approval\.hidden === 1 \? '' : 's'\} of the command not shown/);
});

// Control: a short command is one row, with everything around it.
test('a short command is one row', () => {
  const l = approvalLayout({ ...payload, command: 'npm test' }, { width: 80, maxRows: 40 });
  assert.deepEqual(l.command, ['Command: npm test']);
  assert.ok(l.padded && l.cwd && l.reason);
});

test('App charges the box against the live turn', () => {
  const app = readFileSync(new URL('../../src/frontend/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /approvalLayout\(activeMenu\.payload, \{ width: terminalWidth, maxRows: INPUT_ROWS \+ frameBudget - 1 \}\)/);
  assert.match(app, /const liveBudget = Math\.max\(1, frameBudget - \(approval \? Math\.max\(0, approval\.rows - INPUT_ROWS\) : 0\)\n\s+- \(menuMidTurn \? menuRows - INPUT_ROWS : 0\)\);/);
});
