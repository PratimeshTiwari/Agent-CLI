/**
 * When the browser is not on the effort's model (v5.28): ask, step down, say so.
 *
 * The walk is tested with a fake picker, because the failure it exists for —
 * Pro or Argon at its limit — cannot be produced on demand on the real page.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  lowerRung, mismatchPolicy, describeMismatch, ensureRung, describeFailedSwitch,
} from '../../src/core/model-fallback.js';
import { classifyReply } from '../../src/core/reply-recovery.js';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { handleSlashCommand } from '../../src/core/slash-commands.js';

const picker = (selected, { argon = false } = {}) => [
  { label: '3.5 Flash-Lite' },
  { label: '3.8 Flash' },
  { label: '3.1 Pro' },
  ...(argon ? [{ label: '4 Argon' }] : []),
].map((m) => ({ ...m, selected: m.label === selected }));

/** A picker that refuses some labels: a switch to them leaves the selection where it was. */
function fakeTab(start, { refuse = [], argon = false } = {}) {
  let models = picker(start, { argon });
  const asked = [];
  return {
    asked,
    models: () => models,
    switchTo: async (label) => {
      asked.push(label);
      if (!refuse.includes(label)) models = picker(label, { argon });
      const on = models.find((m) => m.selected).label;
      return { ok: on === label, switchedTo: on };
    },
  };
}

describe('the rules', () => {
  test('one step down at a time, never up', () => {
    assert.equal(lowerRung('max'), 'high');
    assert.equal(lowerRung('high'), 'medium');
    assert.equal(lowerRung('medium'), 'low');
    assert.equal(lowerRung('low'), null);
  });

  test('ask unless told otherwise', () => {
    assert.equal(mismatchPolicy({}), 'ask');
    assert.equal(mismatchPolicy({ onMismatch: 'follow' }), 'follow');
    assert.equal(mismatchPolicy({ onMismatch: 'bogus' }), 'ask');
  });

  test('a disagreement is described; agreement and an unread picker are not', () => {
    const ask = describeMismatch('high', picker('3.8 Flash'));
    assert.deepEqual(ask, {
      key: 'high|3.8 Flash', setting: 'high', wanted: '3.1 Pro', current: '3.8 Flash', browserRung: 'medium',
    });
    assert.equal(describeMismatch('high', picker('3.1 Pro')), null, 'control: they agree');
    assert.equal(describeMismatch('high', []), null, 'unread is not a disagreement');
    assert.equal(describeMismatch('max', picker('3.1 Pro')), null, 'no Argon: nothing to switch to');
  });

  test('the failure line names both models', () => {
    assert.equal(describeFailedSwitch({ label: '3.1 Pro', switchedTo: '3.8 Flash' }),
      '✗ Could not switch the browser to 3.1 Pro (it stayed on 3.8 Flash)');
    assert.match(describeFailedSwitch({ label: '3.1 Pro', switchedTo: null, timedOut: true }), /did not answer/);
    assert.match(describeFailedSwitch({ label: '3.1 Pro', switchedTo: null }), /showed no model selected/,
      'an answer with no selection is not silence');
  });
});

describe('the walk', () => {
  test('a switch that lands is the end of it', async () => {
    const tab = fakeTab('3.8 Flash');
    const r = await ensureRung({ rung: 'high', models: tab.models, switchTo: tab.switchTo });
    assert.deepEqual([r.ok, r.rung, r.failed], [true, 'high', []]);
    assert.deepEqual(tab.asked, ['3.1 Pro']);
  });

  test('already there: no switch at all', async () => {
    const tab = fakeTab('3.1 Pro');
    const r = await ensureRung({ rung: 'high', models: tab.models, switchTo: tab.switchTo });
    assert.equal(r.rung, 'high');
    assert.deepEqual(tab.asked, []);
  });

  test('Pro refuses: steps down to Flash, where the tab already is, and says what failed', async () => {
    const tab = fakeTab('3.8 Flash', { refuse: ['3.1 Pro'] });
    const r = await ensureRung({ rung: 'high', models: tab.models, switchTo: tab.switchTo });
    assert.equal(r.rung, 'medium');
    assert.deepEqual(r.failed, [{ rung: 'high', label: '3.1 Pro', switchedTo: '3.8 Flash' }]);
    assert.deepEqual(tab.asked, ['3.1 Pro'], 'Flash needed no switch');
  });

  test('Argon and Pro both refuse: Max lands on Flash', async () => {
    const tab = fakeTab('3.1 Pro', { refuse: ['4 Argon', '3.8 Flash'], argon: true });
    // Flash refuses too here, so it goes to the bottom.
    const r = await ensureRung({ rung: 'max', models: tab.models, switchTo: tab.switchTo });
    assert.equal(r.rung, 'high', 'the tab is already on Pro, which is the next rung down');
    assert.deepEqual(tab.asked, ['4 Argon']);
  });

  test('Max without Argon is skipped, not counted as a failure', async () => {
    const tab = fakeTab('3.8 Flash');
    const r = await ensureRung({ rung: 'max', models: tab.models, switchTo: tab.switchTo });
    assert.equal(r.rung, 'high');
    assert.deepEqual(r.failed, []);
  });

  test('nothing lands: not ok, every failure listed', async () => {
    const tab = fakeTab('3.1 Pro', { refuse: ['3.8 Flash', '3.5 Flash-Lite'] });
    const r = await ensureRung({ rung: 'medium', models: tab.models, switchTo: tab.switchTo });
    assert.equal(r.ok, false);
    assert.deepEqual(r.failed.map((f) => f.label), ['3.8 Flash', '3.5 Flash-Lite']);
  });

  test('esc during a switch stops the walk', async () => {
    const tab = fakeTab('3.8 Flash');
    const r = await ensureRung({
      rung: 'high', models: tab.models, switchTo: async () => ({ ok: false, cancelled: true }),
    });
    assert.deepEqual([r.ok, r.cancelled], [false, true]);
  });
});

