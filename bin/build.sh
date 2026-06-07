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

# Update/add port, reload, and APP_URL settings
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

patch_env "APP_URL"           "http://127.0.0.1:4545" "$DIST/.env"
patch_env "KEERA_AGENT_URL"  "http://127.0.0.1:4545" "$DIST/.env"
patch_env "APP_PORT"         "4545"                   "$DIST/.env"
patch_env "APP_RELOAD"       "false"                  "$DIST/.env"

# Patch (or create) .claude/settings.json in dist to point hooks + MCP at KEERA_AGENT_URL
DIST_APP_URL=$(grep '^KEERA_AGENT_URL=' "$DIST/.env" | head -1 | cut -d= -f2)
DIST_SETTINGS="$DIST/.claude/settings.json"
mkdir -p "$DIST/.claude"
python3 - "$DIST_SETTINGS" "$DIST_APP_URL" <<'PYEOF'
import json, sys, os, shutil

STOP_PATH  = "/api/claude-stopped"
START_PATH = "/api/claude-started"

def upsert_hook(hook_list, path_fragment, new_url):
    for grp in hook_list:
        for h in grp.get("hooks", []):
            if h.get("type") == "http" and path_fragment in h.get("url", ""):
                h["url"] = new_url
                return
    hook_list.append({"hooks": [{"type": "http", "url": new_url}]})

path, app_url = sys.argv[1], sys.argv[2]
s = {}
if os.path.exists(path):
    shutil.copy2(path, path + ".bak")
    try:
        with open(path) as f:
            s = json.load(f)
    except (json.JSONDecodeError, OSError):
        s = {}

hooks = s.setdefault("hooks", {})
upsert_hook(hooks.setdefault("Stop", []),             STOP_PATH,  f"{app_url}/api/claude-stopped")
upsert_hook(hooks.setdefault("UserPromptSubmit", []), START_PATH, f"{app_url}/api/claude-started")
s.setdefault("mcpServers", {})["keera-agent"] = {"type": "http", "url": f"{app_url}/mcp"}

with open(path, "w") as f:
    json.dump(s, f, indent=2)
    f.write("\n")
PYEOF
echo "    patched .claude/settings.json hooks + MCP server → ${DIST_APP_URL}"

# Remove the vite hot file so built assets are used instead of the dev server
rm -f "$DIST/public/hot"

echo "==> Installing Python dependencies..."
cd "$DIST"
uv sync --frozen

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
