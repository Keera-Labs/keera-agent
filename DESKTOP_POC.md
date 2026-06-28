# Desktop shell — proof of concept

> ⚠️ POC only — **do not merge.** This wraps the existing web app in a native
> window via [pywebview](https://pywebview.flowrl.com/). The FastAPI/Inertia/Vite
> stack is untouched.

## What it does

`desktop.py` is the single entry point for the standalone app. It:

1. boots the framework — in a packaged bundle it runs the server **in-process**
   (uvicorn on a background thread); in dev it spawns `uv run python artisan serve`,
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

## Bundle as a macOS `.app` (PyInstaller)

When frozen, `desktop.py` boots the server **in-process** (it can't call
`uv`/`artisan` from inside a bundle) and `chdir`s to the bundle root so the
app's relative paths resolve — so the `.app` is self-launching.

```bash
bash bin/release.sh           # full build (frontend + migrate + package)
bash bin/release.sh --no-build  # skip the frontend build, reuse public/build
open "dist-app/Keera Agent.app"
```

`bin/release.sh` runs `npm run build`, migrates the SQLite DB, then packages a
`Keera Agent.app` via PyInstaller (`--windowed --onedir`). The server is loaded
through the factory string `bootstrap.application:app`, which PyInstaller's
static analysis can't see, so the script explicitly collects the local
packages (`bootstrap`, `config`, `routes`, `providers`, `databases`, `app`) and
`fastapi_startkit`, plus the runtime data (`templates`, `public`, `databases`,
`storage`, `app/prompts`).

> py2app was tried first but its standalone build is broken on Python 3.13
> (`module 'zlib' has no attribute '__file__'` — zlib is a builtin in 3.13).
> PyInstaller does not have that problem.

## Notes / follow-ups

- The bundled SQLite DB lives **inside** the `.app` (writes land there). A real
  release should relocate storage/the DB to a writable per-user location
  (e.g. `~/Library/Application Support/Keera Agent`).
- The bundle embeds the **prebuilt** frontend, so `npm run build` must run before
  packaging (`bin/release.sh` does this unless `--no-build`).
- pywebview lives in the **dev** dependency group (`[dependency-groups].dev`).
- Native window only — no installer, app menu, icon, code-signing/notarization,
  or single-instance guard yet.
- "Already listening" is a TCP connect to the port; it does not verify the
  listener is *this* app.
