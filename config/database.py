from dataclasses import dataclass, field
from typing import Any, Dict

from fastapi_startkit.environment.environment import env
from fastapi_startkit.masoniteorm import SQLiteConfig


@dataclass
class DatabaseConfig:
    default: str = field(default_factory=lambda: env("DB_CONNECTION", "sqlite"))

    connections: Dict[str, Dict[str, Any]] = field(
        default_factory=lambda: {
            "sqlite": SQLiteConfig(
                driver="sqlite",
                url=env("DB_URL", "sqlite+aiosqlite:///storage/keera.db"),
                database=env("DB_DATABASE", "storage/keera.db"),
                options=None,
            ),
        }
    )

    migrations: Dict[str, Dict[str, Any]] = field(
        default_factory=lambda: {
            "table": "migrations",
            "directory": "databases/migrations",
        }
    )
