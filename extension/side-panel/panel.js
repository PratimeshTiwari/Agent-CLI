/**
 * Agent CLI — Side Panel JavaScript
 *
 * Agent terminal UI: handles user input, displays messages,
 * renders diffs with accept/reject, and manages slash commands.
 */

// ── DOM Elements ─────────────────────────────────────────────────────
const messageStream = document.getElementById('message-stream');
const welcomeMessage = document.getElementById('welcome-message');
const commandInput = document.getElementById('command-input');
const sendBtn = document.getElementById('send-btn');
const inputArea = document.getElementById('input-area');
const connectionDot = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');
const modeToggle = document.getElementById('mode-toggle');
const modeIcon = document.getElementById('mode-icon');
const modeText = document.getElementById('mode-text');

// ── State ────────────────────────────────────────────────────────────
let currentMode = 'plan';
let isConnected = false;
let isWaitingForResponse = false;
let currentWorkspace = '';
let historyRestored = false;
let historyRequested = false;

// ── Initialization ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  showVersion();
  checkConnectionStatus(true);
  watchConnection();
  setupEventListeners();
});

/**
 * Stamp the loaded build into the status bar.
 *
 * Read from the manifest rather than written here, so it is the version Chrome
 * actually loaded and not a number someone forgot to change. This exists
 * because three artifacts ship from one repo — the bundled service worker, the
 * unbundled content scripts, and the .vsix — and a pull updates none of them in
 * the browser until it is reloaded. "Which one is running" is the first
 * question whenever the answer is "it behaves like the old one".
 */
function showVersion() {
  const el = document.getElementById('ext-version');
  if (!el) return;
  try {
    el.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch {
    el.remove();
  }
}

function setupEventListeners() {
  // Send message
  sendBtn.addEventListener('click', sendMessage);
  commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
      return;
    }
    backspaceTag(e);
  });
  // An image on the clipboard goes in as an `[Image #n]` tag.
  commandInput.addEventListener('paste', onPasteImage);
  // A dropped file goes in as a `[File #n: name]` tag (v6.17), anywhere on
  // the panel. `dragover` must be cancelled or the browser never fires `drop`.
  const dragHasFiles = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'text/uri-list');
  document.addEventListener('dragover', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    inputArea.classList.add('drop-target');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) inputArea.classList.remove('drop-target');
  });
  document.addEventListener('drop', (e) => {
    inputArea.classList.remove('drop-target');
    onDropFiles(e);
    commandInput.focus();
  });

  // Auto-resize textarea, and light the send button once there is something
  // to send. Muted-until-useful was half the idea; without this half the
  // button looks equally dead whether the box is empty or full.
  commandInput.addEventListener('input', () => {
    commandInput.style.height = 'auto';
    commandInput.style.height = Math.min(commandInput.scrollHeight, 150) + 'px';
    reflectSendState();
  });

  // Mode toggle
  modeToggle.addEventListener('click', toggleMode);

  setupPopout();
  setupWorkspace();
  setupSurfaces();
  setupSessions();
  setupNewChat();
}

/**
 * Start another conversation, without typing a command to do it.
 *
 * `/new` works from here now, but a button is what people reach for — and the
 * thing it does is not destructive, which is worth the affordance: the old
 * conversation is filed, not lost, and `↺` has it.
 */
function setupNewChat() {
  const btn = document.getElementById('new-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!isConnected) { appendStatus('Not connected — start the agent first.'); return; }
    chrome.runtime.sendMessage({ type: 'slash_command', payload: { command: 'new', args: [] } });
  });
}

/**
 * The drawer of past conversations.
 *
 * The storage and the `--sessions` flag landed before any way to reach them
 * from here, which is the same as not having them: reported as "I reopened the
 * sidebar and there is no option to continue".
 *
 * Each row says whether resuming would **continue** or need a **recap**,
 * because those are different promises. The agent's memory is the browser
 * chat thread, not our transcript — if the tab has moved on, the model was
 * never part of that conversation, and saying "resumed" without saying so
 * produces confident answers about work it never did.
 */
function setupSessions() {
  const btn = document.getElementById('sessions-btn');
  const drawer = document.getElementById('sessions-drawer');
  const close = document.getElementById('sessions-close');
  if (!btn || !drawer) return;

  const hide = () => { drawer.hidden = true; };
  close?.addEventListener('click', hide);

  btn.addEventListener('click', () => {
    if (!drawer.hidden) { hide(); return; }
    if (!isConnected) { appendStatus('Not connected — start the agent first.'); return; }
    document.getElementById('sessions-list').textContent = 'Loading…';
    drawer.hidden = false;
    chrome.runtime.sendMessage({ type: 'list_sessions' });
  });
}

/** Draw the list the server sent. */
function renderSessions(payload) {
  const list = document.getElementById('sessions-list');
  if (!list) return;
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];

  if (sessions.length === 0) {
    list.innerHTML = '<div class="drawer-empty">No past conversations yet.<br>'
      + 'One is kept each time you run <code>/new</code> or restart the agent.</div>';
    return;
  }

  list.innerHTML = sessions.map((s) => {
    const when = s.updated
      ? new Date(s.updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    // `continue` is the only one that needs no explaining; the others say what
    // resuming will actually do.
    const note = s.resume === 'continue'
      ? '<span class="sess-continue">the tab still holds this</span>'
      : '<span class="sess-recap">needs a recap</span>';
    return `
      <button class="sess" type="button" data-id="${escapeHtml(s.id)}">
        <div class="sess-title">${escapeHtml(s.title || 'Untitled')}</div>
        <div class="sess-meta">${s.turns} turns · ${escapeHtml(when)} · ${note}</div>
      </button>`;
  }).join('');

  for (const row of list.querySelectorAll('.sess')) {
    row.addEventListener('click', () => {
      document.getElementById('sessions-drawer').hidden = true;
      chrome.runtime.sendMessage({ type: 'resume_session', payload: { id: row.dataset.id } });
    });
  }
}

/**
 * One page, three surfaces, and the buttons that move between them.
 *
 * The toolbar icon opens this as a **popup**, which Chrome closes the moment it
 * loses focus — right for asking something, wrong for watching a turn that
 * takes a minute. So the popup offers the two places you can stay: `⊟` docks it
 * to the side panel, `⧉` floats it as its own window.
 *
 * Each button hides itself where it does not apply, so no surface offers to
 * become what it already is.
 */
/**
 * Does the send button look like it can do anything?
 *
 * Three states, not two: nothing typed (inert), something typed (live), and a
 * turn in flight (disabled). The middle one was missing — the button was muted
 * until hover whether the box was empty or not, so the only feedback that a
 * message was ready to go was the text you had just typed.
 */
