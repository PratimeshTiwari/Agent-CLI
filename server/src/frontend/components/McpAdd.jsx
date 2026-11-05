import React from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import { Panel, Choices } from './Panel.jsx';
import { T } from '../theme.js';
import {
  commandLine, fitCommand, startAdd, stepBack, submitName, submitPaste, submitValue, testedLine,
} from '../menus/mcp-add.js';
import { envLine, tryServer } from '../../backend/mcp/client/add-server.js';
import { saveServer } from '../../backend/mcp/client/edit-config.js';
import { secretPlace } from '../../backend/mcp/client/secrets.js';
import { changeMcp } from '../../backend/mcp/client/integrations.js';

/**
 * One line of text. Not the prompt's field: a pasted README block has newlines
 * and must stay one row, and a hidden value must go nowhere but here.
 *
 * `usePaste` is what asks the terminal for bracketed paste. The prompt's turns it
 * off behind a menu, and without it a pasted JSON block arrives as keystrokes, so
 * its first newline is an Enter on half a config.
 */
function Field({ value, onChange, onSubmit, hidden = false, width }) {
  const live = React.useRef(value);
  live.current = value;
  const set = (next) => { live.current = next; onChange(next); };

  // A paste is a whole answer, so it replaces: there is no caret here to aim one
  // with, and a second try must not land behind the first.
  usePaste((text) => set(text));

  useInput((input, key) => {
    if (key.return) { onSubmit(live.current); return; }
    if (key.backspace || key.delete) { set(live.current.slice(0, -1)); return; }
    if (key.escape || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
    if (key.ctrl || key.meta || !input) return;
    set(live.current + input);
  });

  const room = Math.max(8, width - 6);
  const flat = hidden ? '•'.repeat(value.length) : value.replace(/\s+/g, ' ');
  const shown = flat.length > room ? `…${flat.slice(-(room - 1))}` : flat;
  return (
    <Box>
      <Text color={T.accent}>{' ❯ '}</Text>
      <Text wrap="truncate">{shown}</Text>
      <Text inverse> </Text>
    </Box>
  );
}

export function McpAdd({ agentLoop, width, rows, text, onSaved, onLeave }) {
  const taken = () => agentLoop.mcp.snapshot().servers.map((s) => s.name);
  const [state, setState] = React.useState(() => (text ? submitPaste(startAdd(), text, { taken: taken() }) : startAdd()));
  const [draft, setDraft] = React.useState(state.name ?? text ?? '');
  const running = React.useRef(null);

  const go = (next, nextDraft = '') => { setState(next); setDraft(nextDraft); };

  const leave = () => { running.current?.close(); running.current = null; };
  React.useEffect(() => leave, []);

  useInput((_input, key) => {
    if (!key.escape) return;
    leave();
    const back = stepBack(state);
    if (!back) { onLeave(); return; }
    let text = '';
    if (back.step === 'paste') text = back.text;
    if (back.step === 'name') text = back.name;
    go(back, text);
  });

  const test = () => {
    go({ ...state, step: 'testing', error: null });
    const { connection, result } = tryServer(state.name, state.entry, state.values, { cwd: agentLoop.workspace });
    running.current = connection;
    result.then((outcome) => {
      if (running.current !== connection) return; // esc while it started
      running.current = null;
      setState((s) => (s.step === 'testing' ? { ...s, step: 'tested', result: outcome } : s));
    });
  };

  const save = async () => {
    try {
      saveServer(state.name, state.entry, state.values);
    } catch (err) {
      go({ ...state, step: 'check', error: err.message });
      return;
    }
    await changeMcp(agentLoop, () => agentLoop.mcp.configChanged());
    // Not awaited: one that hangs is a `starting` row, not a frozen screen.
    agentLoop.mcp.connect(state.name).catch(() => { /* its row says so */ });
    onSaved();
  };

  const error = state.error ? <Text color={T.attention} wrap="truncate"> {state.error}</Text> : null;
  const ask = state.step === 'value' ? state.plan.ask[state.at] : null;

  if (state.step === 'paste' || state.step === 'name' || state.step === 'value') {
    // On the title's row: the line under a title is the first thing a short terminal sheds.
    const head = {
      paste: ['Add a server', 'paste its command, or the JSON from its README'],
      name: ['Name it', 'how you and the model refer to this server'],
      value: [ask?.key, ask?.hidden ? `hidden · saved in ${secretPlace()}, not mcp.json` : 'what the server needs for this'],
    }[state.step];
    const submit = {
      paste: () => {
        const next = submitPaste(state, draft, { taken: taken() });
        go(next, next.step === 'name' ? next.name : draft);
      },
      name: () => {
        const next = submitName(state, draft, { taken: taken() });
        go(next, next.step === 'name' ? draft : '');
      },
      value: () => {
        const next = submitValue(state, draft);
        go(next, next.step === 'value' && next.at === state.at ? draft : '');
      },
    }[state.step];
    return (
      <Panel width={width} title={head[0]} status={head[1]} tight keys="enter next · esc back">
        <Field key={`${state.step}-${state.at ?? 0}`} value={draft} onChange={setDraft} onSubmit={submit} hidden={Boolean(ask?.hidden)} width={width} />
        {error}
      </Panel>
    );
  }

  if (state.step === 'testing') {
    return (
      <Panel width={width} title={`Starting ${state.name}`} tight keys="esc stop">
        <Text wrap="truncate" dimColor> {commandLine(state.entry)}</Text>
      </Panel>
    );
  }

  if (state.step === 'check') {
    const env = envLine(state.entry, state.values);
    return (
      <Panel width={width} title={`Add ${state.name}?`} tight keys="enter choose · esc back">
        {fitCommand(commandLine(state.entry), width, Math.max(1, rows - (env ? 6 : 5) - (state.error ? 1 : 0)))
          .map((line, i) => <Text key={i} wrap="truncate"> {line}</Text>)}
        {env ? <Text wrap="truncate" dimColor> with {env}</Text> : null}
        {error}
        <Choices
          limit={2}
          items={[
            { label: 'Test it', detail: 'runs this command once', value: 'test' },
            { label: 'Save without testing', value: 'save' },
          ]}
          onSelect={(item) => (item.value === 'test' ? test() : save())}
        />
      </Panel>
    );
  }

  const worked = state.result?.ok;
  return (
    <Panel width={width} title={worked ? `${state.name} works` : `${state.name} did not start`} tight keys="enter choose · esc back">
      <Text wrap="truncate" color={worked ? T.success : T.danger}> {testedLine(state.result)}</Text>
      <Choices
        limit={2}
        initialIndex={0}
        items={worked
          ? [{ label: 'Save', value: 'save' }, { label: 'Back', value: 'back' }]
          : [{ label: 'Back', value: 'back' }, { label: 'Save anyway', value: 'save' }]}
        onSelect={(item) => (item.value === 'save' ? save() : go({ ...state, step: 'check', result: null }))}
      />
    </Panel>
  );
}
