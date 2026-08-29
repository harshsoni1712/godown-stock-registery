# Godown Stock Register

An offline desktop app for a shuttering-store godown: track **items**, **categories**,
and dated **OUT / IN** movements. No money, no rates, no customers or suppliers — just
what left the godown, what came back, and when.

- **Fully offline.** No internet, no login, no cloud, no accounts. Everything lives in
  one SQLite file on the PC it's installed on.
- **Back-dating is normal.** Every OUT/IN entry has a date, and you can pick any past
  date — record the day the material actually moved, not the day you typed it.
- **Built with [Tauri](https://tauri.app)** (Rust backend + a small vanilla HTML/CSS/JS
  frontend, no framework) and [rusqlite](https://github.com/rusqlite/rusqlite) with a
  bundled SQLite — there's nothing extra to install on the target PC.

The UI is a close match to the original design reference: dark sidebar with the
register's sections, a purple/lavender accent theme, warm orange for OUT and green for
IN, Hindi labels alongside the English ones, and the same stat-card / table / entry-form
layout throughout.

## Screens

- **Stock on hand** — every item's owned quantity, current in-store quantity, and how
  much is out, either as a table or grouped by category with progress bars.
- **Movements** — the full OUT/IN ledger, filterable by *today / this week / this month /
  one specific date / a custom range*, by movement type, and by item.
- **Item master** — add, edit, archive, and (when it has no history) delete items;
  manage categories and their colors.
- **Record out / Record in** — a quick single-item form for rapid entry, or a full-lot
  form for logging many items against one date at once.

Backup and restore live as small buttons at the bottom of the sidebar: **Backup** writes
a snapshot of the whole register to a `.db` file you choose; **Restore** replaces the
live register with a chosen backup file (after confirming, since it can't be undone).

## Project layout

```
src/                  Frontend (plain HTML/CSS/JS, no build step, no framework)
  index.html
  styles.css
  app.js
  fonts/              Self-hosted Instrument Sans / Work Sans / Noto Sans Devanagari
src-tauri/            Rust backend
  src/
    main.rs
    lib.rs             App setup, window, Tauri commands registration
    db.rs              SQLite connection + schema + seed data
    commands.rs         All Tauri commands (CRUD, movements, backup/restore)
    models.rs           Data structs shared with the frontend
  tauri.conf.json      Window, bundling, and installer configuration
.github/workflows/
  build-windows.yml    CI that builds the Windows installer
```

All data lives in a single SQLite file (`godown.db`) in the app's local data directory
(on Windows: `%APPDATA%\com.godown.stockregister\godown.db`). Journal mode is set to
`DELETE` on purpose so there's never a `-wal`/`-shm` sidecar file — Backup/Restore only
ever have to move that one file.

## Running it locally (development)

Requires [Node.js](https://nodejs.org) and the [Rust toolchain](https://rustup.rs), plus
the platform prerequisites from the [Tauri
docs](https://tauri.app/start/prerequisites/) (on Windows: the WebView2 runtime, which
ships with Windows 10/11, and the MSVC build tools).

```sh
npm install
npm run dev      # tauri dev — opens the app in a live-reloading window
```

## Building the Windows installer

The Windows `.msi` and `.exe` (NSIS) installers are built by GitHub Actions on a
`windows-latest` runner (cross-compiling a real Windows installer from another OS isn't
practical, so CI does the actual build). Two ways to trigger it, from the **Actions**
tab of this repository:

1. **Push a version tag** — this builds the installer *and* publishes it as a (draft)
   GitHub Release with the `.msi`/`.exe` attached:
   ```sh
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. **Run the workflow manually** — open the *Build Windows installer* workflow → *Run
   workflow*. This just builds and attaches the installer to that run as a downloadable
   artifact, without creating a release.

Once built, download the installer, run it on the target Windows PC, and launch "Godown
Stock Register" from the Start menu — no other setup required.

You can also build it yourself on a Windows machine directly:

```sh
npm install
npm run build     # tauri build — installers land in src-tauri/target/release/bundle/
```

## Backing up your data

Godown Stock Register never talks to the network, so backups are entirely manual and
entirely yours:

- **Backup** (sidebar) saves a complete, consistent snapshot of the register to any
  `.db` file you choose — copy it to a USB drive, a shared folder, cloud storage you
  sync separately, wherever you'd like a copy to live.
- **Restore** (sidebar) replaces everything currently in the register with a chosen
  backup file. You'll be asked to confirm first, since it can't be undone.

## License

Fonts bundled under `src/fonts/` (Instrument Sans, Work Sans, Noto Sans Devanagari) are
licensed under the SIL Open Font License 1.1 — see `src/fonts/LICENSE.txt`.