function reflectSendState() {
  const ready = commandInput.value.trim().length > 0 && !isWaitingForResponse;
  sendBtn.classList.toggle('ready', ready);
}

function setupSurfaces() {
  const mode = new URLSearchParams(location.search);
  const dock = document.getElementById('dock-btn');
  if (!dock) return;

  // The side panel is already the side panel; the floating window is a
  // deliberate choice to leave the browser chrome behind.
  if (!mode.get('popup')) { dock.remove(); return; }

  document.body.classList.add('is-popup');

  dock.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      // `sidePanel.open` needs a user gesture, which this click is.
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    } catch (err) {
      appendStatus(`Could not open the side panel: ${err.message}`);
    }
  });
}

/**
 * Change the workspace from the panel.
 *
 * The same act as `/workspace <path>` in the CLI, and the same code behind it
 * — `core/restart.js` owns validation, the supervisor check and the handover
 * file, so the two front-ends cannot disagree about what a usable workspace is.
 *
 * `prompt()` rather than a file picker: a Chrome extension page cannot open a
 * native folder chooser, and `<input type="file" webkitdirectory>` gives you a
 * *copy* of the directory's contents, not its path — the one thing needed
 * here. The CLI has a real picker for people who want one.
 *
 * It restarts the agent, so the socket will drop and come back. That is the
 * honest signal that it worked, and it is why the reply is a status line
 * rather than a silent change.
 */
function setupWorkspace() {
  const btn = document.getElementById('workspace-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!isConnected) {
      appendStatus('Not connected — start the agent first.');
      return;
    }
    // Ask the *agent* to open the chooser. An extension page cannot open a
    // native dialog, and `<input webkitdirectory>` gives back a copy of the
    // directory's contents rather than its path — the only thing needed here.
    // The agent runs on this machine, so its dialog is this machine's dialog.
    chrome.runtime.sendMessage({ type: 'pick_workspace' });
  });
}

/**
 * Typing the path, for when there is no chooser to open.
 *
 * Reached only from the server saying so — a headless box, or a Linux session
 * with no display. Offering a text box first would be worse for everyone with
 * a desktop.
 */
function promptForWorkspace() {
  // eslint-disable-next-line no-alert
  const next = window.prompt('Workspace path for the agent to work in:', currentWorkspace || '');
  if (next === null) return;
  const target = next.trim();
  if (!target || target === currentWorkspace) return;
  chrome.runtime.sendMessage({ type: 'set_workspace', payload: { path: target } });
}

/**
 * Open this same page as a floating window.
 *
 * Chrome's side panel is docked and there is no API to float it — Chrome's own
 * Gemini panel sits in the same dock for the same reason. A popup window is a
 * real OS window: movable anywhere, including onto another monitor, and it is
 * this exact page, so nothing about the messaging changes.
 *
 * The button hides itself when we *are* the floating window, because a popup
 * that can spawn another popup is a way to end up with four of them.
 */
function setupPopout() {
  const btn = document.getElementById('popout-btn');
  if (!btn) return;

  if (new URLSearchParams(location.search).get('window') === '1') {
    btn.remove();
    return;
  }

  btn.addEventListener('click', async () => {
    try {
      await chrome.windows.create({
        url: chrome.runtime.getURL('side-panel/panel.html?window=1'),
        type: 'popup',
        width: 460,
        height: 760,
      });
    } catch (err) {
      appendStatus(`Could not open a floating window: ${err.message}`);
    }
  });
}

// ── Connection ──────────────────────────────────────────────────────
/** How often the dot re-reads the truth. */
const STATUS_POLL_MS = 4000;

/**
 * Keep the connection dot honest.
 *
 * `connection_status` is broadcast only when the socket *transitions*, so a
 * panel opened while the socket is already up receives nothing and has exactly
 * one sample to go on: this call, at load. One sample is the bug — a floating
 * window opened at the wrong moment showed "Disconnected" over a working
 * bridge and had no way to ever find out otherwise, while the docked panel two
 * inches away showed "Connected" from its own luckier sample.
 *
 * The moment is easy to lose: MV3 recycles the service worker constantly, and
 * a worker woken *by this very message* has `ws === null` until it reconnects.
 *
 * So it is polled. A status indicator that samples once is wrong by
 * construction, and the read is a boolean from a worker that is awake anyway.
 *
 * @param {boolean} initial - only the first check asks the worker to connect.
 *   Repeating that would restart the retry ladder every few seconds and keep
 *   the backoff permanently at its first rung.
 */
/**
 * Is this page still attached to the extension it came from?
 *
 * Reloading the extension **orphans every page already open from it**. The page
 * keeps running, and `chrome.runtime.id` disappears; every API call from then
 * on throws `Extension context invalidated`. Nothing repairs it — no amount of
 * polling, no reconnect — because the link, not the socket, is what is gone.
 *
 * The content scripts have detected this for a while, by exactly this test.
 * The panel did not, and the cost was a specific, repeated confusion: a
 * **floating window** survives extension reloads that close and reopen the
 * docked panel, so it is the surface most likely to be orphaned — and it
 * reported the state as "Disconnected", which sends the reader looking for a
 * problem with the *agent* when the window simply needs reopening.
 */
function contextAlive() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

let orphaned = false;

/** Say what actually happened, and stop pretending polling will help. */
function markOrphaned() {
  if (orphaned) return;
  orphaned = true;
  updateConnectionUI(false);
  if (connectionText) connectionText.textContent = 'Extension reloaded';
  appendStatus('This window was opened before the extension reloaded, so it is no '
    + 'longer connected to it — nothing here will update. Close it and open a new '
    + 'one from the toolbar icon.');
}

async function checkConnectionStatus(initial = false) {
  if (orphaned) return;
  if (!contextAlive()) { markOrphaned(); return; }

  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_status' });
    const connected = response?.connected || false;
    updateConnectionUI(connected);

    // Ask for the conversation, once, as soon as there is a bridge to ask.
    //
    // The server sends history when the *socket* connects, and opening this
    // panel does not reconnect it — the service worker holds one socket for the
    // whole browser session. So a panel opened afterwards is a fresh page
    // arriving mid-connection, which is why reopening the sidebar looked like
    // it had lost the chat.
    if (connected && !historyRequested) {
      historyRequested = true;
      chrome.runtime.sendMessage({ type: 'get_history' }).catch(() => {});
    }

    if (initial && !connected) {
      // Free and idempotent: connectWebSocket returns immediately if one is
      // already open or opening.
      chrome.runtime.sendMessage({ type: 'connect' }).catch(() => {});
    }
  } catch (err) {
    // An orphaned page throws here too, and it is a different fact from a
    // bridge that is merely down: one is repaired by starting the agent, the
    // other only by reopening the window.
    if (!contextAlive() || /context invalidated/i.test(err?.message || '')) {
      markOrphaned();
      return;
    }
    updateConnectionUI(false);
  }
}

