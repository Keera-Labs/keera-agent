# Desktop shell — proof of concept

> ⚠️ POC only — **do not merge.** This wraps the existing web app in a native
> window via [pywebview](https://pywebview.flowrl.com/). The FastAPI/Inertia/Vite
> stack is untouched.

## What it does

`desktop.py` boots the same app `artisan serve` runs (uvicorn, factory
`bootstrap.application:app`) on a background thread, waits for the port to accept
connections, then opens it in a native pywebview window pointing at
`http://127.0.0.1:4545`. Closing the window shuts the server down.

## Run it

The app must be served with frontend assets available — either a production
build or the Vite dev server. Simplest path is to build first:

```bash
uv sync --extra desktop      # installs pywebview (optional dependency)
npm run build                # produces public/build/manifest.json
uv run python artisan db:migrate
uv run python desktop.py
```

Port/host follow the existing `APP_PORT` / `APP_HOST` env (defaults: `4545` /
`127.0.0.1`), matching `bin/build.sh`.

## Notes / follow-ups

- pywebview is an **optional** dependency (`[project.optional-dependencies].desktop`)
  so the default install is unaffected.
- Native window only — no packaging/installer, menu, or single-instance guard yet.
- Reuses the running server's port; a real build would likely pick a free port
  and/or detect an already-running instance.
