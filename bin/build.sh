#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$PROJECT_ROOT/dist"

SKIP_BUILD=false
for arg in "$@"; do
    case "$arg" in
        --no-build) SKIP_BUILD=true ;;
    esac
done

if [ "$SKIP_BUILD" = false ]; then
    echo "==> Building frontend..."
    cd "$PROJECT_ROOT"
    npm run build
fi

echo "==> Preparing dist/..."
mkdir -p "$DIST"

echo "==> Copying project files..."
rsync -a \
    --exclude='.venv' \
    --exclude='node_modules' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='*.pyo' \
    --exclude='.git' \
    --exclude='.idea' \
    --exclude='dist' \
    --exclude='storage' \
    "$PROJECT_ROOT/" "$DIST/"

# Ensure storage directory exists (but never overwrite existing data)
mkdir -p "$DIST/storage/logs"

echo "==> Copying and patching .env..."
cp "$PROJECT_ROOT/.env" "$DIST/.env"

# Update/add app URL, port, and reload settings
patch_env() {
    local key="$1"
    local value="$2"
    local file="$3"
    if grep -q "^${key}=" "$file"; then
        sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
    else
        echo "${key}=${value}" >> "$file"
    fi
    rm -f "${file}.bak"
}

patch_env "KEERA_APP_URL"  "http://127.0.0.1:4545" "$DIST/.env"
patch_env "KEERA_APP_RELOAD" "false"               "$DIST/.env"

# Remove the vite hot file so built assets are used instead of the dev server
rm -f "$DIST/public/hot"

echo "==> Installing Python dependencies..."
cd "$DIST"
uv sync --frozen

echo "==> Writing Claude hooks into dist/.claude/settings.json..."
uv run python artisan claude:hook

echo "==> Running migrations..."
uv run python artisan db:migrate

echo "==> Updating built-in agent templates..."
uv run python artisan templates:update

echo "==> Committing build..."
git -C "$DIST" init -q
git -C "$DIST" add -A
if ! git -C "$DIST" diff --cached --quiet; then
    BUILD_TIME="$(date '+%Y-%m-%d %H:%M:%S')"
    SOURCE_SHA="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
    git -C "$DIST" commit -q -m "build: $BUILD_TIME (src $SOURCE_SHA)"
    echo "    committed $(git -C "$DIST" rev-parse --short HEAD)"
else
    echo "    nothing changed"
fi

echo ""
echo "==> Starting server on http://127.0.0.1:4545 (reload disabled)..."
exec uv run python artisan serve
