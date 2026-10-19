/**
 * Copy the Chrome side panel into the companion, for the editor chat panel.
 *
 * Run by `vscode:prepublish`, so `vsce package` cannot produce a .vsix with a
 * stale or missing panel. Copied rather than referenced because a .vsix
 * carries only its own folder. Fails loudly: a companion built without these
 * files has a chat view that can only say it is broken.
 */
const fs = require('fs');
const path = require('path');

const FROM = path.join(__dirname, '..', '..', 'extension', 'side-panel');
const TO = path.join(__dirname, '..', 'media', 'panel');
const FILES = ['panel.html', 'panel.js', 'panel.css'];

fs.mkdirSync(TO, { recursive: true });
for (const name of FILES) {
    const src = path.join(FROM, name);
    if (!fs.existsSync(src)) {
        console.error(`sync-panel: ${src} is missing — is this the Agent-CLI checkout?`);
        process.exit(1);
    }
    fs.copyFileSync(src, path.join(TO, name));
}
console.log(`sync-panel: ${FILES.join(', ')} → media/panel/`);
