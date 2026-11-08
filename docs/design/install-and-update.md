# /doctor and /update

> Moved word for word from `CLAUDE.md` on 2026-11-09, when that file was cut to the rules.
> [`CLAUDE.md`](../../CLAUDE.md) says what must hold; this file keeps how each part came to be
> and what was measured. "This file" in the text below means the old `CLAUDE.md`, kept whole
> as [`old-claude.md`](../old-claude.md). Version tags say when a paragraph was written.

## Tools

**`/doctor` and `agent doctor` say what is installed (v5.29, `core/install/doctor.js`).** Asked for for the
work laptop, where an install can miss a package without anything crashing. `dep-recovery.js`
handles the loud case (a startup import is missing: install once, restart); this is the quiet
ones — an **optional** package (`unpdf`, imported only when a PDF is read), a wrong version, a
missing tool (`git`, `rg`, `textutil`). Every package has a tier (`required` / `optional` /
`build` / `test` / `dev` / `unused`) and a **why** in `PACKAGES`; `/doctor <package>` prints it with
what breaks and the files that import it. `doctor.test.js` holds the prose to the code: every
declared package has an entry, `required` is a static import, `optional` only a lazy one, and
`doctor.js` imports **only built-ins** — the bin runs `agent doctor` before looking for `tsx`, and a
missing `tsx` prints the offline report. Latest versions come from `npm outdated`, which uses the
user's npm config (a company registry, proxy and auth); a refusal is reported with npm's reason,
never as "up to date" — empty output with an error parsed as `{}` did exactly that at first. A
missing required/optional package shows one startup row (`✗ unpdf not installed · /doctor fix …`),
and the slash palette now gives way to notice rows: it always offered six, which overflowed 13
rows by one with that row up (2 `ESC[2J`). 0 extra clears at 10, 13, 24 rows. It found
`ink-spinner`, declared and imported by nothing — listed as `unused`, and removed in v5.31.

**`/doctor` is a menu since v5.30 (`frontend/menus/doctor-view.js`, the `doctor` type in `Menus.jsx`).** Tabs
All · Required · Optional · Other · Tools (tab or ←/→). Enter opens a package: why, versions,
importers, then actions: install what `package.json` wants, update to latest, choose a version (`npm
view … versions`), **remove** for the `unused` tier. A missing tool gets its installer (`brew` on
macOS, `winget` on Windows; Linux only names `sudo apt …`). A failed install says one line, and
**Show the error** opens the installer's output. Esc goes back one view; only the list closes. It
opens on disk state with no network, and `npm outdated` fills in behind it. A version install keeps
the range's style (`installArgs`: `^`, `~`, exact). `/doctor report` prints the old table. **A change
that breaks the next start is undone** (`core/install/doctor-guard.js`): manifests and lockfile are copied to
`~/.agent/doctor-change.json` first; a start up 8 s confirms; a non-zero exit before that makes
`index.js` restore, `npm install` and start again, once. The record holds the changing session's pid,
because that session crashing proves nothing about the change. **Driven end to end in v7.7**, in a
scratch clone under the pty: `/doctor ink` → ink 6.8.0 (no `usePaste`) → `/restart` crashed, the bin
put the files back, `npm install` ran, and the next start said `↶ ink 7.1.1 → 6.8.0 broke the start`,
with the clone's tree clean and no record left. The run's one fault was order: npm's output came
before the line saying why it was running, so that line is now printed first.

**Update all (v9.5, `updatesAvailable`, `updatePackages`).** A `/doctor` row, then a choice: inside
their ranges, or all to latest, which names what leaves its range. One `npm install` per workspace
and save style, so a pin stays a pin; what landed is read from disk, not from npm's exit. Run with
real npm in a **full copy** (`run-deps.sh`; a symlinked `node_modules` is written through): all 11
moved and `ink` 8 started; `marked-terminal` 8 is in since v9.9.6 (Node 22.12+), bold its own. The
guard undoes a crash, nothing else. Below 12 rows a subtitle is shed, so a job takes the title row.

**`/update` is a menu (v9.5, `components/UpdateMenu.jsx`, `core/install/editors.js`).** Update, Editor
companion, Dismiss. `/update done` is gone: Chrome's extension reloads itself (since 1.58.0), so only
the companion is ever waited on. Editors are multi-select, read back after install, and Other shows
the command. **Anything that can reach a real app needs an allow-list:** one harness run really
installed into an editor found on PATH. `AGENT_EDITOR_APPS` fixes the search; `setup-home.js` sets it.
