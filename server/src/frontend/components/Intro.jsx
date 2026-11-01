import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Banner } from './Banner.jsx';
import { T } from '../theme.js';
import { introFrame, introLength, outroFrame, INTRO_TICK_MS, OUTRO_TICK_MS } from '../screen/intro.js';

/**
 * The header drawing itself in, as a live frame, before App mounts and commits
 * the same header to <Static> at the same position. See `frontend/screen/intro.js`.
 */
export function Intro({ agentLoop, onDone }) {
  const name = agentLoop?.agentName || 'Agent CLI';
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), INTRO_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const frame = introFrame(tick, name);
  useEffect(() => {
    if (frame.done || tick > introLength(name) + 5) onDone?.();
  }, [frame.done, tick]);
  return <Banner agentLoop={agentLoop} agentName={name} frame={frame} />;
}

/** What replaces the prompt box for a moment on the way out. */
export function Goodbye() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), OUTRO_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const { text, dim } = outroFrame(tick);
  return (
    <Box marginTop={1}>
      <Text color={T.accent}>{'❯ '}</Text>
      <Text dimColor={dim}>{text}</Text>
    </Box>
  );
}
