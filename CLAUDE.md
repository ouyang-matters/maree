# CLAUDE.md — Marée

Guidance for working on this repository (humans and AI assistants alike).

## What this is

Marée is a local-first Windows desktop app for collecting, organising and solving
mathematical exercises. Tauri 2 (Rust) shell + React 19/TypeScript UI + SQLite. Everything
runs offline; there is no server.

## Commands

```bash
npm install
npm run dev            # Vite on :1420 — the UI runs in a normal browser with an in-browser SQLite (sql.js)
npm run tauri:dev      # the real desktop app (Rust + WebView2), hot-reloading the UI
npm test               # Vitest: repository, migrations, search, import, export, math rendering
npm run test:rust      # cargo tests for the SQL bridge, file store and backups
npm run typecheck      # tsc --noEmit
npm run tauri:build    # release exe + NSIS and MSI installers in src-tauri/target/release/bundle
npm run e2e            # acceptance test against the built exe (see scripts/e2e-acceptance.mjs)
npm run e2e:phone      # phone link → photo inbox → crop → Copy for ChatGPT (overwrites the clipboard)
node scripts/ui-shots.mjs <outDir> tour|acceptance [theme]   # headless Edge screenshots of the dev server
```

Run `npm test`, `npm run typecheck` and (for Rust changes) `npm run test:rust` before committing.

## Architecture

```
src-tauri/src/
  lib.rs        window setup, data directory (MAREE_DATA_DIR / portable / %APPDATA%), commands
  db.rs         thin SQL bridge: db_select / db_execute / db_batch (one transaction) / snapshots
  files.rs      content-addressed file store (files/sources, files/attachments) and zip backups
  phone.rs      phone link: tiny_http server on the LAN, pairing key, serves phone/index.html
  inbox.rs      photo inbox (files/inbox: image + JSON sidecar), archive, watched-folder collection
  clip.rs       clipboard with several images (CF_HDROP + PNG + bitmap) for "Copy for ChatGPT"
src-tauri/phone/index.html   the phone page (plain HTML/JS, no build step, upload queue in IndexedDB)
src/
  data/         driver.ts (SqlDriver), schema.ts (migrations), repo.ts (ALL SQL), types.ts, sample.ts
  domain/       pure logic: filters & sorting, statuses, review queue, progress, photos (crop regions, BMP)
  image/        photo.ts: canvas decode / rotate / crop / stack
  math/         segments.ts (math-aware splitting), render.ts (markdown-it + KaTeX), unicode.ts
  import/       extract-{pdf,docx,latex,text,json}.ts → segment.ts → classify.ts / duplicates.ts → pipeline.ts
  export/       library-json.ts (lossless JSON + import), documents.ts (Markdown / LaTeX),
                chatgpt.ts (problem + answer as images; typed text typeset via html-to-image)
  platform/     Platform interface; tauri.ts (Rust commands) and web.ts (sql.js + IndexedDB fallback)
  state/        store.ts (zustand), actions.ts (every user operation), autosave.ts,
                inbox.ts (phone link, photo inbox, crop → problems/answers, Copy for ChatGPT)
  commands/     commands.tsx (single registry for menus, palette, shortcuts), menus.ts
  components/   React views; ui/ holds primitives (Menu, Dialog, Popover, TagPicker, icons)
  styles/       tokens.css (themes), app.css (shell), views.css, prose.css (typeset maths + print)
tests/          Vitest suites; helpers/node-driver.ts runs the same repository on node:sqlite
```

Key decisions:

* **All domain logic is TypeScript; Rust is a thin bridge.** The repository issues SQL
  through `SqlDriver`, so the exact same code runs in the app (rusqlite), the browser
  preview (sql.js) and tests (node:sqlite). Keep SQL portable SQLite (FTS4, not FTS5:
  sql.js lacks FTS5).
* **Writes are atomic.** Compose statements and pass them to `repo.run`/`tx` — never issue
  dependent writes as separate calls. `WriteQueue` serialises writes.
* **Migrations are append-only** (`src/data/schema.ts`). Never edit a shipped migration;
  add a new version. Existing databases are snapshotted before migrating; newer schemas are
  refused.
* **Never alter mathematics.** Statements are stored verbatim. Import keeps
  `sourceExcerpt` (raw extracted text) untouched; the PDF "assisted LaTeX" conversion is
  opt-in and always flagged (`importFlags`) until the user marks it checked.
* **No destructive defaults.** Deleting problems moves them to the Trash; deleting a
  course asks whether to keep its problems; library import uses UPSERTs and never deletes.
* **Phone link stays on the local network.** The server only answers API calls carrying the
  pairing key from the QR code; with `MAREE_E2E=1` it binds 127.0.0.1. Photos land in
  `files/inbox`; cropping creates problems whose statement is `![Problem](attachment:…)`,
  and answer crops are appended to My Solution as `![My answer](attachment:…)`.
  Processed photos move to `files/inbox/archive` (pruned after 30 days). A watched folder
  (e.g. Google Drive) is read-only: collected photos are remembered by hash.
* **Copy for ChatGPT** places separate image files on the clipboard (CF_HDROP). Chromium
  pastes a file list as separate attachments and ignores text alongside it, so typed text is
  rendered to an image rather than sent as text.
* **Commands are defined once** in `commands/commands.tsx`; the menu bar, palette and
  keyboard handler all read from it. Add new user actions there.
* **zustand selectors must return stable values.** Never return a freshly filtered array
  from `useStore(...)`; select the raw data and derive with `useMemo`, or use `useShallow`.

## Conventions

* TypeScript strict; no `any` in new code. Components are function components.
* UI strings go through `t()` (gettext style: the English text is the key). Dates go through
  `fmtDate` / `fmtDateTime` so they follow the app language.
* Colours only via CSS variables from `styles/tokens.css` (four themes must keep working).
* Icons: `lucide-react`; status glyphs: `ui/icons.tsx`.
* No raw HTML in rendered Markdown (`html: false`); links open externally.
* Keep the interface calm: no gamification, streaks or celebratory animation.

## Testing the desktop app

`scripts/e2e-acceptance.mjs` starts `maree.exe` with `MAREE_DATA_DIR` (isolated library),
`MAREE_E2E=1` (exposes `window.__maree` hooks for file import/export without native
dialogs) and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, then
drives the UI with playwright-core over CDP, closes the window, relaunches and checks
persistence and exports. Screenshots land in `e2e-data/run-*/screenshots`.

## Data locations

* Library: `%APPDATA%\com.maree.library\` (`maree.db`, `files\`, `backups\`)
* Portable mode: create an empty file named `portable` next to `maree.exe` → `MareeData\`
* Override (tests): `MAREE_DATA_DIR`
