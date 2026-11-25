from dataclasses import dataclass, field

from fastapi_startkit.environment import env, value
from fastapi_startkit.logging.config import DailyChannel, StackChannel, TerminalChannel


@dataclass
class LoggingConfig:
    default: str = env("LOG_CHANNEL", "stack")

    channels: dict = field(
        default_factory=lambda: {
            "stack": StackChannel(driver="stack", channels=["daily", "terminal"]),
            "daily": DailyChannel(
                level=value(env("LOG_DAILY_LEVEL", "info")),
                path=value(env("LOG_DAILY_PATH", "storage/logs")),
            ),
            "terminal": TerminalChannel(level=value(env("LOG_TERMINAL_LEVEL", "info"))),
        }
    )

    # Floor for third-party loggers (ORM, sqlite driver, asyncio, http clients).
    library_level: str = env("LOG_LIBRARY_LEVEL", "warning")

    # Daily log files older than this are deleted; 0 disables pruning. Parsed
    # at startup so a bad value falls back to the default instead of failing boot.
    retention_days: str | int = env("LOG_RETENTION_DAYS", 14)
