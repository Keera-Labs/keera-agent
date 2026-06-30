# keera-agent

A local-first AI agent manager built with FastAPI (Python) and React (TypeScript).

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
