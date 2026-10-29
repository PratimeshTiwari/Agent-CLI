import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme.js';

/**
 * What a palette looks like on the rows a person actually meets: an edit, a
 * failure, a running step, the modes. One component for first-start setup and
 * `/theme`, which drew it boxed and unboxed respectively until the owner asked
 * for the box in both (2026-10-30).
 *
 * Its own file because `panel.test.js` forbids borders in `Menus.jsx`: that rule
 * is about menu frames, and this is a sample framed as a sample.
 *
 * Every row truncates rather than wraps — it is drawn in the live frame, where
 * a wrapped row is a row nobody charged for.
 *
 * @param {'full'|'boxed'|'rows'} size `full` is the diff box (7 rows), `boxed`
 *   the two sample rows in a box (4), `rows` the same two rows bare (2) —
 *   `previewRows` says what each costs
 */
export default function ThemePreview({ size = 'full', frame = '⠋', marginTop = 0, marginLeft = 0 }) {
  const c = (role) => T[role] ?? undefined;
  const sample = [
    <Text key="a" wrap="truncate">
      <Text color={c('success')}>⏺ </Text><Text bold>edit_file</Text>
      <Text color={c('muted')}> invoice.rb </Text><Text color={c('success')}>+2 </Text><Text color={c('danger')}>−1</Text>
      {'   '}<Text color={c('danger')}>✗ </Text><Text bold>run_command</Text><Text color={c('danger')}> exit 1</Text>
    </Text>,
    <Text key="b" wrap="truncate">
      <Text color={c('accent')}>{frame} Running rspec…</Text>
      {'   '}<Text color={c('attention')}>⏸ 1 queued</Text>
      {'   '}<Text bold color={c('plan')}>plan</Text>{' '}<Text bold color={c('auto')}>auto</Text>{' '}<Text bold color={c('strict')}>strict</Text>
      {'   '}<Text color={c('link')}>/history</Text>
    </Text>,
  ];

  if (size === 'rows') {
    return <Box flexDirection="column" marginTop={marginTop} marginLeft={marginLeft}>{sample}</Box>;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={c('muted')}
      paddingX={1} marginTop={marginTop} marginLeft={marginLeft}>
      {size === 'full' ? (
        <>
          <Text wrap="truncate">
            <Text color={c('success')}>⏺ </Text><Text bold>edit_file</Text>
            <Text dimColor> greet.js </Text><Text color={c('success')}>+1 </Text><Text color={c('danger')}>−1</Text>
          </Text>
          <Text wrap="truncate" dimColor>{'  1  function greet() {'}</Text>
          <Text wrap="truncate" color={c('danger')}>{'  2 -  console.log("Hello, World!");'}</Text>
          <Text wrap="truncate" color={c('success')}>{'  2 +  console.log("Hello, Agent!");'}</Text>
          {sample[1]}
        </>
      ) : sample}
    </Box>
  );
}
