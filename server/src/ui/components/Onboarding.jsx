import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { exec } from 'child_process';
import { T, PALETTES, PALETTE_INFO, setTheme, themeName } from '../theme.js';
import { Header as BannerHeader, Mark, MARK } from './Banner.jsx';
import { FRAMES } from './RunningLine.jsx';
import { copyToClipboard } from '../clipboard.js';
import { saveUserSettings } from '../../core/user-settings.js';
import { MAX_AGENT_NAME } from '../../core/slash-commands.js';
import {
  STEPS, extensionDir, extensionStatus, onboardingLayout, progressBar, revealColumns, tildify,
} from '../welcome.js';

/**
 * First-start setup, Claude Code style: full screens before the app, one
 * decision each. The pure half — when to show it, the bar, the layout by
 * height — is `ui/welcome.js`.
 *
 * It runs *instead of* App, not on top of it, so there is no transcript
 * underneath to keep consistent, and App mounts afterwards with the theme
 * applied and the name saved: the banner it commits to `<Static>` is the one
 * the person just chose, which a reprint could not otherwise give it.
 *
 * Every screen is a live frame, so the decorative blocks are dropped by height
 * (`onboardingLayout`) and every row truncates rather than wraps.
 */

const SPLASH = 'splash';

function useTerminalSize() {
  const { stdout } = useStdout();
  const read = () => ({ rows: stdout?.rows || 24, columns: stdout?.columns || 80 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (!stdout?.on) return undefined;
    const onResize = () => setSize(read());
    stdout.on('resize', onResize);
    return () => stdout.off?.('resize', onResize);
  }, [stdout]);
  return size;
}

/** `Agent CLI setup ············ Step 2 of 3  ▰▰▰▰▰▰▰▰▱▱▱▱` */
function Header({ step, since, columns }) {
  const right = `Step ${step + 1} of ${STEPS.length}  `;
  const bar = progressBar(step, since);
  const left = 'Agent CLI setup';
  const gap = Math.max(2, Math.min(columns, 76) - left.length - right.length - bar.length);
  return (
    <Text wrap="truncate">
      <Text bold>{left}</Text>
      {' '.repeat(gap)}
      <Text dimColor>{right}</Text>
      <Text color={T.accent ?? undefined}>{bar}</Text>
    </Text>
  );
}

function Hint({ children }) {
  return <Text dimColor wrap="truncate">{children}</Text>;
}

function Gap({ show }) {
  return show ? <Text> </Text> : null;
}

/** The roles a person meets most, in the order a turn meets them. */
const SWATCH_ROLES = ['accent', 'success', 'danger', 'attention', 'strict'];

/**
 * A theme's colours, beside its name in the list, on the background the
 * palette was designed for — so `Light` shows its dark inks on white even in a
 * dark terminal, which is the comparison a person is actually making. Costs no
 * rows, so it is there at every height; the preview box under the list is not.
 */
function Swatch({ name }) {
  const palette = PALETTES[name] || {};
  if (name === 'mono') return <Text dimColor>plain text — bold and dim only</Text>;
  const bg = PALETTE_INFO[name]?.background || undefined;
  return (
    <Text backgroundColor={bg}>
      {' '}
      {SWATCH_ROLES.map((role) => <Text key={role} color={palette[role] ?? undefined}>■ </Text>)}
    </Text>
  );
}

