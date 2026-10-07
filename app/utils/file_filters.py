"""Hide entries from project file listings according to the editor's Files settings."""

import fnmatch
import os
import subprocess
from pathlib import Path

from app.requests.editor_settings_request import EditorSettingsRequest

GIT_TIMEOUT_SECONDS = 5


def _matches(pattern: str, entry: dict) -> bool:
    """gitignore-style glob: a trailing "/" matches only folders, and a pattern
    containing "/" is matched against the project-relative path instead of the name."""
    is_dir = entry["type"] == "dir"
    if pattern.endswith("/"):
        if not is_dir:
            return False
        pattern = pattern.rstrip("/")
    if "/" in pattern:
        return fnmatch.fnmatchcase(entry["path"], pattern.lstrip("/"))
    return fnmatch.fnmatchcase(entry["name"], pattern)


def git_ignored(directory: Path, entries: list[dict]) -> set[str]:
    """Names in `directory` that git ignores, found with one check-ignore call.

    git runs from the listed directory so a nested repo or worktree applies its
    own rules. Tracked files are never reported, even when a pattern matches them.
    """
    if not entries:
        return set()
    # A trailing slash lets directory-only patterns such as "build/" match.
    names = [os.fsencode(e["name"]) + (b"/" if e["type"] == "dir" else b"") for e in entries]
    try:
        result = subprocess.run(
            ["git", "check-ignore", "--stdin", "-z"],
            cwd=directory,
            input=b"\0".join(names) + b"\0",
            capture_output=True,
            timeout=GIT_TIMEOUT_SECONDS,
            env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return set()
    # 1 means nothing is ignored; 128 means no repository (or a path git refuses).
    if result.returncode != 0:
        return set()
    return {os.fsdecode(p).rstrip("/") for p in result.stdout.split(b"\0") if p}


def filter_entries(
    entries: list[dict], directory: Path, settings: EditorSettingsRequest
) -> list[dict]:
    ignored = git_ignored(directory, entries) if settings.hide_ignored else set()

    def hidden(entry: dict) -> bool:
        return (
            (settings.hide_hidden and entry["name"].startswith("."))
            or entry["name"] in ignored
            or any(_matches(p, entry) for p in settings.hidden_patterns)
        )

    return [e for e in entries if not hidden(e)]