function watchConnection() {
  setInterval(() => checkConnectionStatus(), STATUS_POLL_MS);
  // A floating window can sit behind the browser for a long time, where Chrome
  // throttles timers hard. Coming back to it should not mean waiting for the
  // next tick to learn the truth.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkConnectionStatus();
  });
  window.addEventListener('focus', () => checkConnectionStatus());
}

function updateConnectionUI(connected) {
  isConnected = connected;
  connectionDot.className = `dot ${connected ? 'connected' : 'disconnected'}`;
  connectionText.textContent = connected ? 'Connected' : 'Disconnected';

  if (connected && welcomeMessage) {
    // Don't auto-remove welcome, let first message do it
  }
}

// ── Mode Toggle ─────────────────────────────────────────────────────
// The CLI's order (server/src/core/modes.js): plan → auto → strict.
const MODE_ORDER = ['plan', 'auto', 'strict'];

function toggleMode() {
  currentMode = MODE_ORDER[(MODE_ORDER.indexOf(currentMode) + 1) % MODE_ORDER.length];
  updateModeUI();

  // Send slash command to server
  chrome.runtime.sendMessage({
    type: 'slash_command',
    payload: { command: currentMode, args: [] },
  });
}

function updateModeUI() {
  // `●` / `○`, the same two glyphs the CLI's status bar uses for connected and
  // not. Filled means it acts on its own; hollow means it asks first.
  // Strict asks for everything, Markdown included; plan lets the repo's own
  // Markdown through. `◎` so the two plan-like modes are not one glyph.
  if (currentMode === 'auto') {
    modeIcon.textContent = '●';
    modeText.textContent = 'Auto';
    modeToggle.classList.add('auto-mode');
  } else {
    modeIcon.textContent = currentMode === 'strict' ? '◎' : '○';
    modeText.textContent = currentMode === 'strict' ? 'Strict' : 'Plan';
    modeToggle.classList.remove('auto-mode');
  }
}

// ── Send Message ────────────────────────────────────────────────────
/**
 * What to do when there is no agent to send to.
 *
 * Said only when someone actually tries to send something — the dot has been
 * telling them the state all along, and the panel used to announce it
 * repeatedly, unprompted, until the conversation was off the screen.
 *
 * Both causes are named because the panel genuinely cannot tell them apart: no
 * agent running, or an agent running behind a stale bridge. The second is the
 * one people do not guess, and it is the ordinary outcome of pulling an update
 * — the content scripts and the bundle only change in the browser when it is
 * reloaded.
 */
function explainDisconnected() {
  appendStatus(
    'Not connected to the agent.\n\n'
    + '  Start it in a terminal:  `agent`\n\n'
    + '  Already running? The bridge in this browser is stale — hard-refresh\n'
    + '  the Gemini tab (⌘⇧R), or reload the extension at chrome://extensions.',
  );
}

/*
 * Prompts this panel sent, drawn already, whose `user_turn` is still to come.
 *
 * The loop tells every surface what was asked, so a prompt typed in the
 * terminal appears here too (reported with a screenshot, 2026-10-26: replies
 * arrived, the questions never did). The panel drew its own on send, so its
 * own come back once and are skipped — matched by content rather than by
 * client, because the Chrome panel and the VS Code panel are both "the panel".
 */
const ownSends = [];

function takeOwnEcho(content) {
  const at = ownSends.indexOf(content);
  if (at < 0) return false;
  ownSends.splice(at, 1);
  return true;
}

/*
 * A recorded prompt with images in it, as it is drawn: the loop records one
 * `[Image #n: <path>] …` line and an `<image_data>` placeholder per image above
 * the message, whose own `[Image #n]` tags stay. The format before 2026-10-26
 * was one `[Image attached: <path> …]` line. Kept in step with `foldImages` in
 * the CLI's ui/image-attach.js.
 */
