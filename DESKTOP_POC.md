# Desktop shell — proof of concept

> ⚠️ POC only — **do not merge.** This wraps the existing web app in a native
> window via [pywebview](https://pywebview.flowrl.com/). The FastAPI/Inertia/Vite
> stack is untouched.

## What it does

`desktop.py` is the single entry point for the standalone app. It:

1. boots the framework by running the project's own `serve` command in-process
   (on a background thread) — no duplicated server config in desktop.py,
2. waits for it to listen on `APP_HOST:APP_PORT`,
3. opens a native pywebview window pointing at `http://127.0.0.1:4545`,
4. stops the server when the window closes.

If a server is already listening (e.g. `npm run dev`), it is reused instead of
starting a second one.

## Run

The app needs frontend assets — build once first:

```bash
uv sync                          # pywebview is in the dev dependency group
npm run build                    # produces public/build/manifest.json
uv run python artisan db:migrate

uv run python desktop.py         # boots the server + opens the window
```

Host/port follow the existing `APP_PORT` / `APP_HOST` env (defaults: `4545` /
`127.0.0.1`), matching `bin/build.sh`.

## Build a macOS `.app` (PyInstaller)

```bash
bash bin/release.sh             # full build (frontend + package + sign)
bash bin/release.sh --no-build  # reuse existing public/build
open "dist-app/Keera Agent.app"
```

`bin/release.sh` builds the frontend, then packages an Apple-Silicon
(`--target-arch arm64`) `Keera Agent.app` via PyInstaller (`--windowed
--onedir`) and ad-hoc code-signs it. The server is loaded through the factory
string `bootstrap.application:app`, which PyInstaller's static analysis can't
see, so the script explicitly collects the local packages (`bootstrap`,
`config`, `routes`, `providers`, `databases`, `app`) and `fastapi_startkit`,
plus the read-only runtime data (`templates`, `public`, `databases`,
`app/prompts`).

> py2app was tried first but its standalone build is broken on Python 3.13
> (`module 'zlib' has no attribute '__file__'` — zlib is a builtin in 3.13).
> PyInstaller does not have that problem.

## Per-user data (read-only bundle)

An installed `.app` is read-only, so the app must not write inside the bundle.
When frozen, `desktop.py` points all writable paths at
`~/Library/Application Support/Keera Agent/` (override with `KEERA_DATA_DIR`) via
env before the server boots:

| Data | Env var | Location |
| --- | --- | --- |
| SQLite database | `DB_URL` / `DB_DATABASE` | `…/keera.db` |
| Uploads (local disk) | `FILESYSTEM_DISK_ROOT` | `…/storage` |
| Public uploads | `FILESYSTEM_PUBLIC_DISK_ROOT` | `…/storage/app/public` |
| Daily logs | `LOG_DAILY_PATH` | `…/storage/logs` |
| Default permissions | `KEERA_DEFAULT_PERMS_PATH` | `…/storage/default_permissions.json` |

On launch it creates the directory, **runs `db:migrate`** (so a fresh install
gets the schema and a new release applies new migrations — verified idempotent),
and seeds `default_permissions.json` from the bundle on first run.

Two project configs honor an env override so this works without forking the
framework: `config/storage.py` reads `FILESYSTEM_DISK_ROOT`, and
`permission_controller.py` reads `KEERA_DEFAULT_PERMS_PATH` (both default to the
previous relative paths, so dev/server behavior is unchanged).

## Distribution (no Apple Developer account)

The `.app` is **ad-hoc signed**, not notarized. It runs locally as-is; on
another Mac the first launch is gated by Gatekeeper. The user opens it once via
**right-click → Open**, or removes the download quarantine:

```bash
xattr -dr com.apple.quarantine "Keera Agent.app"
```

A frictionless double-click would require a paid Apple Developer ID +
notarization.

## Notes / follow-ups

- Apple Silicon only (`arm64`); no Intel/universal build.
- The bundle embeds the **prebuilt** frontend, so `npm run build` must run before
  packaging (`bin/release.sh` does this unless `--no-build`).
- pywebview lives in the **dev** dependency group (`[dependency-groups].dev`).
- No installer/`.dmg`, app menu, app icon, Developer-ID signing/notarization, or
  single-instance guard yet.
- "Already listening" is a TCP connect to the port; it does not verify the
  listener is *this* app.
