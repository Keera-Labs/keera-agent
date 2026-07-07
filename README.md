# keera-agent

A local-first AI agent manager built with FastAPI (Python) and React (TypeScript).

![keera-agent dashboard — the persistent AppLayout showing the workspace/projects sidebar, the agents panel, and a live agent terminal](docs/images/screenshot.png)

*The main dashboard: workspaces and projects on the left, the agents panel in the middle, and a live agent terminal on the right.*

## Stack

- **Backend:** Python 3.13+, FastAPI via `fastapi-startkit`, Masonite ORM (async), SQLite
- **Frontend:** React 19 + TypeScript, Inertia.js, Vite, Tailwind CSS v4
- **Terminal:** xterm.js (frontend) + Python `pty` module over WebSocket

## Quick Start

The fastest way to set up a dev environment is the install script:

```bash
./bin/install.sh
npm run dev
```

`bin/install.sh` is a one-command, idempotent dev onboarding script. It:

- Checks that `uv`, `node`, and `npm` are installed (with install hints if any are missing)
- Installs dependencies with `uv sync` and `npm install`
- Creates `.env` from `.env.example` if it doesn't exist (never overwrites an existing `.env`)
- Runs the dev database migrations (`uv run python artisan db:migrate`)

When it finishes, start the dev server (FastAPI + Vite) with `npm run dev`.

### Manual setup

```bash
# Install dependencies
uv sync
npm install

# Run migrations
uv run python artisan db:migrate

# Start dev server (FastAPI + Vite)
npm run dev
```

## Testing

```bash
uv run pytest
```

## Building for Deployment

```bash
bash bin/build.sh
```

The build outputs a self-contained deployable to `dist/` and starts the server on port `:4545`.

### Production build

For an unattended production build, run it under `caffeinate` so macOS never sleeps mid-build (the build compiles Vite assets, syncs dependencies, and then keeps a long-running server alive):

```bash
caffeinate -i ./bin/build.sh
```

`caffeinate -i` prevents the system from idle-sleeping while the command runs. `./bin/build.sh` performs the full production build:

- Builds the frontend (`npm run build`) and copies the project into `dist/`
- Patches `dist/.env` (`KEERA_APP_URL=http://127.0.0.1:4545`, `KEERA_APP_RELOAD=false`) and points the `.claude/settings.json` hooks + MCP server at that URL
- Installs Python dependencies (`uv sync --frozen`), runs database migrations, and updates the built-in agent templates
- Commits the build inside `dist/`, then starts the server on `http://127.0.0.1:4545` (reload disabled)

Because the server keeps running in the foreground, `caffeinate -i` holds the machine awake for as long as the server is up. Pass `--no-build` to skip the Vite build and only re-sync files:

```bash
caffeinate -i ./bin/build.sh --no-build
```
