# Godown Stock Register

A desktop app for a shuttering-store godown: track **items**, **categories**, and dated
**OUT / IN** movements. No money, no rates, no customers or suppliers — just what left
the godown, what came back, and when.

- **Local-first.** Everything lives in one SQLite file on the PC it's installed on, and
  the app works fully offline day to day — no login, no accounts, no server it depends on.
- **Online features are opt-in, not automatic.** Two things do use the internet, both
  only when you ask: an on-launch check for app updates (one click to install), and an
  optional push/pull of backups to a Google Drive account you connect yourself. Neither
  is required for the app to work.
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
live register with a chosen backup file (after confirming, since it can't be undone). If
Google Drive is connected, matching **Backup ☁ / Restore ☁** buttons appear alongside
them — see "Online features" below.

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
    gdrive.rs           Google Drive OAuth (loopback + PKCE) and backup/restore
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
practical, so CI does the actual build).

**To ship a new version, bump the version number and merge to `main` — that's it.**
Update the version in `package.json`, `src-tauri/Cargo.toml`, and
`src-tauri/tauri.conf.json` (they must all match), then merge. The
`build-windows.yml` workflow notices the bump, builds the signed installer, and
publishes it as a GitHub Release tagged `vX.Y.Z` with the `.msi`/`.exe` attached —
no manual tagging or clicking "Publish release" required. Merging to `main` without
a version bump is a no-op (the workflow sees the tag already exists and skips the
build).

You can also trigger a build without releasing: open the *Build Windows installer*
workflow in the **Actions** tab → *Run workflow*. This just builds and attaches the
installer to that run as a downloadable artifact, without creating a release.

Once built, download the installer, run it on the target Windows PC, and launch "Godown
Stock Register" from the Start menu — no other setup required.

You can also build it yourself on a Windows machine directly:

```sh
npm install
npm run build     # tauri build — installers land in src-tauri/target/release/bundle/
```

## Backing up your data

- **Backup to file** (sidebar) saves a complete, consistent snapshot of the register to
  any `.db` file you choose — copy it to a USB drive, a shared folder, cloud storage you
  sync separately, wherever you'd like a copy to live.
- **Restore from file** (sidebar) replaces everything currently in the register with a
  chosen backup file. You'll be asked to confirm first, since it can't be undone.
- **Backup ☁ / Restore ☁** (sidebar, once Google Drive is connected) do the same thing
  against a "Godown Stock Register Backups" folder in your own Google Drive, instead of
  a local file. Nothing is pushed automatically — only when you click the button.

## Online features

Two features talk to the internet, and both are entirely optional — the app works fully
offline without either of them configured.

### Auto-updates

On launch, the app checks this repo's latest GitHub Release for a newer version. If one
exists, a banner offers a one-click **Install & restart**. This needs the release
artifacts to be cryptographically signed, which requires two repository secrets
(**Settings → Secrets and variables → Actions → New repository secret** on GitHub):

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Generate a keypair with `npx tauri signer generate -w ~/.tauri/godown.key`; put the
private key file's contents and the password you chose into those two secrets, and put
the printed public key into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` (it's
already set for this repo's key — only regenerate it if you're forking this project).
**Keep the private key somewhere safe outside git** — if you lose it, you'll need to
generate a new one and everyone will need to reinstall instead of auto-updating.

### Google Drive backup

The **Connect Google Drive** button (sidebar) only appears once the app is built with
OAuth credentials for a Google Cloud project you control. To set one up:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/), create a project
   (or reuse one), and enable the **Google Drive API** under *APIs & Services → Library*.
2. Under *APIs & Services → OAuth consent screen*, configure it (External user type for
   a personal Gmail account is fine) and add your own Google account under **Test users**.
   Publishing status can stay "Testing" while you try it out, but refresh tokens expire
   after 7 days in that mode — switch to **"In production"** for everyday use (no
   verification review needed for this scope at this scale; you'll just see an
   "unverified app" warning during sign-in once, which is safe to click through since
   it's your own app).
3. Under *APIs & Services → Credentials*, create an **OAuth client ID** of type
   **Desktop app**. Copy the Client ID and Client Secret it gives you.
4. Add them as two more repository secrets: `GOOGLE_OAUTH_CLIENT_ID` and
   `GOOGLE_OAUTH_CLIENT_SECRET`. The next build will bake them in.

The app only ever requests the `drive.file` scope — it can only see and manage files it
created itself, never your whole Drive.

## License

Fonts bundled under `src/fonts/` (Instrument Sans, Work Sans, Noto Sans Devanagari) are
licensed under the SIL Open Font License 1.1 — see `src/fonts/LICENSE.txt`.
