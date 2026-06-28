#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$PROJECT_ROOT/dist-app"
APP_NAME="Keera Agent"
TARGET_ARCH="arm64"

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

echo "==> Cleaning previous build..."
rm -rf "$PROJECT_ROOT/build" "$DIST" "$PROJECT_ROOT/$APP_NAME.spec"

EXTRA_DATA=()
[ -f ".env" ] && EXTRA_DATA+=(--add-data ".env:.")
[ -f "storage/default_permissions.json" ] && EXTRA_DATA+=(--add-data "storage/default_permissions.json:storage")

echo "==> Packaging $APP_NAME.app (PyInstaller, $TARGET_ARCH)..."
uv run pyinstaller --windowed --onedir --name "$APP_NAME" \
    --target-arch "$TARGET_ARCH" \
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
    --add-data "app/prompts:app/prompts" \
    ${EXTRA_DATA[@]+"${EXTRA_DATA[@]}"} \
    --noconfirm --distpath "$DIST" --workpath "$PROJECT_ROOT/build" \
    desktop.py

echo "==> Code-signing (ad-hoc)..."
codesign --force --deep --sign - "$DIST/$APP_NAME.app"
codesign --verify --deep --strict "$DIST/$APP_NAME.app" && echo "    signature OK"

echo ""
echo "==> Done. Built: $DIST/$APP_NAME.app"
echo ""
echo "    The app stores its data in: ~/Library/Application Support/$APP_NAME"
echo "    It is ad-hoc signed (no Apple Developer ID). To run on another Mac,"
echo "    the user opens it once via right-click > Open, or:"
echo "        xattr -dr com.apple.quarantine \"$APP_NAME.app\""
