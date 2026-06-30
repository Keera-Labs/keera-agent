#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# .env.example is committed; fall back to this template only if it is missing.
ENV_TEMPLATE='APP_ENV=local
KEERA_APP_URL=http://127.0.0.1:4545

DB_CONNECTION=sqlite
DB_DATABASE=storage/keera.db
DB_URL=sqlite+aiosqlite:///storage/keera.db

BROADCAST_DRIVER=reverb
REVERB_APP_ID=1
REVERB_APP_KEY=local
REVERB_APP_SECRET=secret
REVERB_SCHEME=http'

require_cmd() {
    local cmd="$1"
    local hint="$2"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: '$cmd' is not installed or not on PATH." >&2
        echo "       $hint" >&2
        return 1
    fi
}

echo "==> Checking prerequisites..."
missing=false
require_cmd uv   "Install it: https://docs.astral.sh/uv/getting-started/installation/" || missing=true
require_cmd node "Install Node.js (>=18): https://nodejs.org/ or via nvm/Homebrew." || missing=true
require_cmd npm  "npm ships with Node.js: https://nodejs.org/" || missing=true
if [ "$missing" = true ]; then
    echo "" >&2
    echo "Resolve the missing prerequisites above, then re-run: bash bin/install.sh" >&2
    exit 1
fi
echo "    uv, node, npm found"

echo "==> Installing Python dependencies (uv sync)..."
uv sync

echo "==> Installing JS dependencies (npm install)..."
npm install

echo "==> Setting up .env..."
if [ -f .env ]; then
    echo "    .env already exists — leaving it untouched"
elif [ -f .env.example ]; then
    cp .env.example .env
    echo "    created .env from .env.example"
else
    printf '%s\n' "$ENV_TEMPLATE" > .env
    echo "    created .env from built-in template (.env.example not found)"
fi

echo "==> Running migrations (dev database)..."
uv run python artisan db:migrate

echo "==> Running migrations (testing database)..."
uv run python artisan db:migrate --env=testing

echo ""
echo "==> Done. Dev environment is ready."
echo "    next: npm run dev"
