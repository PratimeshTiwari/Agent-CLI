/**
 * One Chrome profile gets prompts (v9.3). `broadcast` reaches every extension,
 * so with the extension in two profiles each prompt was typed into both
 * accounts. Each test sends real `identify` and `pair` messages through
 * `_handleMessage`, then looks at where `inject_prompt` actually went.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from '../../../src/backend/bridge/websocket-server.js';
import { ProfileBinding } from '../../../src/backend/core/workspace/profile-binding.js';
import { readFileSync as readVersionFile } from 'node:fs';

// The checkout's own version, so this extension is never "older than the checkout".
const CURRENT = JSON.parse(readVersionFile(new URL('../../../../extension/manifest.json', import.meta.url), 'utf8')).version;

const WS = mkdtempSync(join(tmpdir(), 'one-profile-'));
const WORK = { dir: 'Profile 2', name: 'Work', email: '' };

function rig(saved = {}) {
  const browserProfile = new ProfileBinding({ load: () => saved, save: () => {} });
  const calls = { left: 0, notes: [] };
  const agentLoop = {
    workspace: WS,
    browserProfile,
    setBackgroundCallbacks() {},
    leaveChatForProfile() { calls.left += 1; },
    _notify(m) { calls.notes.push(m); },
  };
  const srv = new WebSocketServer({ port: 0, agentLoop, githubHandler: null });
  let n = 0;
  const connect = async (installId) => {
    const got = [];
    const id = `c${n += 1}`;
    const closed = [];
    srv.clients.set(id, {
      type: 'unknown',
      ws: { readyState: 1, OPEN: 1, send: (raw) => got.push(JSON.parse(raw)), close: (code) => closed.push(code) },
    });
    await srv._handleMessage(id, { type: 'identify', payload: { clientType: 'extension', version: CURRENT, ...(installId ? { installId } : {}) } });
    return {
      id,
      got,
      closed,
      type: () => srv.clients.get(id)?.type,
      prompts: () => got.filter((m) => m.type === 'inject_prompt').length,
      say: (type, payload) => srv._handleMessage(id, { type, payload }),
    };
  };
  return { srv, connect, calls, browserProfile };
}

test('unbound: the first profile gets the prompt, and the second does not', async () => {
  const { srv, connect, calls } = rig();
  const first = await connect('a');
  const second = await connect('b');
  srv.sendInjectPrompt({ text: 'x' });
  assert.equal(first.prompts(), 1);
  assert.equal(second.prompts(), 0, 'it used to be typed into both accounts');
  assert.equal(second.type(), 'refused');
  assert.match(calls.notes[0], /Another Chrome profile/);
  assert.match(second.got.find((m) => m.type === 'status').payload.message, /\/chrome/);
});

test('control: one install reconnecting is not a second profile', async () => {
  const { connect } = rig();
  const stale = await connect('a');
  const fresh = await connect('a');
  assert.equal(stale.type(), 'extension');
  assert.equal(fresh.type(), 'extension');
});

test('bound: only the chosen install, and an older build with no id is kept out', async () => {
  const { srv, connect } = rig({ chromeProfile: { ...WORK, install: 'work' } });
  const main = await connect('main');
  const old = await connect(null);
  const chosen = await connect('work');
  srv.sendInjectPrompt({ text: 'x' });
  assert.deepEqual([main.prompts(), old.prompts(), chosen.prompts()], [0, 0, 1]);
});

test('bound and closed: the prompt waits, and never falls back to a profile that is open', async () => {
  const { srv, connect } = rig({ chromeProfile: { ...WORK, install: 'work' } });
  const main = await connect('main');
  assert.equal(srv.sendInjectPrompt({ text: 'x' }), false);
  assert.equal(main.prompts(), 0);
  const chosen = await connect('work');
  assert.equal(chosen.prompts(), 1, 'held, and sent when it arrives');
});

test('a refused profile cannot start a turn from its side panel', async () => {
  const { connect, srv } = rig({ chromeProfile: { ...WORK, install: 'work' } });
  let handled = 0;
  srv.agentLoop.handleUserMessage = async () => { handled += 1; };
  const main = await connect('main');
  await main.say('user_message', { text: 'hi', message: 'hi' });
  await main.say('tab_status', { mainTab: { id: 1 } });
  assert.equal(handled, 0);
  assert.equal(srv.agentLoop.browserTab, undefined);
});

test('pairing moves the prompts, refuses the old profile and leaves its chat', async () => {
  const { srv, connect, calls, browserProfile } = rig();
  const main = await connect('main');
  const work = await connect('work');
  assert.equal(work.type(), 'refused');
  await work.say('pair', { token: browserProfile.startPairing(WORK) });
  assert.equal(browserProfile.current.install, 'work');
  assert.equal(main.type(), 'refused');
  assert.deepEqual(work.closed, [4001], 'it comes back through identify, to get what an arrival gets');
  assert.equal(calls.notes.filter((n) => /not the one the agent uses/.test(n)).length, 0, 'the person just chose this: no warning about it');
  assert.equal(calls.left, 1, 'a chat belongs to an account');
  srv.clients.delete(work.id);
  const back = await connect('work');
  srv.sendInjectPrompt({ text: 'x' });
  assert.deepEqual([main.prompts(), back.prompts()], [0, 1]);
});

test('pairing the one already connected keeps its chat', async () => {
  const { connect, calls, browserProfile } = rig();
  const only = await connect('only');
  await only.say('pair', { token: browserProfile.startPairing(WORK) });
  assert.equal(only.type(), 'extension');
  assert.equal(calls.left, 0);
});

test('a wrong, old or missing token binds nothing', async () => {
  const { connect, browserProfile } = rig();
  const c = await connect('a');
  browserProfile.startPairing(WORK);
  await c.say('pair', { token: 'f'.repeat(32) });
  await c.say('pair', {});
  assert.equal(browserProfile.current, null);
});

test('a build with no id cannot pair: a binding it could not keep would lock everyone out', async () => {
  const { connect, browserProfile } = rig();
  const old = await connect(null);
  await old.say('pair', { token: browserProfile.startPairing(WORK) });
  assert.equal(browserProfile.current, null);
});

test('lifting the choice lets a refused profile back in', async () => {
  const { connect, browserProfile } = rig({ chromeProfile: { ...WORK, install: 'work' } });
  const main = await connect('main');
  browserProfile.clear();
  assert.deepEqual(main.closed, [4001]);
});

test('when the connected profile goes, a waiting one is asked back', async () => {
  const { srv, connect } = rig();
  const first = await connect('a');
  const second = await connect('b');
  srv.clients.delete(first.id);
  srv._reviewExtensions();
  assert.deepEqual(second.closed, [4001]);
});

test('a real socket closing is what asks the waiting one back', async () => {
  const { srv, connect } = rig();
  const ws = new EventEmitter();
  Object.assign(ws, { readyState: 1, OPEN: 1, send() {}, close() {} });
  srv._handleConnection(ws, { headers: {}, url: '/' });
  const id = [...srv.clients.keys()].at(-1);
  await srv._handleMessage(id, { type: 'identify', payload: { clientType: 'extension', installId: 'a' } });
  const second = await connect('b');
  assert.equal(second.type(), 'refused');
  ws.emit('close', 1006, '');
  assert.deepEqual(second.closed, [4001]);
});

test('the terminal hears about a refusal once, however often it reconnects', async () => {
  const { connect, calls } = rig({ chromeProfile: { ...WORK, install: 'work' } });
  await connect('main');
  await connect('main');
  assert.equal(calls.notes.length, 1);
});
