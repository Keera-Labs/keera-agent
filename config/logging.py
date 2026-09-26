from dataclasses import dataclass, field

from fastapi_startkit.environment import env
from fastapi_startkit.logging.config import DailyChannel, StackChannel, TerminalChannel


@dataclass
class LoggingConfig:
    default: str = field(default_factory=lambda: env("LOG_CHANNEL", "stack"))

    channels: dict = field(
        default_factory=lambda: {
            "stack": StackChannel(driver="stack", channels=["daily", "terminal"]),
            "daily": DailyChannel(
                level=env("LOG_DAILY_LEVEL", "info"),
                path=env("LOG_DAILY_PATH", "storage/logs"),
            ),
            "terminal": TerminalChannel(level=env("LOG_TERMINAL_LEVEL", "info")),
        }
    )

    # Floor for third-party loggers (ORM, sqlite driver, asyncio, http clients).
    library_level: str = field(default_factory=lambda: env("LOG_LIBRARY_LEVEL", "warning"))

    # Daily log files older than this are deleted; 0 disables pruning.
    retention_days: int = field(default_factory=lambda: int(env("LOG_RETENTION_DAYS", 14)))
