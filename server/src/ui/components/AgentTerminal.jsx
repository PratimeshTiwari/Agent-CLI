import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import fs from 'fs';
import { exec } from 'child_process';
import * as paths from '../../core/paths.js';
import { FOCUS_INPUT, FOCUS_TERMINAL } from '../constants.js';
import { T } from '../theme.js';

async function runTerminalCommand(cmd, {
  agentLoop, setHistory, setTerminalInput, setTerminalOpen, setFocus,
}) {
    if (!cmd.trim()) {
      setTerminalOpen(false);
      setFocus(FOCUS_INPUT);
      return;
    }
    
    // Check if docker sandbox is enabled
    let useSandbox = false;
    try {
      const configPath = paths.configPath(agentLoop.workspace);
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.useDockerSandbox) useSandbox = true;
      }
    } catch(e) {}

    let finalCommand = cmd;
    if (useSandbox) {
      const escapedCmd = cmd.replace(/'/g, "'\\''");
      finalCommand = `docker run --rm -v "${agentLoop.workspace}:/workspace" -w /workspace node:20-alpine sh -c '${escapedCmd}'`;
    } else {
      finalCommand = `cd "${agentLoop.workspace}" && ${cmd}`;
    }

    exec(finalCommand, (err, stdout, stderr) => {
      let output = stdout || stderr || (err ? err.message : '');
      if (!output) output = 'Command executed successfully (no output).';
      
      setHistory(prev => [
        ...prev,
        { role: 'user', content: `$ ${cmd}`, timestamp: Date.now() },
        { role: 'system', type: 'command_output', content: output.trim(), cmd: cmd, timestamp: Date.now() }
      ]);
    });

    setTerminalInput('');
    setTerminalOpen(false);
    setFocus(FOCUS_INPUT);
}

/**
 * The Ctrl+T scratch shell. Runs in the workspace, or inside a container when
 * useDockerSandbox is set, and reports back into the transcript.
 */
export function AgentTerminal({
  terminalOpen,
  terminalInput,
  setTerminalInput,
  setTerminalOpen,
  setHistory,
  setFocus,
  focus,
  agentLoop,
}) {
  const submitTerminalCommand = (cmd) => runTerminalCommand(cmd, {
    agentLoop, setHistory, setTerminalInput, setTerminalOpen, setFocus,
  });

  return (
    <>
      {terminalOpen && (
        // The shared menu look (`ui/panel.js`): a rule in the shell colour, no box.
        <Box flexDirection="column" width="100%">
          <Text color={T.shell} wrap="truncate">{'─'.repeat(Math.max(1, process.stdout.columns || 80))}</Text>
          <Text wrap="truncate">{' '}<Text bold color={T.shell}>Shell</Text><Text dimColor>{'  runs in the workspace'}</Text></Text>
          <Text> </Text>
          <Box>
            <Text bold color={T.shell}>{' $ '}</Text>
            {focus === FOCUS_TERMINAL ? (
              <TextInput focus={focus === FOCUS_TERMINAL} value={terminalInput} onChange={setTerminalInput} onSubmit={submitTerminalCommand} />
            ) : (
              <Text>{terminalInput}</Text>
            )}
          </Box>
          <Text> </Text>
          <Text dimColor wrap="truncate">{' enter run · esc close'}</Text>
        </Box>
      )}
    </>
  );
}
