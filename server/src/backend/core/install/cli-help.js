/**
 * What `agent --help` prints (v8.5).
 *
 * Asked: "agent doctor — how do I even know?" The help listed the flags and
 * none of the commands, and still offered `--no-ci-watch`, which nothing has
 * read since the GitHub agent was removed. Built-ins only, so the bin can
 * answer it before looking for tsx, on an install that cannot start.
 */
export const HELP_TEXT = `Agent CLI: a coding agent that works through a Gemini tab in your Chrome.

Usage
  agent [options]                  start in this folder (alias: agent-cli)

Options
  -w, --workspace <path>           work on another folder (default: this one)
  -s, --scope <name>               one repo inside a folder that shares a .agent/
  -c, --continue                   carry on the last conversation here
      --resume <id>                carry on a given conversation (its id is printed on exit)
      --sessions                   list past conversations here, then exit
  -p, --port <number>              the extension's port (default: 7777)
      --editor <command>           the editor /open uses (default: $EDITOR, else the one you are in)
  -h, --help                       this text

Commands
  agent doctor                     what is installed, what is missing, what is out of date
  agent doctor <package>           why a package is used, and what breaks without it
  agent doctor --offline           the same, without asking npm for the latest versions
  agent doctor --test              run the agent's own tests, to check this install
  agent atlassian login            sign in to Jira once; the token goes to the Keychain
  agent atlassian status | logout  who is signed in; sign out and delete the token

Inside the agent, /help lists every key and command.

Environment
  EDITOR                           the editor /open uses
  AGENT_CLI_HOME                   the agent's home folder (default: ~/.agent)
  NO_COLOR                         no colour
`;