export function Onboarding({ agentLoop, wsServer, onDone }) {
  const { rows, columns } = useTerminalSize();
  const layout = onboardingLayout(rows);
  const spaced = !layout.compact;

  const [screen, setScreen] = useState(SPLASH);
  const [tick, setTick] = useState(0);
  const [enteredAt, setEnteredAt] = useState(0);
  const [originalTheme] = useState(themeName);
  const [themeAt, setThemeAt] = useState(themeName);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [status, setStatus] = useState(() => extensionStatus(wsServer));
  const [copied, setCopied] = useState(null);

  // One clock for every animation on these screens, as App does.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 80);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const check = () => setStatus((prev) => {
      const next = extensionStatus(wsServer);
      return prev.connected === next.connected && prev.version === next.version ? prev : next;
    });
    const id = setInterval(check, 500);
    return () => clearInterval(id);
  }, [wsServer]);

  const go = (next) => {
    setScreen(next);
    setEnteredAt(tick);
  };

  const finish = () => {
    saveUserSettings({ welcomed: true });
    onDone?.();
  };

  const saveName = (value) => {
    const wanted = String(value || '').trim();
    if (wanted.length > MAX_AGENT_NAME) {
      setNameError(`${MAX_AGENT_NAME} characters or fewer — it is drawn as large lettering`);
      return;
    }
    if (wanted && agentLoop && wanted !== agentLoop.agentName) {
      agentLoop.agentName = wanted;
      try { agentLoop._saveConfig?.(); } catch { /* the name still holds for this session */ }
    }
    go('chrome');
  };

  const extPath = tildify(extensionDir());

  useInput((input, key) => {
    if (screen === SPLASH) {
      if (key.return) go('theme');
      else if (key.escape) finish();
      return;
    }
    // On the theme and name screens the list and the text field own Enter and
    // the letters; only esc is ours.
    if (screen === 'theme') {
      if (key.escape) { setTheme(originalTheme); setThemeAt(originalTheme); go('name'); }
      return;
    }
    if (screen === 'name') {
      if (key.escape) { setNameError(''); go('chrome'); }
      return;
    }
    if (screen === 'chrome') {
      if (key.return || key.escape) { finish(); return; }
      if (input === 'c') {
        copyToClipboard(extensionDir()).then((ok) => setCopied(ok ? 'copied' : 'no clipboard here'), () => setCopied('no clipboard here'));
      } else if (input === 'o') {
        const url = 'https://gemini.google.com/app';
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
        try { exec(`${opener} "${url}"`); } catch { /* the step says where to go anyway */ }
      }
    }
  });

  const since = tick - enteredAt;
  const width = Math.min(columns, 76);

  if (screen === SPLASH) {
    // The mark draws in a column a tick, then the greeting types itself out.
    const markWidth = MARK[0].length;
    const title = 'Welcome to Agent CLI';
    const typed = revealColumns(tick - markWidth, title.length, 2);
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row">
          <Box flexDirection="column" width={markWidth + 3} flexShrink={0}>
            <Mark reveal={revealColumns(tick, markWidth, 1)} />
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            <Text bold wrap="truncate">{title.slice(0, typed) || ' '}</Text>
            <Text dimColor wrap="truncate">Developed by Pratimesh Tiwari</Text>
            <Text dimColor wrap="truncate">A coding agent that works through Gemini</Text>
            <Text dimColor wrap="truncate">in your own browser. No API key.</Text>
          </Box>
        </Box>
        <Gap show={spaced} />
        <Text wrap="truncate">Three quick steps: <Text bold>theme</Text>, <Text bold>name</Text>, and <Text bold>connecting Chrome</Text>.</Text>
        <Gap show={spaced} />
        <Hint>
          <Text color={T.accent ?? undefined}>{FRAMES[tick % FRAMES.length]}</Text>
          {' Press enter to start · esc to skip setup'}
        </Hint>
      </Box>
    );
  }

  const step = STEPS.indexOf(screen);

  if (screen === 'theme') {
    const names = Object.keys(PALETTES);
    const labelWidth = Math.max(...names.map((n) => PALETTE_INFO[n].label.length));
    return (
      <Box flexDirection="column" width={width}>
        <Header step={step} since={since} columns={columns} />
        <Gap show={spaced} />
        <Text bold wrap="truncate">Choose the text style that looks best with your terminal</Text>
        <Gap show={spaced} />
        <SelectInput
          initialIndex={Math.max(0, names.indexOf(originalTheme))}
          items={names.map((n) => ({ label: PALETTE_INFO[n].label.padEnd(labelWidth), value: n }))}
          itemComponent={({ isSelected, label, value }) => (
            <Text wrap="truncate">
              <Text color={isSelected ? (T.menu ?? undefined) : undefined} bold={isSelected}>{label}</Text>
              {'  '}<Swatch name={value} />
              {value === originalTheme ? <Text dimColor>{'  current'}</Text> : null}
            </Text>
          )}
          onHighlight={(item) => { setTheme(item.value); setThemeAt(item.value); }}
          onSelect={(item) => {
            setTheme(item.value);
            saveUserSettings({ theme: item.value });
            go('name');
          }}
        />
        <Text dimColor wrap="truncate">{'  '}{PALETTE_INFO[themeAt]?.blurb}</Text>
        {layout.themePreview && (
          /* The preview: what an edit, a failure and a running step look like
             in this palette — the rows a person actually meets. */
          <Box flexDirection="column" borderStyle="round" borderColor={T.muted ?? undefined} paddingX={1} marginTop={spaced ? 1 : 0}>
            <Text wrap="truncate">
              <Text color={T.success ?? undefined}>⏺ </Text><Text bold>edit_file</Text>
              <Text dimColor> greet.js </Text><Text color={T.success ?? undefined}>+1 </Text><Text color={T.danger ?? undefined}>−1</Text>
            </Text>
            <Text wrap="truncate" dimColor>{'  1  function greet() {'}</Text>
            <Text wrap="truncate" color={T.danger ?? undefined}>{'  2 -  console.log("Hello, World!");'}</Text>
            <Text wrap="truncate" color={T.success ?? undefined}>{'  2 +  console.log("Hello, Agent!");'}</Text>
            <Text wrap="truncate">
              <Text color={T.accent ?? undefined}>{FRAMES[tick % FRAMES.length]} Running npm test…</Text>
              {'   '}<Text bold color={T.plan ?? undefined}>plan</Text>{' '}<Text bold color={T.auto ?? undefined}>auto</Text>
              {'   '}<Text color={T.link ?? undefined}>/history</Text>
            </Text>
          </Box>
        )}
        {layout.themeSample && (
          /* Too short for the box: the same idea in two rows. */
          <Box flexDirection="column" marginTop={spaced ? 1 : 0}>
            <Text wrap="truncate">
              {'  '}<Text color={T.success ?? undefined}>⏺ </Text><Text bold>edit_file</Text>
              <Text color={T.success ?? undefined}> +1 </Text><Text color={T.danger ?? undefined}>−1</Text>
              {'   '}<Text color={T.danger ?? undefined}>✗ </Text><Text bold>run_command</Text><Text color={T.danger ?? undefined}> exit 1</Text>
            </Text>
            <Text wrap="truncate">
              {'  '}<Text color={T.accent ?? undefined}>{FRAMES[tick % FRAMES.length]} Running npm test…</Text>
              {'   '}<Text color={T.plan ?? undefined}>⏸ plan</Text>{'  '}<Text color={T.auto ?? undefined}>⏵⏵ auto</Text>
            </Text>
          </Box>
        )}
        <Gap show={spaced} />
        <Hint>↑↓ preview · enter choose · esc keep current · later: /theme</Hint>
      </Box>
    );
  }

  if (screen === 'name') {
    /*
     * The field starts empty, with the name it will keep written into the
     * placeholder. It used to start filled with the current name, which read
     * as a label rather than something to type into — reported with a
     * screenshot of `❯ AGENT CLI` and no sign it could be changed.
     */
    const current = agentLoop?.agentName || 'Agent CLI';
    const shown = name.trim() || current;
    return (
      <Box flexDirection="column" width={width}>
        <Header step={step} since={since} columns={columns} />
        <Gap show={spaced} />
        <Text bold wrap="truncate">What should your agent be called?</Text>
        <Text dimColor wrap="truncate">
          {'Default: Agent CLI'}{agentLoop?.agentName ? `  ·  now: ${agentLoop.agentName}` : ''}
        </Text>
        <Gap show={spaced} />
        {/* Ruled like the main prompt, so it reads as a place to type. */}
        <Box borderStyle="single" borderLeft={false} borderRight={false} borderColor={T.accent ?? undefined}>
          <Text color={T.accent ?? undefined} bold>{'❯ '}</Text>
          <TextInput
            value={name}
            placeholder={`Type a name, or press enter to keep ${current}`}
            onChange={(v) => { setName(v); setNameError(''); }}
            onSubmit={saveName}
          />
        </Box>
        <Text dimColor={!nameError} color={nameError ? (T.danger ?? undefined) : undefined} wrap="truncate">
          {nameError || `${name.trim().length}/${MAX_AGENT_NAME} · your banner will read:`}
        </Text>
        {layout.namePreview && (
          <>
            <Gap show={spaced} />
            <BannerHeader name={shown.slice(0, MAX_AGENT_NAME)} where={tildify(agentLoop?.workspace || '')} models="gemini" columns={width} />
          </>
        )}
        <Gap show={spaced} />
        <Hint>enter save · esc keep {`"${current}"`} · later: /name</Hint>
      </Box>
    );
  }

  // Chrome.
  const spinner = FRAMES[tick % FRAMES.length];
  return (
    <Box flexDirection="column" width={width}>
      <Header step={step} since={since} columns={columns} />
      <Gap show={spaced} />
      <Text bold wrap="truncate">Connect Chrome. The agent types into gemini.google.com for you.</Text>
      <Gap show={spaced} />
      <Text wrap="truncate"><Text dimColor>1. </Text>Open <Text bold>chrome://extensions</Text> and turn on <Text bold>Developer mode</Text></Text>
      <Text wrap="truncate">
        <Text dimColor>2. </Text><Text bold>Load unpacked</Text> → {extPath}
        <Text dimColor>{'   c '}{copied ? `· ${copied}` : 'copies the path'}</Text>
      </Text>
      <Text wrap="truncate">
        <Text dimColor>3. </Text>Open <Text bold>gemini.google.com</Text>, sign in, leave the tab open
        <Text dimColor>{'   o opens it'}</Text>
      </Text>
      <Gap show={spaced} />
      {status.connected ? (
        <Text color={T.success ?? undefined} wrap="truncate">
          ✔ Connected{status.version ? <Text dimColor>{` · extension ${status.version}`}</Text> : null}
        </Text>
      ) : (
        <Text color={T.accent ?? undefined} wrap="truncate">{spinner} Waiting for the extension to connect…</Text>
      )}
      <Gap show={spaced} />
      <Hint>
        {status.connected
          ? 'enter start the agent'
          : 'enter finish anyway (it connects by itself later) · esc skip'}
      </Hint>
    </Box>
  );
}
