#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$PROJECT_ROOT/dist-app"
APP_NAME="Keera Agent"

SKIP_BUILD=false
for arg in "$@"; do
    case "$arg" in
        --no-build) SKIP_BUILD=true ;;
    esac
done

cd "$PROJECT_ROOT"

echo "==> Installing dependencies..."
uv sync

if [ "$SKIP_BUILD" = false ]; then
    echo "==> Building frontend..."
    npm run build
fi

if [ ! -f "public/build/manifest.json" ]; then
    echo "ERROR: public/build/manifest.json missing — run a frontend build first (omit --no-build)." >&2
    exit 1
fi

echo "==> Preparing database..."
uv run python artisan db:migrate

echo "==> Cleaning previous build..."
rm -rf "$PROJECT_ROOT/build" "$DIST" "$PROJECT_ROOT/$APP_NAME.spec"

ENV_DATA=()
if [ -f ".env" ]; then
    ENV_DATA=(--add-data ".env:.")
fi

echo "==> Packaging $APP_NAME.app with PyInstaller..."
uv run pyinstaller --windowed --onedir --name "$APP_NAME" \
    --collect-submodules fastapi_startkit \
    --collect-data fastapi_startkit \
    --collect-submodules app \
    --collect-submodules bootstrap \
    --collect-submodules config \
    --collect-submodules routes \
    --collect-submodules providers \
    --collect-submodules databases \
    --hidden-import bootstrap.application \
    --hidden-import aiosqlite \
    --add-data "templates:templates" \
    --add-data "public:public" \
    --add-data "databases:databases" \
    --add-data "storage:storage" \
    --add-data "app/prompts:app/prompts" \
    ${ENV_DATA[@]+"${ENV_DATA[@]}"} \
    --noconfirm --distpath "$DIST" --workpath "$PROJECT_ROOT/build" \
    desktop.py

echo ""
echo "==> Done. Built: $DIST/$APP_NAME.app"
echo "    open \"$DIST/$APP_NAME.app\""
