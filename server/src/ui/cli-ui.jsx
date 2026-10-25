import React, { useEffect, useState } from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import { splitTrailingEnter } from './enter-splitter.js';
import { extractHotkeys, hotkeys, interruptGate } from './hotkeys.js';
import { registerInk, registerOutro, registerScreen, exitWithFarewell } from './farewell.js';
import { createScreenSpan, CURSOR_REPORT, ASK_CURSOR } from './screen-span.js';
import { App } from './App.jsx';
import { Onboarding } from './components/Onboarding.jsx';
import { Intro, Goodbye } from './components/Intro.jsx';
import { animationAllowed, OUTRO_MS } from './intro.js';
import { setTheme, startupTheme } from './theme.js';
import { loadUserSettings } from '../core/user-settings.js';

/**
 * The stream Ink reads: real stdin, with a trailing Enter delivered separately.
 *
 * Ink drives it with setEncoding/'readable'/read() and owns raw mode, so the
 * PassThrough has to look enough like a TTY for that: `isTTY` decides whether
 * raw mode is supported at all, and setRawMode/ref/unref forward to the real fd.
 *
 * This used to strip mouse reports as well. It no longer needs to — the app
 * never turns terminal mouse tracking on — and with the mouse went the 20ms
 * escape timeout that stripping required, so Escape now stops the agent the
 * instant it is pressed.
 */
function createInkStdin() {
  const stream = new PassThrough();
  stream.isTTY = Boolean(process.stdin.isTTY);
  stream.isRaw = false;
  stream.setRawMode = (mode) => {
    process.stdin.setRawMode?.(mode);
    stream.isRaw = mode;
    return stream;
  };
  stream.ref = () => {
    process.stdin.ref?.();
    return stream;
  };
  stream.unref = () => {
    process.stdin.unref?.();
    return stream;
  };
  return stream;
}

/**
 * Setup first, on a person's first start, then the app — never both at once.
 * App mounts only after setup ends, so the banner it commits to <Static> is
 * drawn in the theme just chosen and carries the name just given.
 */
function Root({ agentLoop, wsServer, welcome, animate = false, outro = false }) {
  const [settingUp, setSettingUp] = useState(welcome);
  // Setup has just played its own splash; the header does not draw in twice.
  const [introDone, setIntroDone] = useState(!animate || welcome);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!outro) return undefined;
    // Exit asks for the goodbye and waits for it (capped in farewell.js);
    // swapping the app out leaves the scrollback it committed where it is.
    registerOutro(() => new Promise((resolve) => {
      setClosing(true);
      setTimeout(resolve, OUTRO_MS);
    }));
    return () => registerOutro(null);
  }, [outro]);
  // App draws the goodbye itself, in place of its live frame. Swapping App out
  // for it instead left Ink laying out the Static it had owned: ~90 blank rows
  // a frame, pushing the transcript off screen (measured under the pty).
  if (closing && (settingUp || !introDone)) return <Goodbye />;
  if (settingUp) {
    return <Onboarding agentLoop={agentLoop} wsServer={wsServer} onDone={() => setSettingUp(false)} />;
  }
  if (!introDone) return <Intro agentLoop={agentLoop} onDone={() => setIntroDone(true)} />;
  return <App agentLoop={agentLoop} wsServer={wsServer} closing={closing} />;
}

export class CliUI {
  constructor(agentLoop, wsServer, { welcome = false } = {}) {
    this.agentLoop = agentLoop;
    this.wsServer = wsServer;
    this.welcome = welcome;
  }

