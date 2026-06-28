# Desktop shell — proof of concept

> ⚠️ POC only — **do not merge.** This wraps the existing web app in a native
> window via [pywebview](https://pywebview.flowrl.com/). The FastAPI/Inertia/Vite
> stack is untouched.

## What it does

`desktop.py` opens a native window pointing at `http://127.0.0.1:4545`. It does
**not** manage a server — the app is expected to already be serving on
`APP_HOST:APP_PORT` (started separately, or bundled alongside the window). This
keeps the wrapper a thin native shell, with the server owned by whoever launched
it (the single source of truth).

To tolerate a server that is still coming up — e.g. started concurrently by a
bundle — the window waits up to `READY_TIMEOUT` for the port to accept
connections, then exits with a clear message if nothing is there. It never
starts a server itself.

## Run it

The app must be served with frontend assets available — either a production
build or the Vite dev server.

```bash
uv sync                          # pywebview is in the dev dependency group
npm run build                    # produces public/build/manifest.json
uv run python artisan db:migrate

uv run python artisan serve      # (or `npm run dev`) — start the app
uv run python desktop.py         # in another terminal: open the native window
```

Host/port follow the existing `APP_PORT` / `APP_HOST` env (defaults: `4545` /
`127.0.0.1`), matching `bin/build.sh`.

## Notes / follow-ups

- pywebview lives in the **dev** dependency group (`[dependency-groups].dev`) so
  it never ships in the runtime dependency set.
- The window does not boot or own the server — a future bundle is expected to
  start the server (e.g. the packaged `artisan serve`) and the window alongside it.
- Native window only — no packaging/installer, menu, or single-instance guard yet.
- Readiness is a TCP connect to the port; it does not verify the listener is
  *this* app.
