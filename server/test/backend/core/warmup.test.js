/**
 * Warm start (v5.27): the setup prompt goes before the first message.
 *
 * Opt-in — owner, 2026-10-26: "warm should be not at default". The property
 * that makes it safe to offer is that **the worst case is a cold start**: the
 * prompt is marked seen only when Gemini answers, and anything else leaves the
 * first message to carry the full prompt exactly as before.
 *
 * A real `PromptBuilder` in a temp workspace, because the claims are about what
 * is typed into the tab; `_askThread` is the seam, standing in for the browser.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../../../src/backend/core/agent-loop.js';
import { PromptBuilder } from '../../../src/backend/core/prompt-builder.js';
import { startupMode, loadUserSettings } from '../../../src/backend/core/user-settings.js';
import { handleSlashCommand } from '../../../src/backend/core/slash-commands.js';

const PRO = [{ label: '3.1 Pro', isMode: false, selected: true }];

function loop(answer = { ok: true, text: 'Ready.' }) {
  const dir = mkdtempSync(join(tmpdir(), 'warmup-'));
  const sent = [];
  const saved = [];
  const l = Object.create(AgentLoop.prototype);
  Object.assign(l, {
    workspace: dir,
    mode: 'plan',
    modelConfig: { main: 'gemini', effort: 'high' },
    modelOptions: PRO,
    conversationHistory: [],
    chatThread: null,
    callbacks: null,
    promptBuilder: new PromptBuilder(dir, dir),
    sessionStore: { setThread: (t) => saved.push(t.id) },
    _askThread: async (prompt) => { sent.push(prompt); return typeof answer === 'function' ? answer(l) : answer; },
  });
  l.isProcessing = false;
  const firstMessage = () => l.promptBuilder.buildPrompt({
    userMessage: 'hi', mode: 'plan', subagents: l.subagentsEnabled, modelConfig: l._promptConfig(),
  });
  return { l, sent, saved, firstMessage, done: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('the setting', () => {
  test('cold unless warm is chosen', () => {
    assert.equal(startupMode({}), 'cold');
    assert.equal(startupMode({ startupMode: 'bogus' }), 'cold');
    assert.equal(startupMode({ startupMode: 'warm' }), 'warm');
  });

  test('/startup saves per person and answers in one line', async () => {
    const { l, done } = loop();
    l.startupMode = 'cold';
    l.promptBuilder.hasSeenSystemPrompt = true; // nothing to warm: keep this a pure setting test
    const r = await handleSlashCommand(l, 'startup', ['warm']);
    assert.match(r.message, /^⚙ startup {2}\*\*cold\*\* → \*\*warm\*\*/);
    assert.equal(l.startupMode, 'warm');
    assert.equal(loadUserSettings().startupMode, 'warm');
    const bare = await handleSlashCommand(l, 'startup', []);
    assert.match(bare.message, /Startup is \*\*warm\*\*/);
    await handleSlashCommand(l, 'startup', ['cold']);
    assert.equal(loadUserSettings().startupMode, 'cold', 'control: and back');
    done();
  });
});

describe('what goes into the tab', () => {
  test('the warm-up teaches exactly what a cold first message would', async () => {
    const warm = loop();
    const cold = loop();
    await warm.l.warmUp({ waitForModelsMs: 0 });
    const block = (text, ws) => text.split('</system_state>')[0].split(ws).join('<ws>');
    assert.equal(block(warm.sent[0], warm.l.workspace), block(cold.firstMessage(), cold.l.workspace));
    assert.match(warm.sent[0], /Reply with only: Ready\.$/);
    warm.done(); cold.done();
  });

  test('after an answer, the first message is the short turn', async () => {
    const { l, firstMessage, done } = loop();
    assert.equal(await l.warmUp({ waitForModelsMs: 0 }), 'ready');
    const first = firstMessage();
    assert.doesNotMatch(first, /<system_state/);
    assert.match(first, /<user_message>\nhi\n<\/user_message>/);
    done();
  });

  for (const [why, answer, outcome] of [
    ['a timeout', { ok: false, timedOut: true }, 'failed'],
    ['an esc', { ok: false, cancelled: true }, 'cancelled'],
    ['a throw', () => { throw new Error('bridge gone'); }, 'failed'],
  ]) {
    test(`after ${why}, the first message carries the full prompt — a cold start`, async () => {
      const { l, firstMessage, done } = loop(answer);
      assert.equal(await l.warmUp({ waitForModelsMs: 0 }), outcome);
      assert.match(firstMessage(), /<system_state/);
      assert.equal(l.warmState, outcome);
      done();
    });
  }
});