function foldImageHeader(text) {
  const s = String(text ?? '');
  if (s.startsWith('[Image attached:')) {
    return s.replace(/^\[Image attached:[^\n]*\]\s*/, '[Image] ')
      .replace(/<image_data>[\s\S]*?<\/image_data>\s*/, '');
  }
  return s.replace(/^(?:\[Image #\d+: [^\]\n]+\][^\n]*\n<image_data>[^\n]*?<\/image_data>\n?)+\n*/, '');
}

/*
 * Images pasted into the box, the way the terminal takes them (2026-10-26).
 *
 * A pasted image puts `[Image #n]` at the caret; it goes with the message only
 * while its tag is in the text, and backspace takes a tag in one press. On send
 * each one becomes the same block the terminal sends — a header, then its
 * `<image_data>` — with `pasted` where the terminal names the file, because a
 * panel cannot write one. The server writes it and puts the real path in, so
 * from there a panel image is recorded, linked and resumed like a terminal one.
 */
let pastedImages = [];
let pastedCount = 0;
const imageTag = (n) => `[Image #${n}]`;

function insertAtCaret(el, text) {
  const from = el.selectionStart ?? el.value.length;
  const to = el.selectionEnd ?? from;
  const before = el.value.slice(0, from);
  const after = el.value.slice(to);
  const put = `${before && !/\s$/.test(before) ? ' ' : ''}${text}${/^\s/.test(after) ? '' : ' '}`;
  el.value = before + put + after;
  el.setSelectionRange(from + put.length, from + put.length);
}

function onPasteImage(e) {
  const files = [...(e.clipboardData?.items || [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!files.length) return;            // text pastes as text
  e.preventDefault();
  for (const file of files) addImage(file);
}

function addImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    pastedCount += 1;
    pastedImages.push({ n: pastedCount, dataUrl: reader.result, mime: file.type, sizeKB: Math.max(1, Math.round(file.size / 1024)) });
    insertAtCaret(commandInput, imageTag(pastedCount));
    commandInput.dispatchEvent(new Event('input'));
  };
  reader.readAsDataURL(file);
}

/*
 * Files dropped on the panel (v6.17, plan Phase 8).
 *
 * The terminal sends a dropped file's *path* and lets the model read the range
 * it needs. A panel cannot always do that:
 * - **Chrome** hands the page the file but never its path. An image goes in as
 *   a pasted one would; a text file up to 8 KB goes in whole, as a
 *   `<file name=…>` block; anything larger is refused, with the way that works.
 * - **VS Code** passes `text/uri-list` for a file dragged from the explorer
 *   (hold shift to drop into a webview), so the path is sent, as the terminal
 *   sends it, and nothing is read here.
 * Either way it is a `[File #n: name]` tag at the caret, and it goes only while
 * the tag is in the text — the same rule as images.
 */
const DROP_INLINE_MAX = 8 * 1024;
let droppedFiles = [];
let droppedCount = 0;
const fileTag = (f) => `[File #${f.n}: ${f.name}]`;
const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);

/** `file://` URLs from a uri-list; comments and anything else are skipped. */
function droppedPaths(uriList) {
  return String(uriList || '').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.startsWith('file://'))
    .map((u) => {
      try { return decodeURIComponent(new URL(u).pathname).replace(/^\/([A-Za-z]:\/)/, '$1'); } catch { return null; }
    })
    .filter(Boolean);
}

function addFileTag(f) {
  droppedCount += 1;
  const entry = { n: droppedCount, ...f };
  droppedFiles.push(entry);
  insertAtCaret(commandInput, fileTag(entry));
  commandInput.dispatchEvent(new Event('input'));
}

function onDropFiles(e) {
  const dt = e.dataTransfer;
  if (!dt) return;
  const paths = droppedPaths(dt.getData?.('text/uri-list'));
  const files = [...(dt.files || [])];
  if (!paths.length && !files.length) return;   // a text drag stays the browser's
  e.preventDefault();
  if (paths.length) {
    for (const p of paths) addFileTag({ name: baseName(p), path: p });
    return;
  }
  for (const file of files) {
    if (file.type?.startsWith('image/')) { addImage(file); continue; }
    if (file.size > DROP_INLINE_MAX) {
      appendStatus(`${file.name} is ${Math.round(file.size / 1024)} KB — too large to drop here. `
        + 'Drop it in the terminal, which can send the path.');
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      if (text.includes('\u0000')) {
        appendStatus(`${file.name} is not a text file. Drop it in the terminal, which can send the path.`);
        return;
      }
      addFileTag({ name: file.name, text, sizeKB: Math.max(1, Math.round(file.size / 1024)) });
    };
    reader.readAsText(file);
  }
}

function backspaceTag(e) {
  if (e.key !== 'Backspace') return;
  const el = commandInput;
  if (el.selectionStart !== el.selectionEnd) return;
  const at = el.selectionStart;
  const m = /\[(?:Image #\d+|File #\d+: [^\]\n]+)\] ?$/.exec(el.value.slice(0, at));
  if (!m) return;
  e.preventDefault();
  el.value = el.value.slice(0, m.index) + el.value.slice(at);
  el.setSelectionRange(m.index, m.index);
  el.dispatchEvent(new Event('input'));
}

/** The images whose tags are in `content`, as the block that goes in front of it. */
function imageBlock(content) {
  const used = pastedImages.filter((img) => content.includes(imageTag(img.n)));
  const block = used.length
    ? `${used.map((img) => `[Image #${img.n}: pasted] (${img.sizeKB}KB, ${img.mime})\n<image_data>\n${img.dataUrl}\n</image_data>`).join('\n')}\n\n`
    : '';
  return { used, block };
}

/**
 * The dropped files whose tags are in `content`, as the block in front of it:
 * every header line first (the server folds those off for display, as it does
 * the terminal's), then the inline texts.
 */
function fileBlock(content) {
  const used = droppedFiles.filter((f) => content.includes(fileTag(f)));
  if (!used.length) return { used, block: '' };
  const lines = (t) => t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
  const headers = used.map((f) => (f.path
    ? `[File #${f.n}: ${f.path}] (dropped from the editor) — read it with read_file`
    : `[File #${f.n}: ${f.name}] (${f.sizeKB} KB, ${lines(f.text)} lines, dropped in the panel) — its text follows`));
  const bodies = used.filter((f) => !f.path)
    .map((f) => `<file name="${f.name.replace(/"/g, "'")}">\n${f.text.replace(/\n$/, '')}\n</file>`);
  return { used, block: `${headers.join('\n')}\n\n${bodies.length ? `${bodies.join('\n')}\n\n` : ''}` };
}

function sendMessage() {
  const content = commandInput.value.trim();
  if (!content || isWaitingForResponse) return;

  if (orphaned) {
    if (welcomeMessage) welcomeMessage.remove();
    appendMessage('user', content);
    markOrphaned();
    commandInput.value = '';
    reflectSendState();
    return;
  }

  // Asked at the point of use, not announced beforehand.
  if (!isConnected) {
    if (welcomeMessage) welcomeMessage.remove();
    appendMessage('user', content);
    explainDisconnected();
    commandInput.value = '';
    commandInput.style.height = 'auto';
    return;
  }

  // Clear welcome message
  if (welcomeMessage) {
    welcomeMessage.remove();
  }

  // Check for slash commands
  if (content.startsWith('/')) {
    handleSlashCommand(content);
    commandInput.value = '';
    commandInput.style.height = 'auto';
    return;
  }

  // Display user message
  appendMessage('user', content);
  ownSends.push(content);

  // Send to service worker → server, with the images whose tags it carries.
  const { used, block } = imageBlock(content);
  pastedImages = pastedImages.filter((img) => !used.includes(img));
  const dropped = fileBlock(content);
  droppedFiles = droppedFiles.filter((f) => !dropped.used.includes(f));
  chrome.runtime.sendMessage({
    type: 'user_message',
    // The terminal's order: images, then file headers, then the message.
    payload: { content: block + dropped.block + content },
  });

  // Clear input
  commandInput.value = '';
  commandInput.style.height = 'auto';
  reflectSendState();

  // Show thinking indicator
  showThinking();
  isWaitingForResponse = true;
  sendBtn.disabled = true;
  reflectSendState();
}

function handleSlashCommand(input) {
  const parts = input.slice(1).split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);

  // Handle local commands
  if (MODE_ORDER.includes(command)) {
    currentMode = command;
    updateModeUI();
  }

  if (!isConnected) {
    appendMessage('user', input);
    explainDisconnected();
    return;
  }

  // Display the command
  appendStatus(`/${command} ${args.join(' ')}`.trim());

  // Send to server
  chrome.runtime.sendMessage({
    type: 'slash_command',
    payload: { command, args },
  });
}

// ── Message Rendering ───────────────────────────────────────────────
/**
 * Markdown, to the small extent the panel needs it.
 *
 * The reply is model output, so **escaping comes first** and the formatting is
 * applied to the already-escaped string — a `<` in the text can never become a
 * tag, whatever the model wrote.
 *
 * Deliberately not a markdown library: the panel is a plain page with no build
 * step, and the whole of what a reply actually uses is fenced blocks, inline
 * code and bold. Lists and tables are left as their source, which reads fine
 * in a monospace column; the alternative was shipping a parser to the browser
 * for two constructs.
 */
function renderMarkdownish(text) {
  const escaped = escapeHtml(String(text ?? ''));
  const blocks = [];

  // Fenced blocks are lifted out first so their contents are never treated as
  // inline markup — a `**` inside a shell command is not bold.
  const withoutFences = escaped.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    blocks.push(`<pre class="md-code"${lang.trim() ? ` data-lang="${lang.trim()}"` : ''}>`
      + `<code>${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });

  const inline = withoutFences
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code class="md-inline">$1</code>');

  return inline.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)] ?? '');
}

function appendMessage(role, content) {
  const div = document.createElement('div');
  div.className = `message message-${role}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  // The user's own message is shown exactly as typed; only the agent's reply
  // is formatted, and that path escapes before it formats.
  if (role === 'user') contentDiv.textContent = content;
  else contentDiv.innerHTML = renderMarkdownish(content);

  div.appendChild(contentDiv);
  messageStream.appendChild(div);
  scrollToBottom();
}

function appendToolCall(name, args, verb) {
  const div = document.createElement('div');
  div.className = 'message-tool';

  // A one-line summary of the arguments.
  //
  // The old version interpolated non-strings straight into a template, so an
  // array of objects — `ask_question`'s `questions`, every time — rendered as
  // `[object Object],[object Object]`, which tells the reader nothing at all
  // and looks like a bug in the agent rather than in this line.
  const preview = (value) => {
    if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 39)}…` : value;
    if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
    if (value && typeof value === 'object') {
      // The field people actually recognise, if it has one.
      const named = value.name ?? value.path ?? value.question ?? value.label;
      return typeof named === 'string' ? preview(named) : '{…}';
    }
    return String(value);
  };

  const argsPreview = args && typeof args === 'object'
    ? Object.entries(args).map(([k, v]) => `${k}: ${preview(v)}`).join(', ')
    : preview(args);

  // The terminal's row (v6.5): `● Run(npm test)`. The verb is the server's,
  // from the tool catalog, so both surfaces name a call one way; the subject
  // is the one argument that says what the call is about, and a tool without
  // one keeps the argument preview.
  const subject = ['path', 'command', 'pattern', 'query', 'symbol', 'role']
    .map((k) => args?.[k]).find((v) => typeof v === 'string' && v.trim());
  div.innerHTML = `
    <div class="tool-header">
      <span class="tool-dot">●</span>
      <span class="tool-name">${escapeHtml(verb || name)}</span>
      <span class="tool-args">${escapeHtml(subject ? `(${preview(subject.trim())})` : argsPreview)}</span>
    </div>
    <div class="tool-details">${escapeHtml(JSON.stringify(args, null, 2))}</div>
  `;
  // A listener, not an `onclick` attribute: an extension page's default CSP
  // refuses inline handlers, so the attribute never ran — the row could not
  // be expanded. Same reason as the diff buttons below.
  div.querySelector('.tool-header').addEventListener('click', (e) => {
    e.currentTarget.nextElementSibling.classList.toggle('expanded');
  });

  messageStream.appendChild(div);
  scrollToBottom();
}

function appendToolResult(name, success, result, error) {
  const lastTool = messageStream.querySelector('.message-tool:last-of-type');
  if (lastTool) {
    lastTool.classList.add(success ? 'tool-result-success' : 'tool-result-error');

    const details = lastTool.querySelector('.tool-details');
    if (details) {
      const resultStr = error || (typeof result === 'string' ? result : JSON.stringify(result, null, 2));
      details.textContent += '\n\n─── Result ───\n' + resultStr.substring(0, 2000);
    }
  }
}

function appendDiff(diffData) {
  const { diffId, filePath, patch, hunks, riskLevel, riskReason } = diffData;

  const div = document.createElement('div');
  div.className = 'diff-container';
  div.id = `diff-${diffId}`;

  // Parse patch into lines
  const diffLines = (patch || '').split('\n').map(line => {
    let cls = 'context';
    if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
    else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
    else if (line.startsWith('@@')) cls = 'hunk-header';
    return `<div class="diff-line ${cls}">${escapeHtml(line)}</div>`;
  }).join('');

  div.innerHTML = `
    <div class="diff-header">
      <span class="diff-file-path">📄 ${escapeHtml(filePath)}</span>
      <span class="diff-status pending">PENDING</span>
    </div>
    <div class="diff-content">${diffLines}</div>
    <div class="diff-actions">
      <button class="diff-btn accept" data-action="accept">
        ✅ Accept
      </button>
      <button class="diff-btn reject" data-action="reject">
        ❌ Reject
      </button>
    </div>
  `;
  /*
   * Listeners, not `onclick="respondToDiff(…)"`. MV3's default CSP for
   * extension pages is `script-src 'self'`, which refuses inline handlers —
   * so Accept and Reject were buttons that did nothing, and a turn parked on
   * a diff approval could not be answered from the panel at all. The VS Code
   * webview's CSP refuses them for the same reason. The attribute also
   * interpolated `diffId` into script, which a closure does not.
   */
  div.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => window.respondToDiff(diffId, btn.dataset.action));
  });

  messageStream.appendChild(div);
  scrollToBottom();
}

/**
 * A status line, or — when it is not a line at all — a block.
 *
 * `status-text` is a small rounded pill, which is right for "🧹 history
 * cleared" and wrong for the answer to `/effort`, a multi-line listing that
 * arrives on the same channel. Crammed into a pill with no `pre-wrap` it came
 * out as a wall of run-together prose with its markdown showing.
 */
let lastStatusText = '';

function appendStatus(text) {
  const body = String(text ?? '');

  // Identical consecutive statuses collapse. Nothing should be able to fill
  // this panel with one repeated sentence again, whatever starts doing it.
  if (body && body === lastStatusText) return;
  lastStatusText = body;
  const isBlock = body.includes('\n') || body.length > 120;

  const div = document.createElement('div');
  div.className = `message message-status${isBlock ? ' status-block' : ''}`;
  div.innerHTML = isBlock
    ? `<div class="status-body">${renderMarkdownish(body)}</div>`
    : `<span class="status-text">${escapeHtml(body)}</span>`;
  messageStream.appendChild(div);
  scrollToBottom();
}

function appendError(text) {
  const div = document.createElement('div');
  div.className = 'message message-error';
  div.innerHTML = `<div class="message-content">❌ ${escapeHtml(text)}</div>`;
  messageStream.appendChild(div);
  scrollToBottom();
}

function showThinking() {
  removeThinking();
  const div = document.createElement('div');
  div.className = 'thinking';
  div.id = 'thinking-indicator';
  div.innerHTML = `
    <div class="thinking-dots"><span></span><span></span><span></span></div>
    <span>Thinking...</span>
  `;
  messageStream.appendChild(div);
  scrollToBottom();
}

function removeThinking() {
  const el = document.getElementById('thinking-indicator');
  if (el) el.remove();
}

/**
 * The agent's own checklist, pinned as one row you can open.
 *
 * The terminal draws this above the prompt because it reads `task.md` off
 * disk; the panel is a browser page and cannot, so the server pushes it at
 * turn boundaries. Kept to a single row collapsed, because the value is
 * "3 of 5, and which one is next" at a glance — the full list is a click away
 * and should not push the conversation off the screen to show you a plan you
 * have already read.
 *
 * **In the turn, not pinned above the input.** Pinning it was the first
 * version and it was wrong in the way that matters: a finished list stayed
 * under the prompt box while you typed the next, unrelated request, so the
 * most prominent thing on screen was a plan that no longer applied. A list
 * belongs to the turn that produced it, the same as the review block — then an
 * old one scrolls away with the conversation it came from instead of
 * impersonating the current one.
 */
/**
 * The item as a person should read it.
 *
 * The model writes its own bookkeeping into the line — `<!-- id: 10 -->` is
 * the common one — which is for it and not for the reader. Escaped, those
 * showed up verbatim in the panel and made a three-item plan look like markup.
 */
function cleanTaskText(text) {
  return String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
}

function renderTaskList(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) return;

  const done = Number(payload.done ?? items.filter((i) => i.done).length);
  const total = Number(payload.total ?? items.length);
  const next = items.find((i) => !i.done);

  const div = document.createElement('div');
  div.className = 'task-list';
  div.innerHTML = `
    <button class="task-summary" type="button">
      <span class="task-caret">▸</span>
      <span class="task-count">${done}/${total}</span>
      <span class="task-next">${escapeHtml(done === total ? 'all done' : (next?.text ?? ''))}</span>
    </button>
    <div class="task-items">
      ${items.map((i) => `
        <div class="task-item${i.done ? ' done' : ''}">
          <span class="task-box">${i.done ? '[x]' : '[ ]'}</span>
          <span class="task-text">${escapeHtml(cleanTaskText(i.text))}</span>
        </div>`).join('')}
    </div>`;

  div.querySelector('.task-summary').addEventListener('click', () => {
    div.classList.toggle('open');
    div.querySelector('.task-caret').textContent = div.classList.contains('open') ? '▾' : '▸';
  });

  messageStream.appendChild(div);
  scrollToBottom();
}

/**
 * The handover review, folded.
 *
 * Every pro-tier reply now ends with a fixed `## Review` block — checklist,
 * what ran, callers checked, what is not done. It is the most important four
 * lines of the turn and also the least interesting to re-read, so it is
 * collapsed to its first fact with the rest a click away.
 *
 * Matched on the shape the prompt asks for rather than on wording, so
 * rephrasing the prompt does not silently stop this working.
 */
function splitReview(content) {
  const text = String(content ?? '');
  const at = text.search(/(^|\n)#{1,3}\s*Review\s*(\n|$)/i);
  if (at === -1) return { body: text, review: '' };
  return { body: text.slice(0, at).trimEnd(), review: text.slice(at).trim() };
}

function appendReview(review) {
  const div = document.createElement('div');
  div.className = 'review-block';
  const lines = review.split('\n').filter((l) => /^\s*[-*]\s/.test(l));
  const first = lines[0]?.replace(/^\s*[-*]\s*/, '') ?? 'Review';

  div.innerHTML = `
    <button class="review-summary" type="button">
      <span class="review-caret">▸</span>
      <span class="review-label">Review</span>
      <span class="review-first">${escapeHtml(first)}</span>
    </button>
    <div class="review-body">${renderMarkdownish(review)}</div>`;

  div.querySelector('.review-summary').addEventListener('click', () => {
    div.classList.toggle('open');
    div.querySelector('.review-caret').textContent = div.classList.contains('open') ? '▾' : '▸';
  });

  messageStream.appendChild(div);
  scrollToBottom();
}

// ── Blocking prompts ────────────────────────────────────────────────
//
// `ask_question` and a risky `run_command` park the turn on an unresolved
// promise server-side and send the prompt here. Until these existed the panel
// ignored both types, so the turn hung forever and the send button never came
// back — the panel looked like it had stopped sending prompts, which is how
// this was reported. Answering is therefore not a nicety: it is the only way
// the turn ever ends.

/**
 * Render a question the turn is parked on.
 *
 * The payload is **normalised by the server** (`core/question.js`), so a
 * question is always `{header, question, options: [{label, description}]}` and
 * `payload.questions` is always a non-empty array. That is deliberate: these
 * args are parsed out of model prose and nothing in them is guaranteed, and
 * the panel cannot import the server's rules, so the alternative was a second
 * copy of them here that would drift from the terminal's.
 *
 * The fallbacks below are for an *older server* talking to a newer panel, not
 * for a malformed model — one surface upgrading before the other is the
 * ordinary case when the extension is reloaded and the agent is not.
 */
function appendQuestion(payload) {
  removeThinking();
  const set = Array.isArray(payload?.questions) && payload.questions.length
    ? payload.questions
    : [payload || {}];

  const div = document.createElement('div');
  div.className = 'message message-question';
  div.id = 'question-prompt';

  div.innerHTML = set.map((q, i) => {
    const text = (typeof q === 'string' ? q : q?.question)
      || 'The agent asked a question, but sent no text.';
    const opts = (Array.isArray(q?.options) ? q.options : [])
      .map((o) => (typeof o === 'string' ? o : o?.label ?? o?.value ?? ''))
      .filter(Boolean);
    const header = typeof q === 'object' ? (q?.header || '') : '';
    return `
      <div class="question-block" data-q="${i}" data-question="${escapeHtml(text)}">
        ${header ? `<div class="question-header">${escapeHtml(header)}</div>` : ''}
        <div class="question-text">${escapeHtml(text)}</div>
        <div class="question-options">
          ${opts.map((o) => `<button class="question-option" data-value="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}
        </div>
        <input class="question-freeform" type="text" placeholder="or type your own answer…" />
      </div>`;
  }).join('');

  div.innerHTML += `
    <div class="question-actions">
      <button class="question-submit">Send answer</button>
      <button class="question-dismiss">Dismiss</button>
    </div>`;

  // Picking an option fills the free-text box, so there is exactly one place
  // the answer is read from and no way to submit two conflicting ones.
  div.querySelectorAll('.question-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const block = btn.closest('.question-block');
      block.querySelectorAll('.question-option').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      block.querySelector('.question-freeform').value = btn.dataset.value;
    });
  });

  // One answer per question, enforced here rather than by the disabled
  // attribute the close sets. A real browser will not fire click on a disabled
  // button, but that is the DOM enforcing a *protocol* invariant, and the cost
  // of being wrong is a second `question_response` for a promise that is
  // already resolved. A flag is one line and does not depend on the rendering.
  let answered = false;

  div.querySelector('.question-submit').addEventListener('click', () => {
    if (answered) return;
    const answers = [...div.querySelectorAll('.question-block')].map((block) => ({
      question: block.dataset.question,
      answer: block.querySelector('.question-freeform').value.trim(),
    }));
    if (answers.some((a) => !a.answer)) return;   // nothing to send yet
    answered = true;
    chrome.runtime.sendMessage({
      type: 'question_response',
      // One question answers as a bare string; several answer as the paired
      // array `answerQuestion` echoes back, because the model asked them
      // several tool results ago and pairing them itself is what it gets wrong.
      payload: { answer: answers.length === 1 ? answers[0].answer : answers },
    });
    closeQuestion(div, 'answered');
  });

  div.querySelector('.question-dismiss').addEventListener('click', () => {
    if (answered) return;
    answered = true;
    chrome.runtime.sendMessage({ type: 'question_response', payload: { cancelled: true } });
    closeQuestion(div, 'dismissed');
  });

  messageStream.appendChild(div);
  scrollToBottom();
}

/** Leave the question on screen as a record, but stop it being answerable twice. */
function closeQuestion(div, how) {
  div.removeAttribute('id');
  div.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
  const note = document.createElement('div');
  note.className = 'question-closed';
  note.textContent = how === 'dismissed' ? 'dismissed' : 'answered';
  div.appendChild(note);
  showThinking();
}

function appendCommandApproval(payload) {
  removeThinking();
  const { command = '', cwd = '', riskLevel = '', riskReason = '' } = payload || {};

  const div = document.createElement('div');
  div.className = 'message message-approval';
  // A write to Jira (v8.1): Send or Don't send, never "always" — the owner
  // asked for every one to be asked about. The server would treat "always" as
  // once anyway; the panel just does not offer it.
  const external = payload?.kind === 'external';
  div.innerHTML = external ? `
    <div class="approval-head">${escapeHtml(payload.title || 'Send this?')}</div>
    <pre class="approval-command">${escapeHtml(command)}</pre>
    ${cwd ? `<div class="approval-cwd">${escapeHtml(cwd)}</div>` : ''}
    ${riskReason ? `<div class="approval-reason">${escapeHtml(riskReason)}</div>` : ''}
    <div class="approval-actions">
      <button data-action="send">Send</button>
      <button data-action="reject_once">Don't send</button>
    </div>` : `
    <div class="approval-head">Run this command? <span class="approval-risk risk-${escapeHtml(riskLevel)}">${escapeHtml(riskLevel)}</span></div>
    <pre class="approval-command">${escapeHtml(command)}</pre>
    ${cwd ? `<div class="approval-cwd">in ${escapeHtml(cwd)}</div>` : ''}
    ${riskReason ? `<div class="approval-reason">${escapeHtml(riskReason)}</div>` : ''}
    <div class="approval-actions">
      <button data-action="allow_once">Allow once</button>
      <button data-action="allow_always">Always allow</button>
      <button data-action="reject_once">Reject</button>
      <button data-action="reject_always">Never allow</button>
    </div>`;

  div.querySelectorAll('.approval-actions button').forEach((btn) => {
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'command_approval_response',
        // The command rides along: `allow_always` / `reject_always` write it
        // into the persistent rules, and the server does not keep a copy.
        payload: { action: btn.dataset.action, command },
      });
      div.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      btn.classList.add('selected');
      showThinking();
    });
  });

  messageStream.appendChild(div);
  scrollToBottom();
}

/**
 * Streamed reply text, replacing the thinking dots as soon as there is any.
 *
 * Without this the panel showed "Thinking..." for the whole turn and then the
 * finished answer in one jump — every chunk crossed the socket to be dropped.
 */
function appendStreamChunk(payload) {
  const text = payload?.content ?? payload?.chunk ?? payload?.text ?? '';
  if (!text) return;
  removeThinking();
  let el = document.getElementById('stream-partial');
  if (!el) {
    el = document.createElement('div');
    el.className = 'message message-agent streaming';
    el.id = 'stream-partial';
    el.innerHTML = '<div class="message-content"></div>';
    messageStream.appendChild(el);
  }
  // The server sends the reply so far, not a delta.
  el.querySelector('.message-content').textContent = text;
  scrollToBottom();
}

function clearStreamPartial() {
  const el = document.getElementById('stream-partial');
  if (el) el.remove();
}

// ── Diff Actions ────────────────────────────────────────────────────
// Global so the diff buttons' listeners and the editor shim can reach it.
window.respondToDiff = function(diffId, action) {
  chrome.runtime.sendMessage({
    type: 'diff_response',
    payload: { diffId, action },
  });

  // Update UI immediately
  const container = document.getElementById(`diff-${diffId}`);
  if (container) {
    const status = container.querySelector('.diff-status');
    const actions = container.querySelector('.diff-actions');

    if (action === 'accept') {
      status.className = 'diff-status accepted';
      status.textContent = 'ACCEPTED';
    } else {
      status.className = 'diff-status rejected';
      status.textContent = 'REJECTED';
    }

    if (actions) actions.remove();
  }
};

// ── Incoming Message Handler ────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    // The dot in the status bar *is* the connection indicator. Writing a line
    // into the transcript as well meant the retry ladder — which fires
    // repeatedly by design while the agent is not running — filled the panel
    // with identical red rows and pushed the conversation off the top. A
    // status nobody asked for, repeated, is not information.
    case 'connection_status':
      updateConnectionUI(payload.connected);
      break;

    case 'status':
      if (payload.status === 'connected') {
        updateConnectionUI(true);
        if (payload.workspace) {
          currentWorkspace = payload.workspace;
          appendStatus(`Workspace: ${payload.workspace}`);
        }
        if (payload.mode) {
          currentMode = payload.mode;
          updateModeUI();
        }
      } else if (payload.status === 'waiting_for_gemini') {
        // Already showing thinking indicator
      } else if (payload.message) {
        appendStatus(payload.message);
      }
      break;

    case 'agent_response': {
      removeThinking();
      clearStreamPartial();
      const { body, review } = splitReview(payload.content);
      if (body) appendMessage('agent', body);
      if (review) appendReview(review);
      // Prose that came with tool calls: the turn goes on, so stay busy and
      // keep the indicator below what was just drawn.
      if (payload.continuing) {
        showThinking();
        break;
      }
      isWaitingForResponse = false;
      sendBtn.disabled = false;
      reflectSendState();
      break;
    }

    /**
     * The conversation so far, for a panel that has just opened.
     *
     * The transcript was never lost — the agent writes every turn to disk
     * twice — but a browser page cannot read it, so reopening the panel looked
     * like it had been cleared. Rendered once, on connect; anything already on
     * screen wins, because a reconnect mid-session must not duplicate what the
     * reader is looking at.
     */
    // A prompt typed somewhere else — the terminal, or the other panel.
    case 'user_turn': {
      const content = String(payload?.content ?? '');
      // Compared folded: the loop echoes an image prompt with its headers,
      // and the panel recorded what it drew — the text with the tags.
      if (!content || takeOwnEcho(foldImageHeader(content))) break;
      if (welcomeMessage) welcomeMessage.remove();
      removeThinking();
      appendMessage('user', foldImageHeader(content));
      showThinking();
      break;
    }

    // The loop went idle: the turn ended, was stopped, or failed. The only
    // end a stopped turn has — it sends no `agent_response`.
    case 'turn_idle':
      removeThinking();
      isWaitingForResponse = false;
      sendBtn.disabled = false;
      reflectSendState();
      break;

    case 'history': {
      if (historyRestored || messageStream.querySelector('.message-user')) break;
      historyRestored = true;
      if (welcomeMessage) welcomeMessage.remove();
      const turns = Array.isArray(payload?.turns) ? payload.turns : [];
      if (turns.length === 0) break;
      if (payload.total > turns.length) {
        appendStatus(`Showing the last ${turns.length} of ${payload.total} turns.`);
      }
      for (const turn of turns) {
        const { body, review } = splitReview(turn.content);
        if (turn.role === 'user') appendMessage('user', foldImageHeader(turn.content));
        else if (body) appendMessage('agent', body);
        if (turn.role !== 'user' && review) appendReview(review);
      }
      break;
    }

    /**
     * The conversation was replaced, not added to.
     *
     * `/new` and `/clear` leave the old transcript on screen otherwise, which
     * reads as though nothing happened — and the panel would then restore that
     * dead conversation the next time it opened.
     */
    case 'session_reset':
      messageStream.innerHTML = '';
      // A resume sends fresh history straight after, so the door stays open.
      historyRestored = false;
      historyRequested = true;
      lastStatusText = '';
      removeThinking();
      isWaitingForResponse = false;
      sendBtn.disabled = false;
      reflectSendState();
      if (payload?.message) appendStatus(payload.message);
      break;

    case 'sessions':
      renderSessions(payload);
      break;

    // State, not an event — see renderTaskList.
    case 'task_list':
      renderTaskList(payload);
      break;

    // Streaming text. Every chunk used to cross the socket and land in the
    // `default:` branch below, which drops it — so the panel sat on "Thinking…"
    // for the whole turn and then jumped to the finished answer.
    case 'response_stream':
      appendStreamChunk(payload);
      break;

    // The two that park the turn. Neither was handled, and neither can time
    // out, so the first one to arrive ended the panel's usefulness for the
    // rest of the session.
    case 'ask_question':
      appendQuestion(payload);
      break;

    case 'request_command_approval':
      appendCommandApproval(payload);
      break;

    // Sent when the CLI answers an approval, so both surfaces agree.
    case 'command_approval':
      removeThinking();
      break;

    // The one GitHub message that actually reaches here. `processing_started`,
    // `processing_finished` and `notification` are pushed to a CLI-only buffer
    // and never broadcast, so there is nothing for the panel to handle.
    case 'github_plan_generated': {
      const who = payload?.comment?.author ? `@${payload.comment.author} commented` : 'plan written';
      appendStatus(`PR #${payload?.prNumber ?? '?'} · ${who}`);
      break;
    }

    case 'tool_call':
      appendToolCall(payload.name, payload.args, payload.verb);
      break;

    case 'tool_result':
      appendToolResult(payload.name, payload.success, payload.result, payload.error);
      break;

    case 'diff_request':
      removeThinking();
      appendDiff(payload);
      break;

    case 'diff_result':
      if (payload.message) appendStatus(payload.message);
      break;

    case 'diff_auto_applied':
      appendStatus(`✅ Auto-applied: ${payload.filePath}`);
      break;

    case 'command_result':
      removeThinking();
      isWaitingForResponse = false;
      sendBtn.disabled = false;
      reflectSendState();
      if (payload.message) {
        appendStatus(payload.message);
      }
      break;

    // No native chooser on that machine, so fall back to typing the path.
    case 'error':
      if (payload?.op === 'pick_workspace' && payload?.unavailable) {
        appendStatus(payload.message);
        promptForWorkspace();
        break;
      }
      removeThinking();
      isWaitingForResponse = false;
      sendBtn.disabled = false;
      reflectSendState();
      appendError(payload.message);
      break;
  }

  sendResponse({ received: true });
  return false;
});

// ── Helpers ──────────────────────────────────────────────────────────
function scrollToBottom() {
  requestAnimationFrame(() => {
    messageStream.scrollTop = messageStream.scrollHeight;
  });
}

/**
 * Escape for HTML, **including attribute context**.
 *
 * This used to be `div.textContent = str; return div.innerHTML`, which is the
 * idiom everyone reaches for and which does not escape quotes — that round trip
 * only has to survive re-parsing as *text*. Every template here interpolates
 * into attributes as well (`data-value="…"`, `class="risk-…"`), and a quote
 * there closes the attribute and everything after it is parsed as markup:
 *
 *     options: ['" onmouseover="…']   ->   <button data-value="" onmouseover="…">
 *
 * Verified, not theorised — jsdom parsed exactly that into a real event
 * handler on the button. It matters here more than on an ordinary page: this
 * text is *scraped off gemini.google.com*, so it is third-party input, and the
 * side panel is an extension page with `chrome.*` in scope.
 *
 * Explicit replacement rather than the DOM round trip, so the rule is visible
 * and the function does not need a document.
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
