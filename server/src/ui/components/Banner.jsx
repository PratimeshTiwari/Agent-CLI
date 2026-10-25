import React from 'react';
import { Box, Text } from 'ink';
import os from 'os';
import { themeName } from '../theme.js';
import { shortenPath } from '../format.js';

/**
 * The header: a mark, the agent's name, the byline, where you are, and the one
 * key worth knowing.
 *
 * It is committed to <Static>, so its height costs scrollback rather than the
 * live frame. What it is *not* allowed to be is the loudest thing on screen:
 * it used to be six rows of figlet run through a full rainbow, with the byline
 * in magenta — the rows carrying no information were the ones the eye went to
 * first. The colour now lives only on the mark, as a two-stop ramp inside the
 * accent's hue family; everything beside it is plain or dim.
 */

/** The ramp: accent cyan into indigo. Both ends are the accent, not new roles. */
const FROM = [0x22, 0xd3, 0xee];
const TO = [0x60, 0x7d, 0xff];

const hex = (t) => {
  const c = FROM.map((from, i) => Math.round(from + (TO[i] - from) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/**
 * The mark: a `❯` prompt in block characters, four rows, one ramp colour per
 * row. Look A of `.agent/artifacts/plans/2026-10-25-startup-look.md`, chosen
 * 2026-10-25 — it replaced six rows of figlet that spelled the agent's name,
 * which made the logo change whenever `/name` did and was the loudest thing on
 * screen while saying the least.
 *
 * Every row is the same width, so the text column beside it starts at one
 * column on every row.
 */
export const MARK = [' ██▖   ', '  ▝██▖ ', '  ▗██▘ ', ' ██▘   '];

/** `reveal` draws it in from the left, for setup's splash; the banner shows it whole. */
export function Mark({ reveal = Infinity }) {
  return MARK.map((row, i) => (
    <Text key={i} color={themeName() === 'mono' ? undefined : hex(i / (MARK.length - 1))}>
      {row.slice(0, reveal).padEnd(row.length)}
    </Text>
  ));
}

/**
 * The mark with four lines beside it — name, byline, where, and the one key
 * to know — so every row of the header carries something. Claude Code 2's
 * shape. The name is plain text: what `/name` changes is a word, not the logo.
 */
export function Header({ name, where, models, columns = process.stdout.columns || 80, frame = null }) {
  // `frame` is the intro's position (`ui/intro.js`); absent, the header is whole.
  // A hidden line is a space, not nothing: the header keeps its four rows while
  // it draws in, so the frame never changes height under the animation.
  const shown = (n) => !frame || frame.lines >= n;
  const markColumn = MARK[0].length + 3;
  // An explicit width for the text: without one, Yoga sizes the column to its
  // content inside <Static>, `wrap="truncate"` has nothing to truncate to, and
  // a long workspace path wrapped onto a fifth row (measured under the pty).
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={markColumn} flexShrink={0}>
        <Mark reveal={frame ? frame.reveal : Infinity} />
      </Box>
      <Box flexDirection="column" width={Math.max(10, columns - markColumn)}>
        <Text bold wrap="truncate">{(frame ? name.slice(0, frame.nameChars) : name) || ' '}</Text>
        <Text dimColor wrap="truncate">{shown(1) ? 'Developed by Pratimesh Tiwari' : ' '}</Text>
        {/* Shortened from the middle, so the project's folder name survives. */}
        <Text dimColor wrap="truncate">
          {!shown(2) ? ' ' : shortenPath(where || '', Math.max(12, columns - markColumn - (models ? models.length + 5 : 0)))}
          {shown(2) && models ? `  ·  ${models}` : ''}
        </Text>
        <Text dimColor wrap="truncate">{shown(3) ? '/help for commands' : ' '}</Text>
      </Box>
    </Box>
  );
}

export function Banner({ agentLoop, agentName, frame = null }) {
  const models = (() => {
    const roles = ['main'];
    const named = roles.map((r) => agentLoop.modelConfig?.[r]).filter(Boolean);
    return [...new Set(named)].join(', ') || 'gemini';
  })();

  // `~/Documents/Gemini-Agent`, not the absolute path: it is the first line
  // anyone reads and the prefix carries nothing.
  const home = os.homedir();
  const where = agentLoop.workspace?.startsWith(home)
    ? `~${agentLoop.workspace.slice(home.length)}`
    : agentLoop.workspace;

  return (
    <Box key="banner" flexDirection="column" marginBottom={1} width="100%">
      <Header name={agentName || 'Agent CLI'} where={where} models={models} frame={frame} />
    </Box>
  );
}
