#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$PROJECT_ROOT/dist-app"
APP_NAME="Keera Agent"
TARGET_ARCH="arm64"

usage() {
    cat >&2 <<USAGE
Usage: bin/release.sh [major|minor|patch] [--dry-run] [--no-build]

  major|minor|patch  bump the app version in pyproject.toml, uv.lock, package.json
                     and package-lock.json before building (omit to build the current version)
  --dry-run          print the version change and exit without writing or building
  --no-build         reuse the existing public/build instead of running npm ci + vite build

Builds dist-app/$APP_NAME.app locally. Never commits, tags, pushes or publishes.
USAGE
}

BUMP=""
DRY_RUN=false
SKIP_BUILD=false
for arg in "$@"; do
    case "$arg" in
        major|minor|patch)
            if [ -n "$BUMP" ]; then
                echo "ERROR: only one of major|minor|patch may be given." >&2
                usage
                exit 2
            fi
            BUMP="$arg"
            ;;
        --dry-run) DRY_RUN=true ;;
        --no-build) SKIP_BUILD=true ;;
        -h|--help) usage; exit 0 ;;
        *)
            echo "ERROR: unknown argument '$arg'." >&2
            usage
            exit 2
            ;;
    esac
done

cd "$PROJECT_ROOT"

version() {
    uv run --quiet python bin/bump_version.py "$@"
}

if [ "$DRY_RUN" = true ]; then
    if [ -n "$BUMP" ]; then
        version "$BUMP" --dry-run
    else
        echo "Would build version $(version current) unchanged."
    fi
    exit 0
fi

if [ -n "$BUMP" ]; then
    echo "==> Bumping version ($BUMP)..."
    version "$BUMP"
fi
VERSION="$(version current)"

echo "==> Installing dependencies..."
uv sync

if [ "$SKIP_BUILD" = false ]; then
    echo "==> Building frontend..."
    # npm ci, not install: node_modules must match package-lock.json exactly, or a
    # stale checkout silently builds with outdated packages (e.g. an old vite).
    npm ci --no-audit --no-fund
    npm run build
fi

if [ ! -f "public/build/manifest.json" ]; then
    echo "ERROR: public/build/manifest.json missing — run a frontend build first (omit --no-build)." >&2
    exit 1
fi

echo "==> Cleaning previous build..."
rm -rf "$PROJECT_ROOT/build" "$DIST" "$PROJECT_ROOT/$APP_NAME.spec"

if [ ! -f ".env.desktop" ]; then
    echo "ERROR: .env.desktop missing — the packaged app reads its env from this file." >&2
    exit 1
fi

# Bundle .env.desktop (APP_ENV=desktop, per-user URL/port) rather than the dev .env.
# The framework loads it via the APP_ENV=desktop overlay; omitting the base .env keeps
# the per-user storage/DB paths that desktop.py sets at runtime from being clobbered.
EXTRA_DATA=(--add-data ".env.desktop:.")
[ -f "storage/default_permissions.json" ] && EXTRA_DATA+=(--add-data "storage/default_permissions.json:storage")

echo "==> Packaging $APP_NAME.app $VERSION (PyInstaller, $TARGET_ARCH)..."
uv run pyinstaller --windowed --onedir --name "$APP_NAME" \
    --target-arch "$TARGET_ARCH" \
    --collect-submodules fastapi_startkit \
    --collect-data fastapi_startkit \
    --collect-submodules app \
    --collect-submodules bootstrap \
    --collect-submodules config \
    --collect-submodules routes \
    --collect-submodules databases \
    --collect-submodules plugins \
    --hidden-import bootstrap.application \
    --hidden-import aiosqlite \
    --add-data "resources/templates:resources/templates" \
    --add-data "public:public" \
    --add-data "databases:databases" \
    --add-data "app/prompts:app/prompts" \
    --add-data "plugins:plugins" \
    ${EXTRA_DATA[@]+"${EXTRA_DATA[@]}"} \
    --noconfirm --distpath "$DIST" --workpath "$PROJECT_ROOT/build" \
    desktop.py

# Must happen before signing: editing Info.plist afterwards invalidates the signature.
PLIST="$DIST/$APP_NAME.app/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -replace CFBundleVersion -string "$VERSION" "$PLIST"

echo "==> Code-signing (ad-hoc)..."
codesign --force --deep --sign - "$DIST/$APP_NAME.app"
codesign --verify --deep --strict "$DIST/$APP_NAME.app" && echo "    signature OK"

echo ""
echo "==> Done. Built: $DIST/$APP_NAME.app ($VERSION)"
echo ""
echo "    The app stores its data in: ~/Library/Application Support/$APP_NAME"
echo "    It is ad-hoc signed (no Apple Developer ID). To run on another Mac,"
echo "    the user opens it once via right-click > Open, or:"
echo "        xattr -dr com.apple.quarantine \"$APP_NAME.app\""

if [ -n "$BUMP" ]; then
    echo ""
    echo "==> Version bumped to $VERSION (files edited only; nothing committed, tagged or pushed). Next:"
    echo "    1. Commit the bump on a branch and open a PR into dev:"
    echo "         pyproject.toml uv.lock package.json package-lock.json"
    echo "    2. After it reaches main, tag the release: git tag v$VERSION && git push origin v$VERSION"
fi
