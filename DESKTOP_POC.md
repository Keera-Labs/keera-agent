# Desktop shell — proof of concept

> ⚠️ POC only — **do not merge.** This wraps the existing web app in a native
> window via [pywebview](https://pywebview.flowrl.com/). The FastAPI/Inertia/Vite
> stack is untouched.

## What it does

`desktop.py` opens the app in a native pywebview window pointing at
`http://127.0.0.1:4545`.

- If a server is **already listening** on that host/port (e.g. `npm run dev` or
  a built dist), it is **reused** — no second server is started, avoiding the
  dev double-boot / port clash.
- If nothing is listening, it boots its own uvicorn instance (same app
  `artisan serve` runs: factory `bootstrap.application:app`) on a background
  thread, waits for the port, then opens the window. Closing the window stops
  the server it started; a reused, externally-managed server is left running.

## Run it

The app must be served with frontend assets available — either a production
build or the Vite dev server. Simplest path is to build first:

```bash
uv sync                      # pywebview is in the dev dependency group
npm run build                # produces public/build/manifest.json
uv run python artisan db:migrate
uv run python desktop.py
```

If `npm run dev` is already running, just `uv run python desktop.py` — it
reuses that server.

Port/host follow the existing `APP_PORT` / `APP_HOST` env (defaults: `4545` /
`127.0.0.1`), matching `bin/build.sh`.

## Notes / follow-ups

- pywebview lives in the **dev** dependency group (`[dependency-groups].dev`) so
  it never ships in the runtime dependency set.
- Native window only — no packaging/installer, menu, or single-instance guard yet.
- "Already listening" is detected by a TCP connect to the port; it does not
  verify the listener is *this* app.
