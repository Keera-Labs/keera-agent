import logging
import tempfile
from datetime import date
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.services.log_maintenance import NOISY_LOGGERS, prune_daily_logs, quiet_noisy_loggers
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

        deleted = prune_daily_logs(self.dir, retention_days=0, today=TODAY)

        self.assertEqual(deleted, [])
        self.assertTrue(today.exists())
        for path in others:
            self.assertTrue(path.exists())
        self.assertTrue((self.dir / "2026-01-02.log").is_dir())

    async def test_keeps_the_newest_log_even_when_it_is_past_retention(self):
        # A server started weeks ago still writes to its boot-day file.
        older = self.touch("2026-08-01.log")
        active = self.touch("2026-08-10.log")

        deleted = prune_daily_logs(self.dir, retention_days=14, today=TODAY)

        self.assertEqual(deleted, [older])
        self.assertTrue(active.exists())

    async def test_non_positive_retention_disables_pruning(self):
        old = self.touch("2026-01-01.log")
        self.touch("2026-09-26.log")

        self.assertEqual(prune_daily_logs(self.dir, retention_days=-1, today=TODAY), [])
        self.assertTrue(old.exists())

    async def test_missing_directory_is_a_no_op(self):
        self.assertEqual(prune_daily_logs(self.dir / "missing", retention_days=14, today=TODAY), [])


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
