import asyncio
import logging
import re
from datetime import date, timedelta
from pathlib import Path

DAILY_LOG = re.compile(r"^(\d{4}-\d{2}-\d{2})\.log$")

# The framework's log driver resets the root logger's level on every call, so
# a single app-level debug() re-enables DEBUG for every library. These loggers
# get their own floor so per-query ORM chatter never reaches the daily file.
# "sqlalchemy.engine.Engine" is listed on its own because the ORM creates its
# engine with echo=True, which ignores logger levels and needs the filter.
NOISY_LOGGERS = (
    "sqlalchemy",
    "sqlalchemy.engine.Engine",
    "aiosqlite",
    "asyncio",
    "httpx",
    "httpcore",
    "multipart",
    "watchfiles",
)

PRUNE_INTERVAL_SECONDS = 6 * 60 * 60


class _MinLevelFilter(logging.Filter):
    def __init__(self, level: int):
        super().__init__()
        self.level = level

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno >= self.level


def quiet_noisy_loggers(level: str = "warning") -> None:
    numeric = logging.getLevelName(level.upper())
    if not isinstance(numeric, int):
        numeric = logging.WARNING
    for name in NOISY_LOGGERS:
        logger = logging.getLogger(name)
        logger.setLevel(numeric)
        for existing in [f for f in logger.filters if isinstance(f, _MinLevelFilter)]:
            logger.removeFilter(existing)
        logger.addFilter(_MinLevelFilter(numeric))


def prune_daily_logs(
    directory: str | Path, retention_days: int, today: date | None = None
) -> list[Path]:
    """Delete `YYYY-MM-DD.log` files older than `retention_days`.

    Today's file and the newest daily file are always kept: the running server
    holds its boot-day file open, so deleting it would free no space.
    """
    directory = Path(directory)
    if retention_days <= 0 or not directory.is_dir():
        return []

    today = today or date.today()
    cutoff = today - timedelta(days=retention_days)

    dated: list[tuple[date, Path]] = []
    for path in directory.iterdir():
        match = DAILY_LOG.match(path.name)
        if not match or not path.is_file():
            continue
        try:
            dated.append((date.fromisoformat(match.group(1)), path))
        except ValueError:
            continue
    if not dated:
        return []

    newest = max(day for day, _ in dated)
    deleted = []
    for day, path in sorted(dated):
        if day >= cutoff or day >= today or day == newest:
            continue
        try:
            path.unlink()
            deleted.append(path)
        except OSError:
            pass
    return deleted


async def prune_daily_logs_forever(directory: str | Path, retention_days: int) -> None:
    while True:
        try:
            deleted = prune_daily_logs(directory, retention_days)
            if deleted:
                logging.getLogger("keera.logs").info("Pruned %d old log file(s)", len(deleted))
        except Exception:
            logging.getLogger("keera.logs").exception("Log retention failed")
        await asyncio.sleep(PRUNE_INTERVAL_SECONDS)
