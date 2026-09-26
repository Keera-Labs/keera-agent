"""Read or bump the app's semver across every file that declares it.

Usage:
    bump_version.py current
    bump_version.py major|minor|patch [--dry-run]

pyproject.toml is the source of truth; uv.lock, package.json and the
package-lock.json root package are kept in sync with it. Edits files only —
never commits, tags or pushes.
"""

import re
import sys
from pathlib import Path

PARTS = ("major", "minor", "patch")

# Each pattern is anchored so only the app's own version matches, never a dependency's.
VERSION_PATTERNS = {
    "pyproject.toml": re.compile(r'(\[project\]\nname = "keera-agent"\nversion = ")([^"]+)(")'),
    "uv.lock": re.compile(r'(\[\[package\]\]\nname = "keera-agent"\nversion = ")([^"]+)(")'),
    "package.json": re.compile(r'(\A\{\n\s+"version": ")([^"]+)(")'),
    "package-lock.json": re.compile(r'("packages": \{\n\s+"": \{\n\s+"version": ")([^"]+)(")'),
}


def current_version(root: Path) -> str:
    match = VERSION_PATTERNS["pyproject.toml"].search((root / "pyproject.toml").read_text())
    if not match:
        raise SystemExit("ERROR: no [project] version found in pyproject.toml")
    return match.group(2)


def next_version(version: str, part: str) -> str:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"ERROR: '{version}' is not a plain MAJOR.MINOR.PATCH version")
    major, minor, patch = (int(n) for n in version.split("."))
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def bump(root: Path, part: str, dry_run: bool = False) -> tuple[str, str]:
    old = current_version(root)
    new = next_version(old, part)

    # Compute every edit before writing any, so one bad file leaves all of them untouched.
    pending = {}
    for name, pattern in VERSION_PATTERNS.items():
        text = (root / name).read_text()
        match = pattern.search(text)
        if not match:
            raise SystemExit(f"ERROR: could not find the app version in {name}")
        if match.group(2) != old:
            raise SystemExit(f"ERROR: {name} has version {match.group(2)}, expected {old} (files out of sync)")
        pending[name] = text[: match.start(2)] + new + text[match.end(2):]

    if not dry_run:
        for name, text in pending.items():
            (root / name).write_text(text)
    return old, new


def main(argv: list[str]) -> int:
    root = Path(__file__).resolve().parent.parent
    args = [a for a in argv if a != "--dry-run"]
    dry_run = len(args) != len(argv)

    if args == ["current"]:
        print(current_version(root))
        return 0
    if len(args) != 1 or args[0] not in PARTS:
        print("Usage: bump_version.py current | major|minor|patch [--dry-run]", file=sys.stderr)
        return 2

    old, new = bump(root, args[0], dry_run)
    verb = "Would bump" if dry_run else "Bumped"
    print(f"{verb} version {old} -> {new} in: {', '.join(VERSION_PATTERNS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