describe('when it runs', () => {
  test('busy while it runs, so typed prompts queue; idle after', async () => {
    let busyDuring = null;
    const { l, done } = loop((self) => { busyDuring = self.isProcessing; return { ok: true }; });
    let idleEdges = 0;
    l.onIdle(() => { idleEdges += 1; });
    await l.warmUp({ waitForModelsMs: 0 });
    assert.equal(busyDuring, true);
    assert.equal(l.isProcessing, false);
    assert.equal(idleEdges, 1, 'the idle edge is what drains the queue');
    done();
  });

  for (const [why, arrange] of [
    ['the chat already has the prompt', (l) => { l.promptBuilder.hasSeenSystemPrompt = true; }],
    ['a turn is running', (l) => { l.isProcessing = true; }],
    ['a thread is being resumed', (l) => { l.chatThread = { id: 'abc' }; }],
    ['a recap is owed', (l) => { l.promptBuilder.pendingRecap = [{ role: 'user', content: 'x' }]; }],
  ]) {
    test(`skipped when ${why}`, async () => {
      const { l, sent, done } = loop();
      arrange(l);
      assert.equal(await l.warmUp({ waitForModelsMs: 0 }), 'skipped');
      assert.equal(sent.length, 0);
      done();
    });
  }

  test('once per launch, and only when warm', async () => {
    const { l, sent, done } = loop();
    l._warmOnConnect = false;
    assert.equal(l.warmUpOnConnect(), null, 'cold: nothing');
    l._warmOnConnect = true;
    await l.warmUpOnConnect();
    l.promptBuilder.resetPromptState(); // even if the chat were reset, a reconnect does not re-warm
    assert.equal(l.warmUpOnConnect(), null);
    assert.equal(sent.length, 1);
    done();
  });

  test('esc while it waits for the picker sends nothing', async () => {
    const { l, sent, firstMessage, done } = loop();
    l.modelOptions = [];
    const running = l.warmUp({ waitForModelsMs: 2000 });
    l.abortExtensionWork = AgentLoop.prototype.abortExtensionWork;
    Object.assign(l, { _cancelScheduledRetry() {}, extensionLock: { abortAll() {} } });
    l.abortExtensionWork();
    assert.equal(await running, 'cancelled');
    assert.equal(sent.length, 0);
    assert.match(firstMessage(), /<system_state/);
    done();
  });
});

describe('the warm-up\'s chat is not filed on its own', () => {
  test('its thread reaches disk only with the first real reply', async () => {
    const { l, saved, done } = loop((self) => {
      self._recordThread('https://gemini.google.com/app/warm123');
      return { ok: true };
    });
    await l.warmUp({ waitForModelsMs: 0 });
    assert.equal(l.chatThread?.id, 'warm123');
    assert.deepEqual(saved, [], 'a session with no user turn would pair --continue with this chat');
    l._recordThread('https://gemini.google.com/app/warm123');
    assert.deepEqual(saved, ['warm123'], 'the first real reply files it');
    done();
  });

  test('control: a cold chat is filed on its first reply, as before', () => {
    const { l, saved, done } = loop();
    l._recordThread('https://gemini.google.com/app/cold456');
    assert.deepEqual(saved, ['cold456']);
    done();
  });
});

test('the settings page lists it', async () => {
  const { describeSettings } = await import('../../../src/backend/core/settings.js');
  const { l, done } = loop();
  l.startupMode = 'cold';
  const row = describeSettings(l).find((r) => r.label === 'Startup');
  assert.equal(row?.value, 'cold');
  assert.equal(row.run, '/startup', 'enter opens the chooser that explains both');
  assert.ok(readFileSync(new URL('../../../src/frontend/constants.js', import.meta.url), 'utf8').includes("name: 'startup'"));
  done();
});
