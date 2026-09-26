import asyncio
import logging
import re
from collections.abc import Iterable
from datetime import date, datetime, timedelta, timezone
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
DEFAULT_RETENTION_DAYS = 14


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


def utc_today() -> date:
    # The framework names daily files by the UTC date, not local time.
    return datetime.now(timezone.utc).date()


def open_log_files() -> set[Path]:
    """Files any logging handler in this process is currently writing to."""
    loggers = [logging.getLogger()]
    loggers += [
        lg for lg in logging.Logger.manager.loggerDict.values() if isinstance(lg, logging.Logger)
    ]
    return {
        Path(handler.baseFilename).resolve()
        for lg in loggers
        for handler in lg.handlers
        if isinstance(handler, logging.FileHandler)
    }


def retention_days_from(value, default: int = DEFAULT_RETENTION_DAYS) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        logging.getLogger("keera.logs").warning(
            "Invalid LOG_RETENTION_DAYS %r; using %d", value, default
        )
        return default


def prune_daily_logs(
    directory: str | Path,
    retention_days: int,
    today: date | None = None,
    keep: Iterable[str | Path] = (),
) -> list[Path]:
    """Delete `YYYY-MM-DD.log` files older than `retention_days`.

    Today's file and every path in `keep` are never deleted: a long-running
    server keeps writing to its boot-day file, and unlinking an open file
    loses its logs without freeing any space.
    """
    directory = Path(directory)
    if retention_days <= 0 or not directory.is_dir():
        return []

    today = today or utc_today()
    cutoff = today - timedelta(days=retention_days)
    protected = {Path(p).resolve() for p in keep}

    deleted = []
    for path in sorted(directory.iterdir()):
        match = DAILY_LOG.match(path.name)
        if not match or not path.is_file() or path.resolve() in protected:
            continue
        try:
            day = date.fromisoformat(match.group(1))
        except ValueError:
            continue
        if day >= cutoff or day >= today:
            continue
        try:
            path.unlink()
            deleted.append(path)
        except OSError:
            pass
    return deleted


async def prune_daily_logs_forever(
    directory: str | Path, retention_days: int, keep: Iterable[str | Path] = ()
) -> None:
    # Snapshot taken at boot: the framework's driver briefly detaches its
    # handler on every write, so a live scan alone could miss the open file.
    keep = set(keep)
    while True:
        try:
            deleted = prune_daily_logs(directory, retention_days, keep=keep | open_log_files())
            if deleted:
                logging.getLogger("keera.logs").info("Pruned %d old log file(s)", len(deleted))
        except Exception:
            logging.getLogger("keera.logs").exception("Log retention failed")
        await asyncio.sleep(PRUNE_INTERVAL_SECONDS)
