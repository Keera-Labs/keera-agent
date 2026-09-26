import logging
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.services.log_maintenance import (
    DEFAULT_RETENTION_DAYS,
    NOISY_LOGGERS,
    open_log_files,
    prune_daily_logs,
    quiet_noisy_loggers,
    retention_days_from,
    utc_today,
)
from tests.test_case import TestCase

TODAY = date(2026, 9, 26)


class TestPruneDailyLogs(TestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    async def asyncTearDown(self):
        self._tmp.cleanup()
        await super().asyncTearDown()

    def touch(self, name: str) -> Path:
        path = self.dir / name
        path.write_text("x")
        return path

    async def test_deletes_daily_logs_older_than_retention(self):
        old = self.touch("2026-09-01.log")
        edge = self.touch("2026-09-12.log")
        recent = self.touch("2026-09-20.log")
        today = self.touch("2026-09-26.log")

        deleted = prune_daily_logs(self.dir, retention_days=14, today=TODAY)

        self.assertEqual(deleted, [old])
        self.assertFalse(old.exists())
        self.assertTrue(edge.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(today.exists())

    async def test_never_deletes_todays_or_non_daily_files(self):
        today = self.touch("2026-09-26.log")
        others = [
            self.touch(n) for n in ("keera.db", "single.log", "2026-01-01.log.bak", "notes.txt")
        ]
        (self.dir / "2026-01-02.log").mkdir()

        deleted = prune_daily_logs(self.dir, retention_days=1, today=TODAY)

        self.assertEqual(deleted, [])
        self.assertTrue(today.exists())
        for path in others:
            self.assertTrue(path.exists())
        self.assertTrue((self.dir / "2026-01-02.log").is_dir())

    async def test_keeps_a_long_running_servers_open_log_after_a_newer_file_appears(self):
        # Server booted 20 days ago and still writes to its boot-day file; an
        # artisan command (db:migrate, build) then created today's file.
        older = self.touch("2026-08-01.log")
        boot_file = self.touch("2026-09-06.log")
        self.touch("2026-09-26.log")
        handler = logging.FileHandler(boot_file)
        logger = logging.getLogger("keera.tests.open-log")
        logger.addHandler(handler)
        try:
            deleted = prune_daily_logs(
                self.dir, retention_days=14, today=TODAY, keep=open_log_files()
            )
        finally:
            logger.removeHandler(handler)
            handler.close()

        self.assertEqual(deleted, [older])
        self.assertTrue(boot_file.exists())

    async def test_keep_protects_paths_given_in_any_form(self):
        boot_file = self.touch("2026-09-06.log")
        relative = Path(self._tmp.name) / "." / "2026-09-06.log"

        deleted = prune_daily_logs(self.dir, retention_days=14, today=TODAY, keep=[str(relative)])

        self.assertEqual(deleted, [])
        self.assertTrue(boot_file.exists())

    async def test_non_positive_retention_disables_pruning(self):
        old = self.touch("2026-01-01.log")
        self.touch("2026-09-26.log")

        self.assertEqual(prune_daily_logs(self.dir, retention_days=-1, today=TODAY), [])
        self.assertTrue(old.exists())

    async def test_missing_directory_is_a_no_op(self):
        self.assertEqual(prune_daily_logs(self.dir / "missing", retention_days=14, today=TODAY), [])


class TestRetentionSettings(TestCase):
    async def test_today_is_the_utc_date_the_framework_names_files_by(self):
        self.assertEqual(utc_today(), datetime.now(timezone.utc).date())

    async def test_invalid_retention_falls_back_to_the_default(self):
        with self.assertLogs("keera.logs", level="WARNING"):
            self.assertEqual(retention_days_from("two weeks"), DEFAULT_RETENTION_DAYS)
        self.assertEqual(retention_days_from(None), DEFAULT_RETENTION_DAYS)

    async def test_numeric_retention_is_parsed(self):
        self.assertEqual(retention_days_from("30"), 30)
        self.assertEqual(retention_days_from(0), 0)


class TestQuietNoisyLoggers(TestCase):
    async def test_drops_library_chatter_but_keeps_errors(self):
        quiet_noisy_loggers("warning")
        records: list[logging.LogRecord] = []

        class Capture(logging.Handler):
            def emit(self, record):
                records.append(record)

        handler = Capture()
        names = ("sqlalchemy.engine.Engine", "aiosqlite", "keera.agents")
        loggers = [logging.getLogger(name) for name in names]
        saved = [lg.propagate for lg in loggers]
        for lg in loggers:
            lg.addHandler(handler)
            lg.propagate = False
        # Mimic the framework driver leaving the root logger at DEBUG.
        root = logging.getLogger()
        previous = root.level
        root.setLevel(logging.DEBUG)
        try:
            # The ORM builds its engine with echo=True, which bypasses logger levels.
            engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=True)
            async with engine.connect() as conn:
                await conn.execute(text("select 1"))
            await engine.dispose()
            logging.getLogger("aiosqlite").debug("executing")
            logging.getLogger("sqlalchemy.engine.Engine").error("boom")
            logging.getLogger("keera.agents").info("app message")
        finally:
            root.setLevel(previous)
            for lg, propagate in zip(loggers, saved):
                lg.removeHandler(handler)
                lg.propagate = propagate

        self.assertEqual([r.getMessage() for r in records], ["boom", "app message"])
        self.assertIn("sqlalchemy", NOISY_LOGGERS)

    async def test_is_idempotent(self):
        quiet_noisy_loggers("warning")
        quiet_noisy_loggers("warning")

        self.assertEqual(len(logging.getLogger("sqlalchemy.engine.Engine").filters), 1)