describe('a quota reply', () => {
  const limit = "You've reached your limit for 3.1 Pro. Try again later.";
  test('steps down when there is a rung below and a prompt to re-send', () => {
    assert.equal(classifyReply({ cleanContent: limit }, { canStepDown: true, hasLastPrompt: true }).action, 'step_down');
  });
  test('control: shown as it is once the turn has stepped down, or at the bottom', () => {
    const r = classifyReply({ cleanContent: limit }, { canStepDown: false, hasLastPrompt: true });
    assert.deepEqual(r, { action: 'proceed', kind: 'quota' });
  });
});

describe('the loop', () => {
  function loop(models) {
    const dir = mkdtempSync(join(tmpdir(), 'fallback-'));
    const rows = [];
    const sent = [];
    const l = Object.create(AgentLoop.prototype);
    Object.assign(l, {
      workspace: dir,
      modelConfig: { main: 'gemini', effort: 'high' },
      modelOptions: models,
      callbacks: null,
      effortFallback: null,
      _mismatchAcks: new Set(),
      _switchWaiters: [],
      _saveConfig() {},
      _noticeSink: (text) => rows.push(text),
      _toExtension: (type, payload) => sent.push([type, payload]),
      extensionLock: { isBusy: () => false, abortAll() {} },
      _cancelScheduledRetry() {},
    });
    return { l, rows, sent, done: () => rmSync(dir, { recursive: true, force: true }) };
  }

  test('a switch is confirmed by what the picker reads back', async () => {
    const { l, sent, done } = loop(picker('3.8 Flash'));
    const pending = l.switchAndConfirm('3.1 Pro');
    assert.deepEqual(sent.at(-1), ['switch_model', { label: '3.1 Pro' }]);
    l.noteModelOptions(picker('3.8 Flash'), '3.8 Flash', '3.1 Pro');
    assert.deepEqual(await pending, { ok: false, switchedTo: '3.8 Flash' });
    done();
  });

  test('esc settles a waiting switch as cancelled', async () => {
    const { l, done } = loop(picker('3.8 Flash'));
    const pending = l.switchAndConfirm('3.1 Pro');
    l.abortExtensionWork();
    assert.deepEqual(await pending, { ok: false, cancelled: true });
    done();
  });

  test('Pro refuses: the session steps down, says so, and stops asking', async () => {
    const { l, rows, done } = loop(picker('3.8 Flash'));
    const walking = l.ensureRungForTurn('high', 'switch');
    await Promise.resolve();
    l.noteModelOptions(picker('3.8 Flash'), '3.8 Flash', '3.1 Pro');
    const r = await walking;
    assert.equal(r.rung, 'medium');
    assert.deepEqual(l.effortFallback, { wanted: 'high', got: 'medium', label: '3.8 Flash', reason: 'switch did not land' });
    // Mid-turn "Switching…" is spinner status; idle here, so it lands as a row too.
    const kept = rows.filter((row) => !row.startsWith('Switching'));
    assert.equal(kept[0], '✗ Could not switch the browser to 3.1 Pro (it stayed on 3.8 Flash)');
    assert.match(kept[1], /^↓ Sending on 3\.8 Flash \(Medium\) for this session/);
    assert.equal(l.mismatchToAsk(), null, 'a step-down is not asked about');
    await handleSlashCommand(l, 'effort', ['high']);
    assert.equal(l.effortFallback, null, '/effort tries again');
    done();
  });

  test('asked once per disagreement', () => {
    const { l, done } = loop(picker('3.8 Flash'));
    const ask = l.mismatchToAsk();
    assert.equal(ask.key, 'high|3.8 Flash');
    l.ackMismatch(ask.key);
    assert.equal(l.mismatchToAsk(), null);
    l.modelOptions = picker('3.5 Flash-Lite');
    assert.equal(l.mismatchToAsk()?.key, 'high|3.5 Flash-Lite', 'a different disagreement asks again');
    l.modelConfig.onMismatch = 'follow';
    assert.equal(l.mismatchToAsk(), null, 'control: follow never asks');
    done();
  });

  test('/effort mismatch sets the policy in one line', async () => {
    const { l, done } = loop(picker('3.8 Flash'));
    const r = await handleSlashCommand(l, 'effort', ['mismatch', 'switch']);
    assert.match(r.message, /^⚙ on mismatch {2}\*\*ask\*\* → \*\*switch\*\*/);
    assert.equal(l.modelConfig.onMismatch, 'switch');
    const bare = await handleSlashCommand(l, 'effort', ['mismatch']);
    assert.match(bare.message, /On a mismatch: \*\*switch\*\*/);
    done();
  });
});
