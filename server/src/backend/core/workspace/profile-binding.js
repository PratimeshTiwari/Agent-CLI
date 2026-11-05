/**
 * Which Chrome profile the agent types into (v9.3).
 *
 * Every connected extension used to get every prompt, so with the extension in
 * two profiles a prompt went to both accounts. A profile cannot be recognised
 * from outside: an extension cannot read its profile's name, and a third of the
 * owner's profiles have no email. So it is proved. The agent opens the chosen
 * profile on a link holding a one-use token, and the extension that sees that
 * link answers with its install id. A fragment is never sent to Google.
 *
 * Once bound, nothing else is admitted, an unknown or older build included. If
 * the chosen profile is closed, prompts wait for it: they must never fall back
 * to the account this exists to keep out.
 */
import { randomBytes } from 'node:crypto';
import { loadUserSettings, saveUserSettings } from './user-settings.js';

export const PAIR_TTL_MS = 2 * 60_000;
export const GEMINI_URL = 'https://gemini.google.com/app';
export const pairUrl = (token) => `${GEMINI_URL}#agent-pair=${token}`;

export class ProfileBinding {
  constructor({ load = loadUserSettings, save = saveUserSettings, now = Date.now } = {}) {
    this.save = save;
    this.now = now;
    const saved = load().chromeProfile;
    this.current = saved?.install && saved?.dir ? saved : null;
    this.pending = null;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _changed() {
    for (const fn of this.listeners) {
      try { fn(this.current); } catch { /* a screen must not stop the bridge */ }
    }
  }

  admits(installId) {
    return !this.current || this.current.install === installId;
  }

  startPairing(profile) {
    const token = randomBytes(16).toString('hex');
    this.pending = { token, profile, at: this.now() };
    return token;
  }

  cancelPairing() {
    this.pending = null;
  }

  /** One use, and only for the last one asked for. */
  takePairing(token) {
    const pending = this.pending;
    if (!pending || pending.token !== token) return null;
    this.pending = null;
    return this.now() - pending.at > PAIR_TTL_MS ? null : pending.profile;
  }

  bind(profile, installId) {
    const { dir, name, email = '' } = profile;
    this.current = { dir, name, email, install: installId };
    this.save({ chromeProfile: this.current });
    this._changed();
  }

  clear() {
    this.current = null;
    this.pending = null;
    this.save({ chromeProfile: null });
    this._changed();
  }
}
