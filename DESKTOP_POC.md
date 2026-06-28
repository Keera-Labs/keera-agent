# Desktop shell — proof of concept

> ⚠️ POC only — **do not merge.** This wraps the existing web app in a native
> window via [pywebview](https://pywebview.flowrl.com/). The FastAPI/Inertia/Vite
> stack is untouched.

## What it does

`desktop.py` is the single entry point for the standalone app. It:

1. boots the framework by spawning the project's own serve command
   (`uv run python artisan serve`),
2. waits for it to listen on `APP_HOST:APP_PORT`,
3. opens a native pywebview window pointing at `http://127.0.0.1:4545`,
4. stops the server when the window closes.

If a server is already listening (e.g. `npm run dev`), it is reused instead of
spawning a second one.

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

## Bundle as a macOS `.app` (py2app)

When frozen, `desktop.py` boots the server **in-process** (it can't call
`uv`/`artisan` from inside a bundle), then opens the window — so the `.app` is
self-launching.

```bash
uv sync
npm run build                                   # assets must be built first
uv run python setup.py py2app -A --dist-dir dist-app
open "dist-app/Keera Agent.app"
```

The **alias** build (`-A`) produces a working `Keera Agent.app` that runs the
full app + window on this machine (it references the source tree, so it is not
distributable to another machine).

**Standalone (distributable) build is not working yet.** `uv run python
setup.py py2app` (without `-A`) currently fails with
`module 'zlib' has no attribute '__file__'` — a known incompatibility between
py2app 0.28.10 and Python 3.13 (zlib is a built-in module in 3.13). Unblocking
the distributable build (toolchain pin/patch, data-file collection, and a
writable storage/db path outside the read-only bundle) is left to the prod
packaging script.

## Notes / follow-ups

- The boot command is a single constant (`SERVER_CMD`) in `desktop.py`. For a
  **true standalone bundle** (shipped to a machine without `uv`/`artisan`), the
  prod packaging script swaps it for the packaged server — the rest of the
  window/lifecycle code is unchanged.
- pywebview lives in the **dev** dependency group (`[dependency-groups].dev`).
- Native window only — no installer, app menu, icon, or single-instance guard yet.
- "Already listening" is a TCP connect to the port; it does not verify the
  listener is *this* app.
