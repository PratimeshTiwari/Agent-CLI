# Agent CLI Bridge — the Chrome extension

The half of the project that makes it work without an API key. The server sends a prompt over a
local WebSocket; a content script **types it into a Gemini tab** you are signed into, scrapes the
streamed reply out of the page, and sends the text back.

```
CLI  ──ws://127.0.0.1:7777──▶  service worker  ──▶  content script  ──▶  gemini.google.com
                      ◀──────  (reply text)   ◀──  (scraped DOM)   ◀──
```

- Current version: **1.58.0**. The CLI checks it: the extension reports the version Chrome actually
  loaded (`getManifest()`), and a stale build gets one row at connect time and a line in
  `/settings → Status → Extension build`. From 1.58.0 on, an extension older than the checkout
  reloads itself between turns. An extension older than 1.26.0 reports nothing, and the
  CLI says that too.
- **A side panel and a floating window** (`⌘⇧1`, bound once at `chrome://extensions/shortcuts`)
  run the same chat as the terminal.
- **Each request gets its own tab lane**: the main chat on `main:<model>`, a subagent in a tab of
  its own, kept for its session and closed when it ends.
- Version history: [`CHANGELOG.md`](CHANGELOG.md).

## Installing and updating

```
chrome://extensions  →  Developer mode  →  Load unpacked  →  select this folder
```

A `git pull` updates nothing in the browser. This is the most common reason the agent goes quiet.

| what | how it loads | after a pull |
| --- | --- | --- |
| `service-worker.js` | a **committed esbuild bundle** of `src/background/` | `npm run build --workspace=extension`, then Reload |
| `content-scripts/*.js` | loaded directly, never bundled | Reload **and hard-refresh the Gemini tab** |
| `side-panel/*` | loaded directly | Reload |

Editing `src/background/` without rebuilding ships stale code: Chrome runs the bundle, not the
sources.

## Layout

```
manifest.json              MV3, side panel, one content script
service-worker.js          committed build artifact; do not edit by hand
src/background/            the sources it is built from
  main.js                  message router: panel ⇄ worker ⇄ server
  socket.js                the WebSocket, reconnect, server-message dispatch
  messaging.js             sendToServer / broadcastToSidePanel
  content.js               tab lanes, batch sessions, focus restoring
  chat-url.js              a chat's /app/<id> URL, keeping a /u/<n> account
  floating.js              the floating chat window
  state.js  policy.js
content-scripts/
  gemini-bridge.js         type into Gemini, scrape the reply
side-panel/                panel.html / panel.js / panel.css
test/                      jsdom tests, run by `npm test` from the repo root
```

- **One content script, one bridge.** The GitHub and ChatGPT bridges were removed on 2026-09-19.
  Delete a manifest entry rather than emptying its `matches`: an empty one makes Chrome refuse the
  whole extension (`test/manifest.test.js`).
- **The bridge is an IIFE, and that is load-bearing.** A second injection into the same page would
  otherwise throw on a top-level `const` before running anything. A new copy calls
  `window.__agentBridgeStop` first, so the orphan it replaces stops its observers and timers.
- How the bridge stays alive and finds the reply: [`CLAUDE.md`](../CLAUDE.md), "Bridge liveness and
  the reply path".