  start() {
    // No clear on the way in: the shell line that launched the agent stays
    // above the header, as Claude Code's does, and exit erases back to it
    // (screen-span.js). `console.clear()` here used to wipe it.
    const ttyIO = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    const span = ttyIO ? createScreenSpan({ rows: process.stdout.rows }) : null;
    let cursorWaiter = null;
    if (span) {
      const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk, ...rest) => {
        try { span.feed(chunk); } catch { /* following the cursor must never stop output */ }
        return write(chunk, ...rest);
      };
      process.stdout.on('resize', () => span.resize(process.stdout.rows));
      registerScreen({
        span,
        // Exit's question. The answer comes back on stdin, taken out below
        // before Ink can type it into the prompt.
        askRow: (timeoutMs) => new Promise((resolve) => {
          const timer = setTimeout(() => { cursorWaiter = null; resolve(null); }, timeoutMs);
          cursorWaiter = (row) => { clearTimeout(timer); cursorWaiter = null; resolve(row); };
          write(ASK_CURSOR);
        }),
      });
    }

    // A terminal left in a tracking mode by a previous crashed run would still
    // be spraying mouse reports into our stdin, and Ink has no parser for them:
    // they would be typed into the prompt as literal text. Turning every mode
    // off once on the way up is a no-op when tracking was never on.
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?9l');
    }

    const inkStdin = createInkStdin();
    let pasteState = { inPaste: false };
    const interrupt = interruptGate();

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (raw) => {
      // Cursor reports are answers to our own questions, never keys.
      let chunk = String(raw);
      if (span) {
        let m;
        while ((m = chunk.match(CURSOR_REPORT))) {
          const row = Number(m[1]);
          if (cursorWaiter) cursorWaiter(row);
          else span.start(row);
          chunk = chunk.replace(m[0], '');
        }
        if (!chunk) return;
      }
      // Application chords come out first and are dispatched on the side. They
      // must never reach Ink: `ink-text-input` types any key it does not
      // recognise straight into the prompt, so ctrl+e used to leave an "e"
      // behind on its way to toggling the transcript.
      const stripped = extractHotkeys(String(chunk), pasteState);
      pasteState = stripped.state;
      for (const name of stripped.hotkeys) {
        // The second ctrl+c exits from here, below React, so a broken render
        // can never trap someone in the app. The first is React's to draw.
        if (name === 'interrupt' && interrupt() === 'exit') {
          exitWithFarewell({ agentLoop: this.agentLoop, wsServer: this.wsServer });
          continue;
        }
        hotkeys.emit(name);
      }
      if (!stripped.text) return;

      const [text, enter] = splitTrailingEnter(stripped.text);
      if (text) inkStdin.write(text);
      // Deferred, not written back to back: Ink's read() drains everything
      // buffered at once, so two immediate writes would arrive as the single
      // chunk this is here to take apart.
      if (enter) setImmediate(() => inkStdin.write(enter));
    });

    // Before the first frame: a theme applied after it would draw the banner in
    // the old colours, and <Static> never repaints it.
    setTheme(startupTheme(process.env, loadUserSettings().theme));

    // Where the session begins: asked before the first frame, in raw mode so
    // the answer is neither echoed nor held for a newline. Ink turns raw mode
    // on itself a moment later; the answer is matched out of stdin above.
    if (span) {
      try { process.stdin.setRawMode?.(true); } catch { /* then exit clears instead */ }
      process.stdout.write(ASK_CURSOR);
    }

    const tty = Boolean(process.stdout.isTTY);
    const animate = animationAllowed({ isTTY: tty, rows: process.stdout.rows || 0 });
    const outro = animationAllowed({ isTTY: tty, rows: Infinity });
    const instance = render(<Root agentLoop={this.agentLoop} wsServer={this.wsServer} welcome={this.welcome}
      animate={animate} outro={outro} />, {
      stdin: inkStdin,
      // ctrl+c is ours — see hotkeys.js. Ink's default unmounted the app and
      // left the process alive behind a frozen prompt.
      exitOnCtrlC: false,
      // Terminals report Shift+Enter as a plain Enter unless the kitty
      // keyboard protocol is negotiated. Ink's auto mode asks (CSI ? u) and
      // only enables it if the terminal answers, so terminals that don't
      // support it are unaffected — they can still send Esc+Enter instead.
      kittyKeyboard: { mode: 'auto', flags: ['disambiguateEscapeCodes'] },
    });
    registerInk(instance);
  }
}
