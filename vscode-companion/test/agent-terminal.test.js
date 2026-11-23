/**
 * The agent started from the sidebar, in a hidden terminal (1.9.0).
 *
 * Owner, 2026-11-23: "instead of starting in a visible terminal, should have a
 * button start agent and it should start in a terminal hidden from user view
 * like claude code sidebar".
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentTerminal, launchSpec, failureText, NOT_FOUND } = require('../agent-terminal.js');

function fakeVscode() {
  const made = [];
  let onClose = null;
  const vscode = {
    window: {
      createTerminal: (o) => {
        const t = { options: o, shown: 0, typed: [], show() { t.shown++; }, sendText(s) { t.typed.push(s); } };
        made.push(t);
        return t;
      },
      onDidCloseTerminal: (fn) => { onClose = fn; return { dispose() {} }; },
    },
  };
  return { vscode, made, close: (t, code) => { t.exitStatus = { code }; onClose(t); } };
}

test('Start agent opens one hidden terminal that runs agent in the folder', () => {
  const { vscode, made } = fakeVscode();
  const term = createAgentTerminal(vscode);
  assert.equal(term.start('/repo'), true);
  assert.equal(made.length, 1);
  const o = made[0].options;
  assert.equal(o.hideFromUser, true, 'shown to the person');
  assert.equal(o.cwd, '/repo');
  assert.equal(o.isTransient, true, 'restored into the next window as a second agent');
  if (process.platform !== 'win32') assert.deepEqual(o.shellArgs, ['-lic', 'exec agent']);
  assert.equal(made[0].shown, 0, 'revealed');
  assert.equal(term.start('/repo'), false, 'a second agent');
  assert.equal(made.length, 1);
});

test('Show terminal brings it up; nothing to show when none was started', () => {
  const { vscode, made } = fakeVscode();
  const term = createAgentTerminal(vscode);
  assert.equal(term.show(), false);
  term.start('/repo');
  assert.equal(term.show(), true);
  assert.equal(made[0].shown, 1);
});

test('an agent that never connected says why; one that did, does not', () => {
  const { vscode, made, close } = fakeVscode();
  const failed = [];
  const term = createAgentTerminal(vscode, { onFailed: (m, c) => failed.push([m, c]) });
  term.start('/repo');
  close(made[0], NOT_FOUND);
  assert.equal(failed.length, 1);
  assert.match(failed[0][0], /`agent` was not found.*setup\.sh/);
  assert.equal(term.running, false);

  term.start('/repo');
  term.noteConnected();
  close(made[1], 1);
  assert.equal(failed.length, 1, 'a quit after it ran is not a failed start');

  term.start('/repo');
  close(made[2], 0);
  assert.equal(failed.length, 1, 'exit 0 is not a failure');
});

test('the launch is a login, interactive shell (the shim is in ~/.local/bin); Windows types it', () => {
  assert.deepEqual(launchSpec({ platform: 'darwin', shell: '/bin/bash' }), { shellPath: '/bin/bash', shellArgs: ['-lic', 'exec agent'] });
  assert.equal(launchSpec({ platform: 'darwin', shell: '' }).shellPath, '/bin/zsh');
  assert.equal(launchSpec({ platform: 'win32' }), null);
  assert.match(failureText(2), /exit 2/);
});
