# frontend

The terminal UI, built with Ink (React for terminals). It draws what `backend/` does and sends it
what you type. It imports from `backend/`, never the reverse.

## What is where

| Path | What it holds |
| --- | --- |
| `cli-ui.jsx` | the entry: the stdin shim Ink reads, hotkey routing, `render()` |
| `App.jsx` | the root component: state, effects, layout, the transcript and the live turn |
| `text.js` | width and wrapping that every other file builds on |
| `theme.js` | colours by role (`T.accent`, `T.danger`…), never by name |
| `constants.js` | the slash commands and shared values |
| `components/` | Ink components, one per piece of screen (`TranscriptTurn`, `InputBar`, `Menus`…) |
| `hooks/` | `App.jsx`'s logic: key bindings, hotkeys, slash commands, the loop's callbacks |
| `input/` | what comes in: hotkeys, Enter, paste, dropped files, images, the clipboard, the prompt's rows |
| `transcript/` | how a conversation is drawn: replies (`markdown.js`), tool rows, the live frame, one-line rows |
| `menus/` | the logic behind each menu: rows, sizing and actions. The drawing is in `components/` |
| `screen/` | the frame around it: the status bar, the intro and first-start setup, exit |

A menu has two halves: the logic in `menus/` (`question-view.js`) and the drawing in
`components/` (`QuestionPrompt.jsx`). The logic is plain JavaScript so it can be tested without a
terminal.

## Debugging

| You see | Look at |
| --- | --- |
| the screen flickers, or scrollback is lost | the live frame is taller than the terminal. Every live row must be budgeted: `transcript/live-layout.js` and `liveBudget` in `App.jsx` |
| a row wraps or is cut wrongly | `text.js` (`visibleWidth`, `wrapAnsi`, `fitLines`): a row that wraps is two rows |
| a key does nothing, or types a letter | ctrl+ chords are taken off stdin in `input/hotkeys.js`, before Ink sees them; add new ones to `HOTKEYS` |
| a reply renders wrongly | `transcript/markdown.js` |
| a tool row says the wrong thing | `transcript/tool-rows.js` and `transcript/action-row.js` |
| a menu does not fit | `menus/panel.js` (`panelRoom`) |

**Run it in a real terminal.** Tests check the logic; only a terminal shows a frame. The harness
described in CLAUDE.md, "The pty harness", drives the CLI under a pty with a fake extension and
counts full clears (`ESC[2J`). Check anything you can see at 13 and 24 rows: it should be 0.

Switches: `AGENT_CLI_NO_ANIMATION=1` skips the intro, `AGENT_CLI_NO_CLEAR=1` keeps the screen at
start, `NO_COLOR=1` drops colour. `ctrl+e` expands every step in the transcript.

## Tests

Tests live in `server/test/frontend/`. A test named after a file sits in the same folder as that
file (`input/paste.js` → `test/frontend/input/paste.test.js`). A test about a behaviour, such as
`queued-prompts.test.js`, sits at `test/frontend/`.

```bash
cd server && node --import ./test/setup-home.js --test test/frontend/input/paste.test.js
```

A test cannot import a `.jsx` file under plain `node --test`, so logic worth testing lives in a
`.js` file and the component calls it.

## Rules

- **The live frame never outgrows the terminal.** Settled turns go to `<Static>`; only the turn
  in progress is live, and every live row is charged to `liveBudget`.
- **No mouse tracking**, so scroll and drag-select stay the terminal's. Anything clickable is a key.
- **Colour is a role from `theme.js`**, never a colour name; a test fails on `color="cyan"`.
- **`App.jsx` is sensitive to re-renders.** `<Static>`, `staticEpoch` and the streaming path stay
  in it; memoizing transcript rows brought the scroll bugs back twice.

The reasons behind each rule are in [`CLAUDE.md`](../../../CLAUDE.md), under Gotchas.
