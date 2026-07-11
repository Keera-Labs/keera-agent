# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Install dependencies:**
```bash
uv sync          # Python deps
npm install      # JS deps
```

**Run migrations:**
```bash
uv run python artisan db:migrate                 # dev database
uv run python artisan db:migrate --env=testing   # test database (run before pytest)
```

**Start dev server (runs FastAPI + Vite concurrently):**
```bash
npm run dev
```

**Run all tests:**
```bash
uv run pytest
```

**Run a single test file:**
```bash
uv run pytest tests/test_projects.py
```

**Run a single test by name:**
```bash
uv run pytest tests/test_projects.py::TestProjects::test_create_project
```

**Type-check frontend:**
```bash
npm run types:check
```

**Build and deploy to dist/ (patches env, runs migrations, starts server on :4545):**
```bash
bash bin/build.sh          # full build
bash bin/build.sh --no-build  # skip Vite, just sync files
```

## Architecture

### Stack
- **Backend:** Python 3.13+, FastAPI via `fastapi-startkit` framework, Masonite ORM (async), SQLite
- **Frontend:** React 19 + TypeScript, Inertia.js (server-driven SPA), Vite, Tailwind CSS v4
- **Terminal:** xterm.js on the frontend, PTY via Python's `pty` module on the backend over WebSocket

### Request flow
1. FastAPI routes are defined in `routes/web.py` and loaded via `providers/app_provider.py` at boot
2. Page routes render Inertia responses (`Inertia.render("ComponentName", props)`) — the frontend receives props directly without a separate API call
3. API routes return `JSONResponse` directly from controllers
4. The frontend uses `@inertiajs/react` router (`router.visit(url)`) for navigation; the layout never unmounts (persistent)

### Key architectural decisions

**Persistent layout pattern:** `AppLayout.tsx` is the single persistent component — it never unmounts across navigations. Terminal sessions and WebSocket connections live in `useRef` maps keyed by project ID so they survive page transitions. New pages are loaded by Inertia and rendered inside the layout as `children`, but the main UI lives in `AppLayout` itself. `pages/Home.tsx` is only an entry point that sets the layout via `Home.layout`.

**Terminal sessions:** Each project gets one PTY process on the backend spawned via WebSocket connection at `/{project}/ws?path=...`. On connect, the backend auto-runs `claude --continue`; if the output contains "No conversation found to continue" it falls back to `claude`. Terminal output is stripped of ANSI codes and persisted to `terminal_outputs`. The in-process `connections` dict in `terminal_controller.py` maps `project_path → WebSocket` and is used by `claude_hook_controller.py` to push `claude_stopped` events to the frontend.

**Claude Stop hook:** On app startup (`AppProvider.boot`), `app/utils/hook_setup.py` registers an HTTP hook in `~/.claude/settings.json` pointing to `/api/claude-stopped`. The URL is read from `APP_URL` in the environment (so it adjusts automatically between dev :8000 and dist :4545). `bin/build.sh` also patches the URL in `dist/.claude/settings.json` after copying files.

**Route ordering:** In `routes/web.py`, API routes must be registered before the `/{project}` wildcard page route. PATCH and DELETE routes use `router.router.add_api_route` directly — the `Router` wrapper only exposes GET and POST helpers.

**Data model relationships:**
- `Workspace` has many `Projects` (via `workspace_id` FK, nullable — projects can be unassigned)
- `Project` has many `Tasks` (via `project_id` FK)
- `Project` has many `TerminalSession` records; tracks `last_session_id` and `claude_status` (`running`/`idle`)
- `TerminalSession` has many `TerminalOutput` records

### Directory layout
- `app/controllers/` — one file per resource, plain async functions (no class-based views)
- `app/models/` — minimal Masonite ORM models (just `__table__` declaration; schema is in migrations)
- `databases/migrations/` — timestamped migration files; filename prefix determines run order
- `routes/web.py` — all routes in one file
- `resources/js/layouts/AppLayout.tsx` — the entire UI lives here
- `config/` — dataclass-based config objects passed to providers at boot; reads env via `env()` from `fastapi_startkit.environment`
- `bootstrap/application.py` — provider registration order matters (Database before FastAPI, Vite before Inertia)
- `storage/keera.db` — SQLite database file (gitignored)
- `dist/` — output of `bin/build.sh`; self-contained deployable with patched `.env` and built assets

### Frontend structure
- `resources/js/components/` holds **only** reusable, cross-page components (used by two or more pages).
- Page-specific components live co-located with their page under `resources/js/pages/<page>/`, not in `components/`.
- Canonical example: the Dashboard's sub-components (`StatCard`, `ProjectCard`, `DashboardBody`, etc.) live in `resources/js/pages/dashboard/` alongside the `pages/Dashboard.tsx` entry (see PR #204).
- Case-sensitivity note: a page entry (`pages/Dashboard.tsx`) and its folder (`pages/dashboard/`) differ only in case, so import the folder's barrel via an explicit `@/pages/dashboard/index` path — a bare `@/pages/dashboard` resolves to the entry file on case-insensitive filesystems.

### Adding a new resource
1. Create `databases/migrations/YYYY_MM_DD_HHMMSS_create_<table>.py` with `up`/`down` async methods
2. Create `app/models/<Model>.py` with `__table__`
3. Create `app/controllers/<resource>_controller.py` with async handler functions
4. Wire routes in `routes/web.py` (API routes before the `/{project}` wildcard)
5. Run `uv run python artisan db:migrate`

### Testing
Tests are async unittest and hit a real DB (no mocks).

**Reference example:** `app/controllers/task_controller.py` + `tests/features/test_task_controller.py` are the canonical pattern to copy when adding a resource — Pydantic request models for validation (`app/requests/task_request.py`), JSON columns typed as `list` on the model so the ORM casts them, a `JsonResource` subclass for output (`app/resources/task_resource.py`), and factory-driven tests.

**Conventions:**
- Base class `tests/test_case.py::TestCase` (wraps `HttpTestCase`); feature/controller tests live in `tests/features/`.
- Mix in `fastapi_startkit.masoniteorm.testing.DatabaseTransaction` to wrap each test in a transaction that rolls back — no manual cleanup needed for direct model writes. Note: writes made through the HTTP app commit on a separate connection and are **not** rolled back, so assert on the entities a test created (by title/id) rather than on global row counts.
- Seed data with factories in `databases/factories/` (e.g. `ProjectFactory`, `TaskFactory`): `await TaskFactory.new().create(project_id=...)` to persist, `(await TaskFactory.new().make()).serialize()` to build a request payload.

**Run the migrations on the test database before running tests the first time:**
```bash
uv run python artisan db:migrate --env=testing
```
