"""
Database utilities for the Keera MCP server.

Connects directly to the Keera SQLite database without the Masonite ORM.

Configuration:
  KEERA_DB  — absolute or relative path to keera.db
               (default: storage/keera.db, resolved from CWD)
"""

import json
import os

import aiosqlite


def get_db_path() -> str:
    """Resolve the path to the Keera SQLite database."""
    if db_path := os.environ.get("KEERA_DB"):
        return os.path.expanduser(db_path)

    candidates = [
        "storage/keera.db",
        os.path.expanduser("~/.keera/keera.db"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path

    # Fall back to the default; will surface a clear error on first DB call
    return "storage/keera.db"


def load_json_field(value: str | None) -> list:
    """Parse a JSON-encoded list column; return [] on failure."""
    if not value:
        return []
    try:
        result = json.loads(value)
        return result if isinstance(result, list) else []
    except (ValueError, TypeError):
        return []


async def get_project_by_path(
    db: aiosqlite.Connection, path: str
) -> aiosqlite.Row | None:
    """Find a project row by its file-system path (normalised)."""
    expanded = os.path.expanduser(path).rstrip("/")
    async with db.execute("SELECT id, name, path FROM projects") as cursor:
        async for row in cursor:
            if os.path.expanduser(row["path"]).rstrip("/") == expanded:
                return row
    return None
